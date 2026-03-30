const pool = require('../db');
const registrationService = require('../services/registrationService');
const {
  isValidExternalRequestId,
  normalizeExternalRequestId,
} = require('../utils/validation');

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeNullableString(value) {
  const normalized = normalizeString(value);
  return normalized || null;
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function normalizeRegistrarInput(payload = {}) {
  return {
    name: normalizeString(payload.name),
    apiEndpoint: normalizeNullableString(payload.apiEndpoint),
    notificationEmail: normalizeNullableString(payload.notificationEmail),
    isActive: payload.isActive !== false,
  };
}

function validateRegistrarInput(payload) {
  if (!payload.name) {
    throw new Error('Registrar name is required.');
  }

  if (payload.apiEndpoint) {
    try {
      const parsed = new URL(payload.apiEndpoint);

      if (!['http:', 'https:'].includes(parsed.protocol)) {
        throw new Error('Registrar API endpoint must start with http:// or https://.');
      }
    } catch (error) {
      throw new Error('Registrar API endpoint must be a valid URL.');
    }
  }

  if (payload.notificationEmail && !isValidEmail(payload.notificationEmail)) {
    throw new Error('Registrar notification email must be a valid email address.');
  }
}

async function getDashboardStats() {
  const result = await pool.query(`
    SELECT
      (SELECT COUNT(*)::int FROM registrations) AS incoming_count,
      (SELECT COUNT(*)::int FROM registrations WHERE pushed = true) AS processed_count,
      (
        SELECT COUNT(*)
        FROM (
          SELECT DISTINCT registration_id
          FROM failed_requests
          WHERE registration_id IS NOT NULL
        ) failed
      )::int AS failed_push_count,
      (SELECT COUNT(*)::int FROM registrars) AS registrar_count,
      (SELECT COUNT(*)::int FROM registrars WHERE is_active = true) AS active_registrar_count,
      (
        SELECT COUNT(*)::int
        FROM delivery_logs
        WHERE status = 'failed'
      ) AS failed_delivery_count
  `);

  return result.rows[0];
}

async function listRegistrars() {
  const result = await pool.query(`
    SELECT
      r.id,
      r.name,
      r.api_endpoint,
      r.notification_email,
      r.is_active,
      r.created_at,
      COUNT(reg.request_id)::int AS total_requests,
      (COUNT(reg.request_id) FILTER (WHERE reg.pushed = true))::int AS processed_requests
    FROM registrars r
    LEFT JOIN registrations reg
      ON LOWER(reg.registrar_name) = LOWER(r.name)
    GROUP BY
      r.id,
      r.name,
      r.api_endpoint,
      r.notification_email,
      r.is_active,
      r.created_at
    ORDER BY r.is_active DESC, LOWER(r.name) ASC
  `);

  return result.rows;
}

async function getRegistrarById(registrarId) {
  const result = await pool.query(
    `
      SELECT
        r.id,
        r.name,
        r.api_endpoint,
        r.notification_email,
        r.is_active,
        r.created_at,
        COUNT(reg.request_id)::int AS total_requests,
        (COUNT(reg.request_id) FILTER (WHERE reg.pushed = true))::int AS processed_requests
      FROM registrars r
      LEFT JOIN registrations reg
        ON LOWER(reg.registrar_name) = LOWER(r.name)
      WHERE r.id = $1
      GROUP BY
        r.id,
        r.name,
        r.api_endpoint,
        r.notification_email,
        r.is_active,
        r.created_at
    `,
    [registrarId]
  );

  return result.rows[0] || null;
}

async function ensureRegistrarNameAvailable(client, name, excludeId = null) {
  const params = [name];
  let query = `
    SELECT id
    FROM registrars
    WHERE LOWER(name) = LOWER($1)
  `;

  if (excludeId) {
    params.push(excludeId);
    query += ' AND id <> $2';
  }

  query += ' LIMIT 1';

  const existing = await client.query(query, params);

  if (existing.rows.length > 0) {
    throw new Error(`Registrar "${name}" already exists.`);
  }
}

async function createRegistrar(payload) {
  const input = normalizeRegistrarInput(payload);
  validateRegistrarInput(input);

  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await ensureRegistrarNameAvailable(client, input.name);

    const result = await client.query(
      `
        INSERT INTO registrars (
          name,
          api_endpoint,
          notification_email,
          is_active
        )
        VALUES ($1, $2, $3, $4)
        RETURNING id
      `,
      [
        input.name,
        input.apiEndpoint,
        input.notificationEmail,
        input.isActive,
      ]
    );

    await client.query('COMMIT');

    return getRegistrarById(result.rows[0].id);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function updateRegistrar(registrarId, payload) {
  const input = normalizeRegistrarInput(payload);
  validateRegistrarInput(input);

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const existing = await client.query(
      `
        SELECT id, name
        FROM registrars
        WHERE id = $1
        LIMIT 1
      `,
      [registrarId]
    );

    if (!existing.rows.length) {
      throw new Error('Registrar not found.');
    }

    const currentRegistrar = existing.rows[0];
    await ensureRegistrarNameAvailable(client, input.name, registrarId);

    await client.query(
      `
        UPDATE registrars
        SET name = $2,
            api_endpoint = $3,
            notification_email = $4,
            is_active = $5
        WHERE id = $1
      `,
      [
        registrarId,
        input.name,
        input.apiEndpoint,
        input.notificationEmail,
        input.isActive,
      ]
    );

    if (currentRegistrar.name.toLowerCase() !== input.name.toLowerCase()) {
      await client.query(
        `
          UPDATE registrations
          SET registrar_name = $2
          WHERE LOWER(registrar_name) = LOWER($1)
        `,
        [currentRegistrar.name, input.name]
      );

      await client.query(
        `
          UPDATE registrar_requests
          SET registrar_name = $2
          WHERE LOWER(registrar_name) = LOWER($1)
        `,
        [currentRegistrar.name, input.name]
      );
    }

    await client.query('COMMIT');

    return getRegistrarById(registrarId);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function toggleRegistrarActive(registrarId) {
  const result = await pool.query(
    `
      UPDATE registrars
      SET is_active = NOT is_active
      WHERE id = $1
      RETURNING id
    `,
    [registrarId]
  );

  if (!result.rows.length) {
    throw new Error('Registrar not found.');
  }

  return getRegistrarById(result.rows[0].id);
}

async function listFailedPushes(limit = 50) {
  const result = await pool.query(
    `
      SELECT *
      FROM (
        SELECT DISTINCT ON (fr.registration_id)
          fr.id AS failure_id,
          fr.registration_id,
          fr.error_message,
          fr.attempted_at,
          r.full_name,
          r.email,
          r.phone,
          r.domain_name,
          r.registrar_name,
          r.external_request_id,
          r.created_at,
          r.pushed,
          r.registrar_reference_id
        FROM failed_requests fr
        INNER JOIN registrations r
          ON r.request_id = fr.registration_id
        ORDER BY fr.registration_id, fr.attempted_at DESC
      ) latest_failures
      ORDER BY attempted_at DESC
      LIMIT $1
    `,
    [limit]
  );

  return result.rows;
}

async function listRecentDeliveryLogs(limit = 50) {
  const result = await pool.query(
    `
      SELECT
        dl.id,
        dl.registration_id,
        dl.delivery_type,
        dl.recipient_type,
        dl.destination,
        dl.template_key,
        dl.subject,
        dl.payload,
        dl.status,
        dl.attempts,
        dl.max_attempts,
        dl.provider_reference,
        dl.last_response,
        dl.last_error,
        dl.first_attempted_at,
        dl.last_attempted_at,
        dl.delivered_at,
        dl.created_at,
        dl.updated_at,
        r.domain_name,
        r.registrar_name,
        r.external_request_id
      FROM delivery_logs dl
      LEFT JOIN registrations r
        ON r.request_id = dl.registration_id
      ORDER BY COALESCE(dl.last_attempted_at, dl.updated_at, dl.created_at) DESC
      LIMIT $1
    `,
    [limit]
  );

  return result.rows;
}

async function getRegistrationByExternalReference(externalRequestId) {
  const normalizedReference = normalizeExternalRequestId(externalRequestId);

  if (!isValidExternalRequestId(normalizedReference)) {
    throw new Error(
      'Reference lookups require a valid public reference code.'
    );
  }

  const registrationResult = await pool.query(
    `
      SELECT
        r.request_id,
        r.external_request_id,
        r.full_name,
        r.email,
        r.phone,
        r.domain_name,
        r.registrar_name,
        r.registrar_reference_id,
        r.status,
        r.message_sent,
        r.pushed,
        r.created_at,
        r.updated_at,
        reg.id AS registrar_id,
        reg.api_endpoint AS registrar_api_endpoint,
        reg.notification_email AS registrar_notification_email,
        reg.is_active AS registrar_is_active,
        COALESCE(failure_summary.failed_push_count, 0)::int AS failed_push_count,
        failure_summary.last_failed_at,
        failure_summary.last_error_message,
        COALESCE(delivery_summary.successful_delivery_count, 0)::int AS successful_delivery_count,
        COALESCE(delivery_summary.failed_delivery_count, 0)::int AS failed_delivery_count,
        COALESCE(delivery_summary.pending_delivery_count, 0)::int AS pending_delivery_count,
        COALESCE(delivery_summary.skipped_delivery_count, 0)::int AS skipped_delivery_count
      FROM registrations r
      LEFT JOIN registrars reg
        ON LOWER(reg.name) = LOWER(r.registrar_name)
      LEFT JOIN LATERAL (
        SELECT
          COUNT(*)::int AS failed_push_count,
          MAX(fr.attempted_at) AS last_failed_at,
          (ARRAY_AGG(fr.error_message ORDER BY fr.attempted_at DESC))[1] AS last_error_message
        FROM failed_requests fr
        WHERE fr.registration_id = r.request_id
      ) failure_summary ON TRUE
      LEFT JOIN LATERAL (
        SELECT
          COUNT(*) FILTER (WHERE dl.status = 'success')::int AS successful_delivery_count,
          COUNT(*) FILTER (WHERE dl.status = 'failed')::int AS failed_delivery_count,
          COUNT(*) FILTER (WHERE dl.status = 'pending')::int AS pending_delivery_count,
          COUNT(*) FILTER (WHERE dl.status = 'skipped')::int AS skipped_delivery_count
        FROM delivery_logs dl
        WHERE dl.registration_id = r.request_id
      ) delivery_summary ON TRUE
      WHERE r.external_request_id = $1
      LIMIT 1
    `,
    [normalizedReference]
  );

  const registration = registrationResult.rows[0] || null;

  if (!registration) {
    return null;
  }

  const [failedPushAttemptsResult, deliveryLogsResult] = await Promise.all([
    pool.query(
      `
        SELECT
          id,
          attempted_at,
          error_message
        FROM failed_requests
        WHERE registration_id = $1
        ORDER BY attempted_at DESC
        LIMIT 10
      `,
      [registration.request_id]
    ),
    pool.query(
      `
        SELECT
          id,
          delivery_type,
          recipient_type,
          destination,
          template_key,
          subject,
          status,
          attempts,
          max_attempts,
          provider_reference,
          last_error,
          last_attempted_at,
          delivered_at,
          created_at,
          updated_at
        FROM delivery_logs
        WHERE registration_id = $1
        ORDER BY
          COALESCE(last_attempted_at, delivered_at, updated_at, created_at) DESC,
          created_at DESC
        LIMIT 12
      `,
      [registration.request_id]
    ),
  ]);

  return {
    deliveryLogs: deliveryLogsResult.rows,
    failedPushAttempts: failedPushAttemptsResult.rows,
    registration,
  };
}

async function getDashboardData() {
  const [stats, registrars, failedPushes, deliveryLogs] = await Promise.all([
    getDashboardStats(),
    listRegistrars(),
    listFailedPushes(8),
    listRecentDeliveryLogs(8),
  ]);

  return {
    deliveryLogs,
    failedPushes,
    registrars,
    stats,
  };
}

async function retryFailedPush(registrationId) {
  return registrationService.retryFailedPushByRegistrationId(registrationId);
}

async function retryAllFailedPushes() {
  return registrationService.retryFailedPushes();
}

module.exports = {
  createRegistrar,
  getDashboardData,
  getRegistrationByExternalReference,
  listFailedPushes,
  listRecentDeliveryLogs,
  listRegistrars,
  retryAllFailedPushes,
  retryFailedPush,
  toggleRegistrarActive,
  updateRegistrar,
};
