const pool = require('../db');
const { env } = require('../config/env');

const DELIVERY_STATUS = Object.freeze({
  FAILED: 'failed',
  PENDING: 'pending',
  SKIPPED: 'skipped',
  SUCCESS: 'success',
});

const RETRY_DELAYS_MS = [250, 750, 1500];
const DEFAULT_MAX_ATTEMPTS = 3;

function serializeDetails(value) {
  if (value == null) {
    return null;
  }

  if (typeof value === 'string') {
    return value;
  }

  return JSON.stringify(value);
}

function sleep(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function normalizeAttemptCount(value, fallback = DEFAULT_MAX_ATTEMPTS) {
  const normalizedValue = Number.parseInt(String(value ?? '').trim(), 10);

  return Number.isFinite(normalizedValue) && normalizedValue > 0
    ? normalizedValue
    : fallback;
}

function buildAuditErrorMessage(label, error) {
  return `${label}: ${error instanceof Error ? error.message : 'Unexpected audit error'}`;
}

async function upsertDeliveryLog({
  registrationId,
  deliveryType,
  recipientType,
  destination,
  templateKey,
  subject,
  payload,
  maxAttempts,
}) {
  const query = `
    INSERT INTO delivery_logs (
      registration_id,
      delivery_type,
      recipient_type,
      destination,
      template_key,
      subject,
      payload,
      max_attempts,
      status
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)
    ON CONFLICT (registration_id, delivery_type, recipient_type, template_key)
    DO UPDATE
      SET destination = EXCLUDED.destination,
          subject = EXCLUDED.subject,
          payload = EXCLUDED.payload,
          max_attempts = EXCLUDED.max_attempts,
          updated_at = CURRENT_TIMESTAMP
    RETURNING *;
  `;

  const result = await pool.query(query, [
    registrationId,
    deliveryType,
    recipientType,
    destination,
    templateKey,
    subject || null,
    JSON.stringify(payload || {}),
    maxAttempts,
    DELIVERY_STATUS.PENDING,
  ]);

  return result.rows[0];
}

async function appendDeliveryAttempt({
  deliveryLogId,
  attemptNumber,
  status,
  responseMessage,
  errorMessage,
}) {
  const query = `
    INSERT INTO delivery_attempt_logs (
      delivery_log_id,
      attempt_number,
      status,
      response_message,
      error_message
    )
    VALUES ($1, $2, $3, $4, $5);
  `;

  await pool.query(query, [
    deliveryLogId,
    attemptNumber,
    status,
    responseMessage,
    errorMessage,
  ]);
}

async function updateDeliveryLog({
  deliveryLogId,
  attempts,
  status,
  responseMessage,
  errorMessage,
  providerReference,
}) {
  const query = `
    UPDATE delivery_logs
    SET attempts = $2,
        status = $3::varchar(20),
        last_response = $4::text,
        last_error = CASE
          WHEN $3::text = 'success' OR $3::text = 'skipped' THEN NULL
          ELSE $5::text
        END,
        provider_reference = COALESCE($6::varchar(255), provider_reference),
        first_attempted_at = COALESCE(first_attempted_at, CURRENT_TIMESTAMP),
        last_attempted_at = CURRENT_TIMESTAMP,
        delivered_at = CASE
          WHEN $3::text = 'success' THEN CURRENT_TIMESTAMP
          ELSE delivered_at
        END,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = $1;
  `;

  await pool.query(query, [
    deliveryLogId,
    attempts,
    status,
    responseMessage,
    errorMessage,
    providerReference,
  ]);
}

async function runDeliveryWithRetry({
  registrationId,
  deliveryType,
  recipientType,
  destination,
  templateKey,
  subject,
  payload,
  handler,
  maxAttempts = env.notificationMaxAttempts,
  forceRetry = false,
}) {
  const normalizedMaxAttempts = normalizeAttemptCount(maxAttempts);

  if (!destination) {
    return {
      attempts: 0,
      reason: 'missing_destination',
      status: DELIVERY_STATUS.SKIPPED,
    };
  }

  const deliveryLog = await upsertDeliveryLog({
    registrationId,
    deliveryType,
    recipientType,
    destination,
    templateKey,
    subject,
    payload,
    maxAttempts: normalizedMaxAttempts,
  });

  const effectiveMaxAttempts = forceRetry
    ? Math.max(
        normalizeAttemptCount(deliveryLog.max_attempts, normalizedMaxAttempts),
        Number(deliveryLog.attempts || 0) + normalizedMaxAttempts
      )
    : normalizedMaxAttempts;

  if (forceRetry && deliveryLog.max_attempts !== effectiveMaxAttempts) {
    await pool.query(
      `
        UPDATE delivery_logs
        SET max_attempts = $2,
            status = 'pending',
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
      `,
      [deliveryLog.id, effectiveMaxAttempts]
    );
    deliveryLog.max_attempts = effectiveMaxAttempts;
  }

  if (deliveryLog.status === DELIVERY_STATUS.SUCCESS) {
    return {
      attempts: deliveryLog.attempts,
      reason: 'already_succeeded',
      status: DELIVERY_STATUS.SUCCESS,
    };
  }

  if (
    !forceRetry &&
    deliveryLog.status === DELIVERY_STATUS.FAILED &&
    deliveryLog.attempts >= normalizedMaxAttempts
  ) {
    return {
      attempts: deliveryLog.attempts,
      error: deliveryLog.last_error,
      reason: 'max_attempts_exhausted',
      status: DELIVERY_STATUS.FAILED,
    };
  }

  let lastErrorMessage = null;

  for (
    let attemptNumber = deliveryLog.attempts + 1;
    attemptNumber <= effectiveMaxAttempts;
    attemptNumber += 1
  ) {
    try {
      const result = await handler({ attemptNumber, deliveryLogId: deliveryLog.id });
      const responseMessage = serializeDetails(result && (result.response || result));
      const providerStatusCode =
        result &&
        (result.providerStatusCode ||
          result.statusCode ||
          (Number.isInteger(result.status) ? result.status : null));
      const providerReference =
        result &&
        (result.providerReference ||
          result.messageId ||
          result.referenceId ||
          null);
      const auditErrors = [];

      try {
        await appendDeliveryAttempt({
          deliveryLogId: deliveryLog.id,
          attemptNumber,
          status: DELIVERY_STATUS.SUCCESS,
          responseMessage,
          errorMessage: null,
        });
      } catch (error) {
        auditErrors.push(buildAuditErrorMessage('append success attempt failed', error));
      }

      try {
        await updateDeliveryLog({
          deliveryLogId: deliveryLog.id,
          attempts: attemptNumber,
          status: DELIVERY_STATUS.SUCCESS,
          responseMessage,
          errorMessage: null,
          providerReference,
        });
      } catch (error) {
        auditErrors.push(buildAuditErrorMessage('update success delivery log failed', error));
      }

      if (auditErrors.length) {
        console.error('---- DELIVERY AUDIT WARNING ----', {
          audit_errors: auditErrors,
          delivery_type: deliveryType,
          recipient_type: recipientType,
          registration_id: registrationId,
          template_key: templateKey,
          transport_status: DELIVERY_STATUS.SUCCESS,
        });
      }

      return {
        attempts: attemptNumber,
        audit_error: auditErrors.length ? auditErrors.join(' | ') : null,
        providerStatusCode,
        providerReference,
        response: result,
        status: DELIVERY_STATUS.SUCCESS,
      };
    } catch (error) {
      lastErrorMessage = error.message || 'Unexpected delivery error';
      const nextStatus =
        attemptNumber === effectiveMaxAttempts
          ? DELIVERY_STATUS.FAILED
          : DELIVERY_STATUS.PENDING;
      const auditErrors = [];

      try {
        await appendDeliveryAttempt({
          deliveryLogId: deliveryLog.id,
          attemptNumber,
          status: DELIVERY_STATUS.FAILED,
          responseMessage: null,
          errorMessage: lastErrorMessage,
        });
      } catch (auditError) {
        auditErrors.push(buildAuditErrorMessage('append failure attempt failed', auditError));
      }

      try {
        await updateDeliveryLog({
          deliveryLogId: deliveryLog.id,
          attempts: attemptNumber,
          status: nextStatus,
          responseMessage: null,
          errorMessage: lastErrorMessage,
          providerReference: null,
        });
      } catch (auditError) {
        auditErrors.push(buildAuditErrorMessage('update failure delivery log failed', auditError));
      }

      if (auditErrors.length) {
        console.error('---- DELIVERY AUDIT WARNING ----', {
          audit_errors: auditErrors,
          delivery_type: deliveryType,
          recipient_type: recipientType,
          registration_id: registrationId,
          template_key: templateKey,
          transport_status: nextStatus,
        });
      }

      if (nextStatus === DELIVERY_STATUS.FAILED) {
        return {
          attempts: attemptNumber,
          audit_error: auditErrors.length ? auditErrors.join(' | ') : null,
          error: lastErrorMessage,
          reason: 'max_attempts_exhausted',
          status: DELIVERY_STATUS.FAILED,
        };
      }

      const delay =
        RETRY_DELAYS_MS[attemptNumber - 1] ||
        RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1];

      await sleep(delay);
    }
  }

  return {
    attempts: effectiveMaxAttempts,
    error: lastErrorMessage,
    reason: 'loop_exhausted',
    status: DELIVERY_STATUS.FAILED,
  };
}

module.exports = {
  DELIVERY_STATUS,
  runDeliveryWithRetry,
};
