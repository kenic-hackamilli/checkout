const pool = require('../db');
const registrationService = require('../services/registrationService');
const { isEmailConfigured, sendEmail } = require('../services/email');
const { env } = require('../config/env');
const {
  createPrimaryRegistrarApiKey,
} = require('../services/domainUpdaterIntegration');
const {
  isValidExternalRequestId,
  normalizeExternalRequestId,
} = require('../utils/validation');

const LIVE_REGISTRAR_CONSOLE_URL = 'https://apps.kenic.or.ke/console/';

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

function isValidPhone(value) {
  return /^[0-9+().\-\s]{7,25}$/.test(value);
}

function slugify(value) {
  return normalizeString(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 120);
}

function normalizeIntegerValue(value, { fieldLabel, defaultValue = null, min = 0 } = {}) {
  if (value === null || value === undefined || value === '') {
    return defaultValue;
  }

  const normalizedNumber = Number.parseInt(String(value).trim(), 10);

  if (!Number.isFinite(normalizedNumber)) {
    throw new Error(`${fieldLabel} must be a whole number.`);
  }

  if (normalizedNumber < min) {
    throw new Error(`${fieldLabel} must be ${min} or greater.`);
  }

  return normalizedNumber;
}

function getBillingCycleFromMonths(billingPeriodMonths) {
  if (billingPeriodMonths === 1) {
    return 'monthly';
  }

  if (billingPeriodMonths === 12) {
    return 'yearly';
  }

  return 'custom';
}

function isLocalAccessUrl(value) {
  try {
    const parsedUrl = new URL(String(value || '').trim());
    return ['localhost', '127.0.0.1', '0.0.0.0'].includes(parsedUrl.hostname);
  } catch (_error) {
    return false;
  }
}

function buildPortalAccessUrl() {
  const normalizedUrl = normalizeNullableString(env.domainUpdaterPublicUrl);

  if (!normalizedUrl || isLocalAccessUrl(normalizedUrl)) {
    return LIVE_REGISTRAR_CONSOLE_URL;
  }

  return normalizedUrl.endsWith('/') ? normalizedUrl : `${normalizedUrl}/`;
}

function buildRegistrarOnboardingEmail({ registrar, apiKey }) {
  const consoleUrl = buildPortalAccessUrl();
  const subject = `${registrar.name} console workspace is ready`;
  const textLines = [
    `Hello ${registrar.name},`,
    '',
    'Your console workspace is ready.',
    'You have been onboarded successfully.',
    '',
    'Use this API key to log in to your console workspace:',
    apiKey,
    '',
    'This credential is private and confidential. Store it securely and do not share it outside your registrar team.',
    'When you enter this key in the console workspace, a one-time password will be sent automatically to your registered email and/or phone number.',
  ];

  if (consoleUrl) {
    textLines.push('', `Console workspace URL: ${consoleUrl}`);
  }

  textLines.push(
    '',
    'If you believe this message reached you in error, contact the checkout admin team immediately.'
  );

  const htmlSections = [
    `<p>Hello ${registrar.name},</p>`,
    '<p><strong>Your console workspace is ready.</strong></p>',
    '<p>You have been onboarded successfully.</p>',
    '<p>Use this API key to log in to your console workspace:</p>',
    `<p style="font-size:18px;font-weight:700;letter-spacing:0.06em;padding:14px 18px;border-radius:12px;background:#eef3ff;color:#10203d;display:inline-block;">${apiKey}</p>`,
    '<p><strong>Private and confidential:</strong> store this credential securely and do not share it outside your registrar team.</p>',
    '<p>When you enter this key in the console workspace, a one-time password will be sent automatically to your registered email and/or phone number.</p>',
  ];

  if (consoleUrl) {
    htmlSections.push(
      `<p>Console workspace URL: <a href="${consoleUrl}">${consoleUrl}</a></p>`
    );
  }

  htmlSections.push(
    '<p>If you believe this message reached you in error, contact the checkout admin team immediately.</p>'
  );

  return {
    html: htmlSections.join(''),
    subject,
    text: textLines.join('\n'),
  };
}

async function sendRegistrarOnboardingEmail({ registrar, apiKey }) {
  if (!registrar || !registrar.primary_email) {
    return {
      reason: 'missing_primary_email',
      status: 'skipped',
    };
  }

  if (!isEmailConfigured()) {
    return {
      destination: registrar.primary_email,
      reason: 'email_service_not_configured',
      status: 'skipped',
    };
  }

  const emailContent = buildRegistrarOnboardingEmail({ registrar, apiKey });

  try {
    const delivery = await sendEmail({
      to: registrar.primary_email,
      ...emailContent,
    });

    return {
      accepted: delivery.accepted,
      destination: registrar.primary_email,
      messageId: delivery.messageId,
      status: 'sent',
    };
  } catch (error) {
    return {
      destination: registrar.primary_email,
      reason: error.message,
      status: 'failed',
    };
  }
}

function normalizeRegistrarInput(payload = {}) {
  return {
    name: normalizeString(payload.name),
    apiEndpoint: normalizeNullableString(payload.apiEndpoint),
    primaryEmail: normalizeNullableString(payload.primaryEmail),
    primaryPhone: normalizeNullableString(payload.primaryPhone),
    notificationEmail: normalizeNullableString(payload.notificationEmail),
    isActive: payload.isActive !== false,
  };
}

function validateRegistrarInput(payload) {
  if (!payload.name) {
    throw new Error('Registrar name is required.');
  }

  if (!payload.primaryEmail) {
    throw new Error('Registrar primary email is required.');
  }

  if (!isValidEmail(payload.primaryEmail)) {
    throw new Error('Registrar primary email must be a valid email address.');
  }

  if (!payload.primaryPhone) {
    throw new Error('Registrar primary phone is required.');
  }

  if (!isValidPhone(payload.primaryPhone)) {
    throw new Error('Registrar primary phone must be a valid phone number.');
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

function normalizeDomainOfferingInput(payload = {}) {
  const billingPeriodMonths = normalizeIntegerValue(payload.billingPeriodMonths, {
    defaultValue: 12,
    fieldLabel: 'Billing period months',
    min: 1,
  });

  const registrationPriceKsh = normalizeIntegerValue(payload.registrationPriceKsh, {
    fieldLabel: 'Registration price',
    min: 0,
  });

  const renewalPriceKsh = normalizeIntegerValue(payload.renewalPriceKsh, {
    defaultValue: registrationPriceKsh,
    fieldLabel: 'Renewal price',
    min: 0,
  });

  return {
    billingPeriodMonths,
    domainExtensionId: normalizeString(payload.domainExtensionId),
    isActive: payload.isActive !== false,
    offeringId: normalizeNullableString(payload.offeringId),
    registrationPriceKsh,
    renewalPriceKsh,
    transferPriceKsh: normalizeIntegerValue(payload.transferPriceKsh, {
      defaultValue: null,
      fieldLabel: 'Transfer price',
      min: 0,
    }),
  };
}

function validateDomainOfferingInput(payload) {
  if (!payload.domainExtensionId) {
    throw new Error('Choose a domain extension first.');
  }

  if (payload.registrationPriceKsh === null) {
    throw new Error('Registration price is required.');
  }

  if (payload.renewalPriceKsh === null) {
    throw new Error('Renewal price is required.');
  }
}

function normalizeServiceOfferingInput(payload = {}, serviceProduct = null) {
  const billingPeriodMonths = normalizeIntegerValue(payload.billingPeriodMonths, {
    defaultValue: 1,
    fieldLabel: 'Billing period months',
    min: 1,
  });
  const billingCycleInput = normalizeString(payload.billingCycle).toLowerCase();
  const normalizedBillingCycle = ['monthly', 'yearly', 'custom'].includes(billingCycleInput)
    ? billingCycleInput
    : getBillingCycleFromMonths(billingPeriodMonths);
  const planName = normalizeString(payload.planName);
  const serviceCode = serviceProduct ? serviceProduct.service_code : normalizeString(payload.serviceCode);
  const planCode =
    normalizeString(payload.planCode) || slugify(`${serviceCode || 'service'}_${planName || 'plan'}`);

  return {
    billingCycle: normalizedBillingCycle,
    billingPeriodMonths,
    isActive: payload.isActive !== false,
    offeringId: normalizeNullableString(payload.offeringId),
    planCode,
    planName,
    priceKsh: normalizeIntegerValue(payload.priceKsh, {
      fieldLabel: 'Plan price',
      min: 0,
    }),
    serviceProductId: normalizeString(payload.serviceProductId),
  };
}

function validateServiceOfferingInput(payload) {
  if (!payload.serviceProductId) {
    throw new Error('Choose a service first.');
  }

  if (!payload.planName) {
    throw new Error('Plan name is required.');
  }

  if (!payload.planCode) {
    throw new Error('Plan code could not be generated.');
  }

  if (payload.priceKsh === null) {
    throw new Error('Plan price is required.');
  }
}

function normalizeJsonObjectValue(
  value,
  { defaultValue = {}, fieldLabel = 'JSON value' } = {}
) {
  const normalized = normalizeString(value);

  if (!normalized) {
    return defaultValue;
  }

  let parsed = null;

  try {
    parsed = JSON.parse(normalized);
  } catch (error) {
    throw new Error(`${fieldLabel} must be valid JSON.`);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${fieldLabel} must be a JSON object.`);
  }

  return parsed;
}

function normalizeTextListValue(value) {
  const normalized = normalizeString(value);

  if (!normalized) {
    return [];
  }

  if (normalized.startsWith('[')) {
    let parsed = null;

    try {
      parsed = JSON.parse(normalized);
    } catch (error) {
      throw new Error('Feature highlights must be valid JSON or a "|" separated list.');
    }

    if (!Array.isArray(parsed)) {
      throw new Error('Feature highlights JSON must be an array of strings.');
    }

    return parsed
      .map((item) => normalizeString(item))
      .filter(Boolean);
  }

  return normalized
    .split(/\r?\n|\|/)
    .map((item) => normalizeString(item))
    .filter(Boolean);
}

function normalizeServicePackageInput(payload = {}, serviceProduct = null) {
  const packageName = normalizeString(payload.packageName);
  const serviceCode = serviceProduct
    ? serviceProduct.service_code
    : normalizeString(payload.serviceCode);
  const packageCode =
    normalizeString(payload.packageCode) ||
    slugify(`${serviceCode || 'service'}_${packageName || 'package'}`);

  return {
    detailsJson: normalizeJsonObjectValue(payload.detailsJson, {
      defaultValue: {},
      fieldLabel: 'Details JSON',
    }),
    displayOrder: normalizeIntegerValue(payload.displayOrder, {
      defaultValue: 0,
      fieldLabel: 'Display order',
      min: 0,
    }),
    featureBulletsJson: normalizeTextListValue(payload.featureBulletsText),
    isActive: payload.isActive !== false,
    packageCode,
    packageId: normalizeNullableString(payload.packageId),
    packageName,
    serviceProductId: normalizeString(payload.serviceProductId),
    shortDescription: normalizeNullableString(payload.shortDescription),
  };
}

function validateServicePackageInput(payload) {
  if (!payload.serviceProductId) {
    throw new Error('Choose a service first.');
  }

  if (!payload.packageName) {
    throw new Error('Package name is required.');
  }

  if (!payload.packageCode) {
    throw new Error('Package code could not be generated.');
  }
}

function normalizeServicePackagePriceInput(payload = {}) {
  const billingPeriodMonths = normalizeIntegerValue(payload.billingPeriodMonths, {
    defaultValue: 1,
    fieldLabel: 'Billing period months',
    min: 1,
  });
  const billingCycleInput = normalizeString(payload.billingCycle).toLowerCase();
  const normalizedBillingCycle = ['monthly', 'yearly', 'custom'].includes(billingCycleInput)
    ? billingCycleInput
    : getBillingCycleFromMonths(billingPeriodMonths);
  const normalizedCurrencyCode =
    normalizeString(payload.currencyCode).toUpperCase() || 'KES';

  return {
    billingCycle: normalizedBillingCycle,
    billingLabel: normalizeNullableString(payload.billingLabel),
    billingPeriodMonths,
    currencyCode: normalizedCurrencyCode,
    isActive: payload.isActive !== false,
    isDefault: payload.isDefault === true,
    priceId: normalizeNullableString(payload.priceId),
    priceKsh: normalizeIntegerValue(payload.priceKsh, {
      fieldLabel: 'Package price',
      min: 0,
    }),
    setupFeeKsh: normalizeIntegerValue(payload.setupFeeKsh, {
      defaultValue: 0,
      fieldLabel: 'Setup fee',
      min: 0,
    }),
  };
}

function validateServicePackagePriceInput(payload) {
  if (payload.priceKsh === null) {
    throw new Error('Package price is required.');
  }

  if (!payload.currencyCode || payload.currencyCode.length !== 3) {
    throw new Error('Currency code must be a 3-letter code like KES.');
  }

  if (payload.billingCycle === 'monthly' && payload.billingPeriodMonths !== 1) {
    throw new Error('Monthly package pricing must use a 1-month billing period.');
  }

  if (payload.billingCycle === 'yearly' && payload.billingPeriodMonths !== 12) {
    throw new Error('Yearly package pricing must use a 12-month billing period.');
  }

  if (
    payload.billingCycle === 'custom' &&
    [1, 12].includes(payload.billingPeriodMonths)
  ) {
    throw new Error('Use monthly or yearly for 1-month and 12-month package pricing.');
  }

  if (payload.isDefault && !payload.isActive) {
    throw new Error('A default billing option must stay active.');
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
      r.registrar_code,
      r.name,
      r.primary_email,
      r.primary_phone,
      r.api_endpoint,
      r.notification_email,
      r.is_active,
      r.created_at,
      r.updated_at,
      COALESCE(key_summary.api_key_count, 0)::int AS api_key_count,
      COALESCE(key_summary.active_api_key_count, 0)::int AS active_api_key_count,
      key_summary.latest_api_key_prefix,
      key_summary.latest_api_key_status,
      key_summary.latest_api_key_expires_at,
      key_summary.latest_api_key_created_at,
      key_summary.latest_api_key_last_used_at,
      COALESCE(reg_summary.total_requests, 0)::int AS total_requests,
      COALESCE(reg_summary.processed_requests, 0)::int AS processed_requests,
      COALESCE(domain_summary.domain_extension_count, 0)::int AS domain_extension_count,
      COALESCE(service_summary.service_offering_count, 0)::int AS service_offering_count,
      COALESCE(package_summary.service_package_count, 0)::int AS service_package_count,
      COALESCE(price_summary.service_package_price_count, 0)::int AS service_package_price_count,
      COALESCE(bundle_summary.bundle_count, 0)::int AS bundle_count
    FROM registrars r
    LEFT JOIN LATERAL (
      SELECT
        COUNT(*)::int AS api_key_count,
        COUNT(*) FILTER (
          WHERE rak.status = 'active'
            AND (rak.expires_at IS NULL OR rak.expires_at > CURRENT_TIMESTAMP)
        )::int AS active_api_key_count,
        (ARRAY_AGG(rak.key_prefix ORDER BY rak.created_at DESC, rak.id DESC))[1] AS latest_api_key_prefix,
        (
          ARRAY_AGG(
            CASE
              WHEN rak.status = 'active'
                AND rak.expires_at IS NOT NULL
                AND rak.expires_at <= CURRENT_TIMESTAMP
              THEN 'expired'
              ELSE rak.status
            END
            ORDER BY rak.created_at DESC, rak.id DESC
          )
        )[1] AS latest_api_key_status,
        (ARRAY_AGG(rak.expires_at ORDER BY rak.created_at DESC, rak.id DESC))[1] AS latest_api_key_expires_at,
        (ARRAY_AGG(rak.created_at ORDER BY rak.created_at DESC, rak.id DESC))[1] AS latest_api_key_created_at,
        (ARRAY_AGG(rak.last_used_at ORDER BY rak.created_at DESC, rak.id DESC))[1] AS latest_api_key_last_used_at
      FROM domain_updater.registrar_api_keys rak
      WHERE rak.registrar_id = r.id
    ) key_summary ON TRUE
    LEFT JOIN LATERAL (
      SELECT
        COUNT(reg.request_id)::int AS total_requests,
        (COUNT(reg.request_id) FILTER (WHERE reg.pushed = true))::int AS processed_requests
      FROM registrations reg
      WHERE reg.registrar_id = r.id
        OR (
          reg.registrar_id IS NULL
          AND LOWER(COALESCE(reg.registrar_name, '')) = LOWER(r.name)
        )
    ) reg_summary ON TRUE
    LEFT JOIN LATERAL (
      SELECT COUNT(DISTINCT rdo.domain_extension_id)::int AS domain_extension_count
      FROM registrar_domain_offerings rdo
      WHERE rdo.registrar_id = r.id
        AND rdo.is_active = true
    ) domain_summary ON TRUE
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS service_offering_count
      FROM registrar_service_offerings rso
      WHERE rso.registrar_id = r.id
        AND rso.is_active = true
    ) service_summary ON TRUE
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS service_package_count
      FROM registrar_service_packages rsp
      WHERE rsp.registrar_id = r.id
        AND rsp.is_active = true
    ) package_summary ON TRUE
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS service_package_price_count
      FROM registrar_service_package_prices rspp
      INNER JOIN registrar_service_packages rsp
        ON rsp.id = rspp.service_package_id
      WHERE rsp.registrar_id = r.id
        AND rspp.is_active = true
    ) price_summary ON TRUE
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS bundle_count
      FROM bundle_templates bt
      WHERE bt.registrar_id = r.id
        AND bt.is_active = true
    ) bundle_summary ON TRUE
    ORDER BY r.is_active DESC, LOWER(r.name) ASC
  `);

  return result.rows;
}

async function getRegistrarById(registrarId) {
  const result = await pool.query(
    `
      SELECT
        r.id,
        r.registrar_code,
        r.name,
        r.primary_email,
        r.primary_phone,
        r.api_endpoint,
        r.notification_email,
        r.is_active,
        r.created_at,
        r.updated_at,
        COALESCE(key_summary.api_key_count, 0)::int AS api_key_count,
        COALESCE(key_summary.active_api_key_count, 0)::int AS active_api_key_count,
        key_summary.latest_api_key_prefix,
        key_summary.latest_api_key_status,
        key_summary.latest_api_key_expires_at,
        key_summary.latest_api_key_created_at,
        key_summary.latest_api_key_last_used_at,
        COALESCE(reg_summary.total_requests, 0)::int AS total_requests,
        COALESCE(reg_summary.processed_requests, 0)::int AS processed_requests,
        COALESCE(domain_summary.domain_extension_count, 0)::int AS domain_extension_count,
        COALESCE(service_summary.service_offering_count, 0)::int AS service_offering_count,
        COALESCE(package_summary.service_package_count, 0)::int AS service_package_count,
        COALESCE(price_summary.service_package_price_count, 0)::int AS service_package_price_count,
        COALESCE(bundle_summary.bundle_count, 0)::int AS bundle_count
      FROM registrars r
      LEFT JOIN LATERAL (
        SELECT
          COUNT(*)::int AS api_key_count,
          COUNT(*) FILTER (
            WHERE rak.status = 'active'
              AND (rak.expires_at IS NULL OR rak.expires_at > CURRENT_TIMESTAMP)
          )::int AS active_api_key_count,
          (ARRAY_AGG(rak.key_prefix ORDER BY rak.created_at DESC, rak.id DESC))[1] AS latest_api_key_prefix,
          (
            ARRAY_AGG(
              CASE
                WHEN rak.status = 'active'
                  AND rak.expires_at IS NOT NULL
                  AND rak.expires_at <= CURRENT_TIMESTAMP
                THEN 'expired'
                ELSE rak.status
              END
              ORDER BY rak.created_at DESC, rak.id DESC
            )
          )[1] AS latest_api_key_status,
          (ARRAY_AGG(rak.expires_at ORDER BY rak.created_at DESC, rak.id DESC))[1] AS latest_api_key_expires_at,
          (ARRAY_AGG(rak.created_at ORDER BY rak.created_at DESC, rak.id DESC))[1] AS latest_api_key_created_at,
          (ARRAY_AGG(rak.last_used_at ORDER BY rak.created_at DESC, rak.id DESC))[1] AS latest_api_key_last_used_at
        FROM domain_updater.registrar_api_keys rak
        WHERE rak.registrar_id = r.id
      ) key_summary ON TRUE
      LEFT JOIN LATERAL (
        SELECT
          COUNT(reg.request_id)::int AS total_requests,
          (COUNT(reg.request_id) FILTER (WHERE reg.pushed = true))::int AS processed_requests
        FROM registrations reg
        WHERE reg.registrar_id = r.id
          OR (
            reg.registrar_id IS NULL
            AND LOWER(COALESCE(reg.registrar_name, '')) = LOWER(r.name)
          )
      ) reg_summary ON TRUE
      LEFT JOIN LATERAL (
        SELECT COUNT(DISTINCT rdo.domain_extension_id)::int AS domain_extension_count
        FROM registrar_domain_offerings rdo
        WHERE rdo.registrar_id = r.id
          AND rdo.is_active = true
      ) domain_summary ON TRUE
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS service_offering_count
        FROM registrar_service_offerings rso
        WHERE rso.registrar_id = r.id
          AND rso.is_active = true
      ) service_summary ON TRUE
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS service_package_count
        FROM registrar_service_packages rsp
        WHERE rsp.registrar_id = r.id
          AND rsp.is_active = true
      ) package_summary ON TRUE
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS service_package_price_count
        FROM registrar_service_package_prices rspp
        INNER JOIN registrar_service_packages rsp
          ON rsp.id = rspp.service_package_id
        WHERE rsp.registrar_id = r.id
          AND rspp.is_active = true
      ) price_summary ON TRUE
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS bundle_count
        FROM bundle_templates bt
        WHERE bt.registrar_id = r.id
          AND bt.is_active = true
      ) bundle_summary ON TRUE
      WHERE r.id = $1
    `,
    [registrarId]
  );

  return result.rows[0] || null;
}

async function insertRegistrarPortalApiKey(client, registrar, options = {}) {
  return createPrimaryRegistrarApiKey(client, registrar, {
    actorId: normalizeNullableString(options.actorId) || 'admin',
    actorType: normalizeNullableString(options.actorType) || 'checkout_admin_tui',
    keyLabel: normalizeNullableString(options.keyLabel) || 'Primary Portal Key',
    revokeExisting: options.revokeExisting !== false,
    rotationReason:
      normalizeNullableString(options.rotationReason) || 'admin_rotation',
  });
}

async function createRegistrarPortalApiKey(registrarId, options = {}) {
  const registrar = await getRegistrarById(registrarId);

  if (!registrar) {
    throw new Error('Registrar not found.');
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const portalKey = await insertRegistrarPortalApiKey(client, registrar, options);
    await client.query('COMMIT');
    return portalKey;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function listDomainExtensions() {
  const result = await pool.query(`
    SELECT
      id,
      code,
      label,
      extension,
      category_key,
      sort_order,
      is_active
    FROM domain_extensions
    ORDER BY sort_order ASC, LOWER(label) ASC
  `);

  return result.rows;
}

async function listServiceProducts() {
  const result = await pool.query(`
    SELECT
      id,
      service_code,
      name,
      service_category,
      description,
      is_active
    FROM service_products
    ORDER BY LOWER(service_category) ASC, LOWER(name) ASC
  `);

  return result.rows;
}

async function listRegistrarDomainOfferings(registrarId) {
  const result = await pool.query(
    `
      SELECT
        rdo.id,
        rdo.registrar_id,
        rdo.domain_extension_id,
        rdo.registration_price_ksh,
        rdo.renewal_price_ksh,
        rdo.transfer_price_ksh,
        rdo.setup_fee_ksh,
        rdo.currency_code,
        rdo.billing_period_months,
        rdo.is_active,
        rdo.created_at,
        rdo.updated_at,
        de.code AS extension_code,
        de.label AS extension_label,
        de.extension,
        de.category_key,
        de.sort_order
      FROM registrar_domain_offerings rdo
      INNER JOIN domain_extensions de
        ON de.id = rdo.domain_extension_id
      WHERE rdo.registrar_id = $1
      ORDER BY de.sort_order ASC, LOWER(de.label) ASC, rdo.billing_period_months ASC
    `,
    [registrarId]
  );

  return result.rows;
}

async function listRegistrarServiceOfferings(registrarId) {
  const result = await pool.query(
    `
      SELECT
        rso.id,
        rso.registrar_id,
        rso.service_product_id,
        rso.plan_code,
        rso.plan_name,
        rso.billing_cycle,
        rso.billing_period_months,
        rso.price_ksh,
        rso.setup_fee_ksh,
        rso.currency_code,
        rso.features_json,
        rso.is_active,
        rso.created_at,
        rso.updated_at,
        sp.service_code,
        sp.name AS service_name,
        sp.service_category
      FROM registrar_service_offerings rso
      INNER JOIN service_products sp
        ON sp.id = rso.service_product_id
      WHERE rso.registrar_id = $1
      ORDER BY LOWER(sp.service_category) ASC, LOWER(sp.name) ASC, LOWER(rso.plan_name) ASC
    `,
    [registrarId]
  );

  return result.rows;
}

async function listRegistrarServicePackages(registrarId) {
  const result = await pool.query(
    `
      SELECT
        rsp.id,
        rsp.registrar_id,
        rsp.service_product_id,
        rsp.package_code,
        rsp.package_name,
        rsp.short_description,
        rsp.details_json,
        rsp.feature_bullets_json,
        rsp.display_order,
        rsp.is_active,
        rsp.created_at,
        rsp.updated_at,
        sp.service_code,
        sp.name AS service_name,
        sp.service_category,
        COALESCE(price_summary.price_count, 0)::int AS price_count,
        COALESCE(price_summary.active_price_count, 0)::int AS active_price_count,
        price_summary.default_price_id,
        price_summary.default_price_ksh,
        price_summary.default_billing_cycle,
        price_summary.default_billing_period_months,
        price_summary.default_currency_code
      FROM registrar_service_packages rsp
      INNER JOIN service_products sp
        ON sp.id = rsp.service_product_id
      LEFT JOIN LATERAL (
        SELECT
          COUNT(*)::int AS price_count,
          COUNT(*) FILTER (WHERE rspp.is_active = true)::int AS active_price_count,
          (ARRAY_AGG(rspp.id ORDER BY rspp.is_default DESC, rspp.is_active DESC, rspp.price_ksh ASC, rspp.billing_period_months ASC, rspp.created_at ASC))[1] AS default_price_id,
          (ARRAY_AGG(rspp.price_ksh ORDER BY rspp.is_default DESC, rspp.is_active DESC, rspp.price_ksh ASC, rspp.billing_period_months ASC, rspp.created_at ASC))[1] AS default_price_ksh,
          (ARRAY_AGG(rspp.billing_cycle ORDER BY rspp.is_default DESC, rspp.is_active DESC, rspp.price_ksh ASC, rspp.billing_period_months ASC, rspp.created_at ASC))[1] AS default_billing_cycle,
          (ARRAY_AGG(rspp.billing_period_months ORDER BY rspp.is_default DESC, rspp.is_active DESC, rspp.price_ksh ASC, rspp.billing_period_months ASC, rspp.created_at ASC))[1] AS default_billing_period_months,
          (ARRAY_AGG(rspp.currency_code ORDER BY rspp.is_default DESC, rspp.is_active DESC, rspp.price_ksh ASC, rspp.billing_period_months ASC, rspp.created_at ASC))[1] AS default_currency_code
        FROM registrar_service_package_prices rspp
        WHERE rspp.service_package_id = rsp.id
      ) price_summary ON TRUE
      WHERE rsp.registrar_id = $1
      ORDER BY
        LOWER(sp.service_category) ASC,
        LOWER(sp.name) ASC,
        rsp.display_order ASC,
        LOWER(rsp.package_name) ASC
    `,
    [registrarId]
  );

  return result.rows;
}

async function listRegistrarServicePackagePrices(registrarId, servicePackageId) {
  const result = await pool.query(
    `
      SELECT
        rspp.id,
        rspp.service_package_id,
        rspp.billing_cycle,
        rspp.billing_period_months,
        rspp.billing_label,
        rspp.price_ksh,
        rspp.setup_fee_ksh,
        rspp.currency_code,
        rspp.is_default,
        rspp.is_active,
        rspp.created_at,
        rspp.updated_at,
        rsp.package_code,
        rsp.package_name,
        rsp.short_description,
        rsp.is_active AS package_is_active,
        sp.service_code,
        sp.name AS service_name,
        sp.service_category
      FROM registrar_service_package_prices rspp
      INNER JOIN registrar_service_packages rsp
        ON rsp.id = rspp.service_package_id
      INNER JOIN service_products sp
        ON sp.id = rsp.service_product_id
      WHERE rsp.registrar_id = $1
        AND rspp.service_package_id = $2
      ORDER BY
        rspp.is_default DESC,
        rspp.billing_period_months ASC,
        rspp.price_ksh ASC,
        rspp.created_at ASC
    `,
    [registrarId, servicePackageId]
  );

  return result.rows;
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
          primary_email,
          primary_phone,
          api_endpoint,
          notification_email,
          is_active,
          updated_by_actor_type,
          updated_by_actor_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id
      `,
      [
        input.name,
        input.primaryEmail,
        input.primaryPhone,
        input.apiEndpoint,
        input.notificationEmail || input.primaryEmail,
        input.isActive,
        'admin_tui',
        null,
      ]
    );

    const registrarResult = await client.query(
      `
        SELECT
          id,
          registrar_code,
          name,
          primary_email,
          primary_phone,
          notification_email,
          api_endpoint,
          is_active
        FROM registrars
        WHERE id = $1
        LIMIT 1
      `,
      [result.rows[0].id]
    );

    const createdRegistrar = registrarResult.rows[0];

    if (!createdRegistrar) {
      throw new Error('Registrar could not be loaded after creation.');
    }

    const portalKey = await insertRegistrarPortalApiKey(client, createdRegistrar, {
      actorId: 'admin',
      actorType: 'checkout_admin_tui',
      keyLabel: 'Primary Portal Key',
      rotationReason: 'initial_onboarding',
    });

    await client.query('COMMIT');

    const registrar = await getRegistrarById(result.rows[0].id);
    const onboardingEmail = await sendRegistrarOnboardingEmail({
      apiKey: portalKey.apiKey,
      registrar: createdRegistrar,
    });

    return {
      onboarding: {
        ...portalKey,
        emailDelivery: onboardingEmail,
      },
      registrar,
    };
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
            primary_email = $3,
            primary_phone = $4,
            api_endpoint = $5,
            notification_email = $6,
            is_active = $7,
            updated_at = CURRENT_TIMESTAMP,
            updated_by_actor_type = $8,
            updated_by_actor_id = $9
        WHERE id = $1
      `,
      [
        registrarId,
        input.name,
        input.primaryEmail,
        input.primaryPhone,
        input.apiEndpoint,
        input.notificationEmail || input.primaryEmail,
        input.isActive,
        'admin_tui',
        null,
      ]
    );

    if (currentRegistrar.name.toLowerCase() !== input.name.toLowerCase()) {
      await client.query(
        `
          UPDATE registrations
          SET registrar_name = $2
          WHERE registrar_id = $3
            OR (
              registrar_id IS NULL
              AND LOWER(registrar_name) = LOWER($1)
            )
        `,
        [currentRegistrar.name, input.name, registrarId]
      );

      await client.query(
        `
          UPDATE registrar_requests
          SET registrar_name = $2
          WHERE registrar_id = $3
            OR (
              registrar_id IS NULL
              AND LOWER(registrar_name) = LOWER($1)
            )
        `,
        [currentRegistrar.name, input.name, registrarId]
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
      SET is_active = NOT is_active,
          updated_at = CURRENT_TIMESTAMP,
          updated_by_actor_type = 'admin_tui',
          updated_by_actor_id = NULL
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

async function saveRegistrarDomainOffering(registrarId, payload) {
  const input = normalizeDomainOfferingInput(payload);
  validateDomainOfferingInput(input);

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const [registrarResult, domainExtensionResult] = await Promise.all([
      client.query(
        `
          SELECT id
          FROM registrars
          WHERE id = $1
          LIMIT 1
        `,
        [registrarId]
      ),
      client.query(
        `
          SELECT id
          FROM domain_extensions
          WHERE id = $1
          LIMIT 1
        `,
        [input.domainExtensionId]
      ),
    ]);

    if (!registrarResult.rows.length) {
      throw new Error('Registrar not found.');
    }

    if (!domainExtensionResult.rows.length) {
      throw new Error('Domain extension not found.');
    }

    if (input.offeringId) {
      const existingOfferResult = await client.query(
        `
          SELECT id
          FROM registrar_domain_offerings
          WHERE id = $1
            AND registrar_id = $2
          LIMIT 1
        `,
        [input.offeringId, registrarId]
      );

      if (!existingOfferResult.rows.length) {
        throw new Error('Domain offering not found.');
      }

      await client.query(
        `
          UPDATE registrar_domain_offerings
          SET domain_extension_id = $2,
              registration_price_ksh = $3,
              renewal_price_ksh = $4,
              transfer_price_ksh = $5,
              billing_period_months = $6,
              is_active = $7,
              setup_fee_ksh = 0,
              currency_code = 'KES',
              updated_at = NOW()
          WHERE id = $1
        `,
        [
          input.offeringId,
          input.domainExtensionId,
          input.registrationPriceKsh,
          input.renewalPriceKsh,
          input.transferPriceKsh,
          input.billingPeriodMonths,
          input.isActive,
        ]
      );
    } else {
      const existingByKeyResult = await client.query(
        `
          SELECT id
          FROM registrar_domain_offerings
          WHERE registrar_id = $1
            AND domain_extension_id = $2
            AND billing_period_months = $3
          LIMIT 1
        `,
        [registrarId, input.domainExtensionId, input.billingPeriodMonths]
      );

      if (existingByKeyResult.rows.length) {
        await client.query(
          `
            UPDATE registrar_domain_offerings
            SET registration_price_ksh = $2,
                renewal_price_ksh = $3,
                transfer_price_ksh = $4,
                is_active = $5,
                setup_fee_ksh = 0,
                currency_code = 'KES',
                updated_at = NOW()
            WHERE id = $1
          `,
          [
            existingByKeyResult.rows[0].id,
            input.registrationPriceKsh,
            input.renewalPriceKsh,
            input.transferPriceKsh,
            input.isActive,
          ]
        );
      } else {
        await client.query(
          `
            INSERT INTO registrar_domain_offerings (
              registrar_id,
              domain_extension_id,
              registration_price_ksh,
              renewal_price_ksh,
              transfer_price_ksh,
              setup_fee_ksh,
              currency_code,
              billing_period_months,
              is_active
            )
            VALUES ($1, $2, $3, $4, $5, 0, 'KES', $6, $7)
          `,
          [
            registrarId,
            input.domainExtensionId,
            input.registrationPriceKsh,
            input.renewalPriceKsh,
            input.transferPriceKsh,
            input.billingPeriodMonths,
            input.isActive,
          ]
        );
      }
    }

    await client.query('COMMIT');

    return listRegistrarDomainOfferings(registrarId);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function toggleRegistrarDomainOfferingActive(registrarId, offeringId) {
  const result = await pool.query(
    `
      UPDATE registrar_domain_offerings
      SET is_active = NOT is_active,
          updated_at = NOW()
      WHERE id = $1
        AND registrar_id = $2
      RETURNING id
    `,
    [offeringId, registrarId]
  );

  if (!result.rows.length) {
    throw new Error('Domain offering not found.');
  }

  return listRegistrarDomainOfferings(registrarId);
}

async function saveRegistrarServiceOffering(registrarId, payload) {
  const selectedServiceProductId = normalizeString(payload.serviceProductId);
  const serviceProductResult = await pool.query(
    `
      SELECT id, service_code, name
      FROM service_products
      WHERE id = $1
      LIMIT 1
    `,
    [selectedServiceProductId]
  );
  const serviceProduct = serviceProductResult.rows[0] || null;
  const input = normalizeServiceOfferingInput(payload, serviceProduct);
  validateServiceOfferingInput(input);

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const [registrarResult, verifiedServiceProductResult] = await Promise.all([
      client.query(
        `
          SELECT id
          FROM registrars
          WHERE id = $1
          LIMIT 1
        `,
        [registrarId]
      ),
      client.query(
        `
          SELECT id
          FROM service_products
          WHERE id = $1
          LIMIT 1
        `,
        [input.serviceProductId]
      ),
    ]);

    if (!registrarResult.rows.length) {
      throw new Error('Registrar not found.');
    }

    if (!verifiedServiceProductResult.rows.length) {
      throw new Error('Service product not found.');
    }

    if (input.offeringId) {
      const existingOfferResult = await client.query(
        `
          SELECT id
          FROM registrar_service_offerings
          WHERE id = $1
            AND registrar_id = $2
          LIMIT 1
        `,
        [input.offeringId, registrarId]
      );

      if (!existingOfferResult.rows.length) {
        throw new Error('Service offering not found.');
      }

      await client.query(
        `
          UPDATE registrar_service_offerings
          SET service_product_id = $2,
              plan_code = $3,
              plan_name = $4,
              billing_cycle = $5,
              billing_period_months = $6,
              price_ksh = $7,
              setup_fee_ksh = 0,
              currency_code = 'KES',
              features_json = '{}'::jsonb,
              is_active = $8,
              updated_at = NOW()
          WHERE id = $1
        `,
        [
          input.offeringId,
          input.serviceProductId,
          input.planCode,
          input.planName,
          input.billingCycle,
          input.billingPeriodMonths,
          input.priceKsh,
          input.isActive,
        ]
      );
    } else {
      const existingByKeyResult = await client.query(
        `
          SELECT id
          FROM registrar_service_offerings
          WHERE registrar_id = $1
            AND service_product_id = $2
            AND plan_code = $3
          LIMIT 1
        `,
        [registrarId, input.serviceProductId, input.planCode]
      );

      if (existingByKeyResult.rows.length) {
        await client.query(
          `
            UPDATE registrar_service_offerings
            SET plan_name = $2,
                billing_cycle = $3,
                billing_period_months = $4,
                price_ksh = $5,
                setup_fee_ksh = 0,
                currency_code = 'KES',
                features_json = '{}'::jsonb,
                is_active = $6,
                updated_at = NOW()
            WHERE id = $1
          `,
          [
            existingByKeyResult.rows[0].id,
            input.planName,
            input.billingCycle,
            input.billingPeriodMonths,
            input.priceKsh,
            input.isActive,
          ]
        );
      } else {
        await client.query(
          `
            INSERT INTO registrar_service_offerings (
              registrar_id,
              service_product_id,
              plan_code,
              plan_name,
              billing_cycle,
              billing_period_months,
              price_ksh,
              setup_fee_ksh,
              currency_code,
              features_json,
              is_active
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, 0, 'KES', '{}'::jsonb, $8)
          `,
          [
            registrarId,
            input.serviceProductId,
            input.planCode,
            input.planName,
            input.billingCycle,
            input.billingPeriodMonths,
            input.priceKsh,
            input.isActive,
          ]
        );
      }
    }

    await client.query('COMMIT');

    return listRegistrarServiceOfferings(registrarId);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function toggleRegistrarServiceOfferingActive(registrarId, offeringId) {
  const result = await pool.query(
    `
      UPDATE registrar_service_offerings
      SET is_active = NOT is_active,
          updated_at = NOW()
      WHERE id = $1
        AND registrar_id = $2
      RETURNING id
    `,
    [offeringId, registrarId]
  );

  if (!result.rows.length) {
    throw new Error('Service offering not found.');
  }

  return listRegistrarServiceOfferings(registrarId);
}

async function rebalanceServicePackageDefaultPrice(
  client,
  servicePackageId,
  preferredPriceId = null
) {
  const priceResult = await client.query(
    `
      SELECT id, is_active, is_default, price_ksh, billing_period_months, created_at
      FROM registrar_service_package_prices
      WHERE service_package_id = $1
      ORDER BY
        is_active DESC,
        is_default DESC,
        price_ksh ASC,
        billing_period_months ASC,
        created_at ASC
    `,
    [servicePackageId]
  );

  const prices = priceResult.rows;

  if (!prices.length) {
    return null;
  }

  let targetPrice = null;

  if (preferredPriceId) {
    targetPrice =
      prices.find(
        (price) => price.id === preferredPriceId && price.is_active
      ) || null;
  }

  if (!targetPrice) {
    targetPrice = prices.find((price) => price.is_default && price.is_active) || null;
  }

  if (!targetPrice) {
    targetPrice = prices.find((price) => price.is_active) || prices[0];
  }

  await client.query(
    `
      UPDATE registrar_service_package_prices
      SET is_default = CASE WHEN id = $2 THEN true ELSE false END,
          updated_at = NOW()
      WHERE service_package_id = $1
    `,
    [servicePackageId, targetPrice.id]
  );

  return targetPrice.id;
}

async function saveRegistrarServicePackage(registrarId, payload) {
  const selectedServiceProductId = normalizeString(payload.serviceProductId);
  const serviceProductResult = await pool.query(
    `
      SELECT id, service_code, name
      FROM service_products
      WHERE id = $1
      LIMIT 1
    `,
    [selectedServiceProductId]
  );
  const serviceProduct = serviceProductResult.rows[0] || null;
  const input = normalizeServicePackageInput(payload, serviceProduct);
  validateServicePackageInput(input);

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const [registrarResult, verifiedServiceProductResult] = await Promise.all([
      client.query(
        `
          SELECT id
          FROM registrars
          WHERE id = $1
          LIMIT 1
        `,
        [registrarId]
      ),
      client.query(
        `
          SELECT id
          FROM service_products
          WHERE id = $1
          LIMIT 1
        `,
        [input.serviceProductId]
      ),
    ]);

    if (!registrarResult.rows.length) {
      throw new Error('Registrar not found.');
    }

    if (!verifiedServiceProductResult.rows.length) {
      throw new Error('Service product not found.');
    }

    if (input.packageId) {
      const existingPackageResult = await client.query(
        `
          SELECT id
          FROM registrar_service_packages
          WHERE id = $1
            AND registrar_id = $2
          LIMIT 1
        `,
        [input.packageId, registrarId]
      );

      if (!existingPackageResult.rows.length) {
        throw new Error('Service package not found.');
      }

      const duplicatePackageResult = await client.query(
        `
          SELECT id
          FROM registrar_service_packages
          WHERE registrar_id = $1
            AND service_product_id = $2
            AND package_code = $3
            AND id <> $4
          LIMIT 1
        `,
        [registrarId, input.serviceProductId, input.packageCode, input.packageId]
      );

      if (duplicatePackageResult.rows.length) {
        throw new Error('A package with that code already exists for this service.');
      }

      await client.query(
        `
          UPDATE registrar_service_packages
          SET service_product_id = $2,
              package_code = $3,
              package_name = $4,
              short_description = $5,
              details_json = $6,
              feature_bullets_json = $7,
              display_order = $8,
              is_active = $9,
              updated_at = NOW()
          WHERE id = $1
        `,
        [
          input.packageId,
          input.serviceProductId,
          input.packageCode,
          input.packageName,
          input.shortDescription,
          input.detailsJson,
          JSON.stringify(input.featureBulletsJson),
          input.displayOrder,
          input.isActive,
        ]
      );
    } else {
      const existingByKeyResult = await client.query(
        `
          SELECT id
          FROM registrar_service_packages
          WHERE registrar_id = $1
            AND service_product_id = $2
            AND package_code = $3
          LIMIT 1
        `,
        [registrarId, input.serviceProductId, input.packageCode]
      );

      if (existingByKeyResult.rows.length) {
        await client.query(
          `
            UPDATE registrar_service_packages
            SET package_name = $2,
                short_description = $3,
                details_json = $4,
                feature_bullets_json = $5,
                display_order = $6,
                is_active = $7,
                updated_at = NOW()
            WHERE id = $1
          `,
          [
            existingByKeyResult.rows[0].id,
            input.packageName,
            input.shortDescription,
            input.detailsJson,
            JSON.stringify(input.featureBulletsJson),
            input.displayOrder,
            input.isActive,
          ]
        );
      } else {
        await client.query(
          `
            INSERT INTO registrar_service_packages (
              registrar_id,
              service_product_id,
              package_code,
              package_name,
              short_description,
              details_json,
              feature_bullets_json,
              display_order,
              is_active
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          `,
          [
            registrarId,
            input.serviceProductId,
            input.packageCode,
            input.packageName,
            input.shortDescription,
            input.detailsJson,
            JSON.stringify(input.featureBulletsJson),
            input.displayOrder,
            input.isActive,
          ]
        );
      }
    }

    await client.query('COMMIT');

    return listRegistrarServicePackages(registrarId);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function toggleRegistrarServicePackageActive(registrarId, packageId) {
  const result = await pool.query(
    `
      UPDATE registrar_service_packages
      SET is_active = NOT is_active,
          updated_at = NOW()
      WHERE id = $1
        AND registrar_id = $2
      RETURNING id
    `,
    [packageId, registrarId]
  );

  if (!result.rows.length) {
    throw new Error('Service package not found.');
  }

  return listRegistrarServicePackages(registrarId);
}

async function deleteRegistrarServicePackage(registrarId, packageId) {
  const result = await pool.query(
    `
      DELETE FROM registrar_service_packages
      WHERE id = $1
        AND registrar_id = $2
      RETURNING id
    `,
    [packageId, registrarId]
  );

  if (!result.rows.length) {
    throw new Error('Service package not found.');
  }

  return listRegistrarServicePackages(registrarId);
}

async function saveRegistrarServicePackagePrice(registrarId, servicePackageId, payload) {
  const input = normalizeServicePackagePriceInput(payload);
  validateServicePackagePriceInput(input);

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const packageResult = await client.query(
      `
        SELECT id
        FROM registrar_service_packages
        WHERE id = $1
          AND registrar_id = $2
        LIMIT 1
      `,
      [servicePackageId, registrarId]
    );

    if (!packageResult.rows.length) {
      throw new Error('Service package not found.');
    }

    const existingPriceRowsResult = await client.query(
      `
        SELECT id, is_active, is_default, price_ksh, billing_period_months, created_at
        FROM registrar_service_package_prices
        WHERE service_package_id = $1
        ORDER BY
          is_default DESC,
          is_active DESC,
          price_ksh ASC,
          billing_period_months ASC,
          created_at ASC
      `,
      [servicePackageId]
    );

    const existingPriceRows = existingPriceRowsResult.rows;
    let targetPriceId = null;

    if (input.priceId) {
      const existingPriceResult = await client.query(
        `
          SELECT id
          FROM registrar_service_package_prices
          WHERE id = $1
            AND service_package_id = $2
          LIMIT 1
        `,
        [input.priceId, servicePackageId]
      );

      if (!existingPriceResult.rows.length) {
        throw new Error('Package price not found.');
      }

      const updatedPriceResult = await client.query(
        `
          UPDATE registrar_service_package_prices
          SET billing_cycle = $2,
              billing_period_months = $3,
              billing_label = $4,
              price_ksh = $5,
              setup_fee_ksh = $6,
              currency_code = $7,
              is_active = $8,
              updated_at = NOW()
          WHERE id = $1
          RETURNING id
        `,
        [
          input.priceId,
          input.billingCycle,
          input.billingPeriodMonths,
          input.billingLabel,
          input.priceKsh,
          input.setupFeeKsh,
          input.currencyCode,
          input.isActive,
        ]
      );

      targetPriceId = updatedPriceResult.rows[0].id;
    } else {
      const existingPrice = existingPriceRows[0] || null;

      if (existingPrice) {
        const updatedPriceResult = await client.query(
          `
            UPDATE registrar_service_package_prices
            SET billing_cycle = $2,
                billing_period_months = $3,
                billing_label = $4,
                price_ksh = $5,
                setup_fee_ksh = $6,
                currency_code = $7,
                is_active = $8,
                updated_at = NOW()
            WHERE id = $1
            RETURNING id
          `,
          [
            existingPrice.id,
            input.billingCycle,
            input.billingPeriodMonths,
            input.billingLabel,
            input.priceKsh,
            input.setupFeeKsh,
            input.currencyCode,
            input.isActive,
          ]
        );

        targetPriceId = updatedPriceResult.rows[0].id;
      } else {
        const insertedPriceResult = await client.query(
          `
            INSERT INTO registrar_service_package_prices (
              service_package_id,
              billing_cycle,
              billing_period_months,
              billing_label,
              price_ksh,
              setup_fee_ksh,
              currency_code,
              is_default,
              is_active
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, false, $8)
            RETURNING id
          `,
          [
            servicePackageId,
            input.billingCycle,
            input.billingPeriodMonths,
            input.billingLabel,
            input.priceKsh,
            input.setupFeeKsh,
            input.currencyCode,
            input.isActive,
          ]
        );

        targetPriceId = insertedPriceResult.rows[0].id;
      }
    }

    await client.query(
      `
        DELETE FROM registrar_service_package_prices
        WHERE service_package_id = $1
          AND id <> $2
      `,
      [servicePackageId, targetPriceId]
    );

    await rebalanceServicePackageDefaultPrice(
      client,
      servicePackageId,
      input.isDefault ? targetPriceId : null
    );

    await client.query('COMMIT');

    return listRegistrarServicePackagePrices(registrarId, servicePackageId);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function deleteRegistrarServicePackagePrice(
  registrarId,
  servicePackageId,
  priceId
) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const packageResult = await client.query(
      `
        SELECT id
        FROM registrar_service_packages
        WHERE id = $1
          AND registrar_id = $2
        LIMIT 1
      `,
      [servicePackageId, registrarId]
    );

    if (!packageResult.rows.length) {
      throw new Error('Service package not found.');
    }

    const deletedPriceResult = await client.query(
      `
        DELETE FROM registrar_service_package_prices
        WHERE id = $1
          AND service_package_id = $2
        RETURNING id
      `,
      [priceId, servicePackageId]
    );

    if (!deletedPriceResult.rows.length) {
      throw new Error('Package price not found.');
    }

    await rebalanceServicePackageDefaultPrice(client, servicePackageId);
    await client.query('COMMIT');

    return listRegistrarServicePackagePrices(registrarId, servicePackageId);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function toggleRegistrarServicePackagePriceActive(
  registrarId,
  servicePackageId,
  priceId
) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const packageResult = await client.query(
      `
        SELECT id
        FROM registrar_service_packages
        WHERE id = $1
          AND registrar_id = $2
        LIMIT 1
      `,
      [servicePackageId, registrarId]
    );

    if (!packageResult.rows.length) {
      throw new Error('Service package not found.');
    }

    const result = await client.query(
      `
        UPDATE registrar_service_package_prices
        SET is_active = NOT is_active,
            updated_at = NOW()
        WHERE id = $1
          AND service_package_id = $2
        RETURNING id
      `,
      [priceId, servicePackageId]
    );

    if (!result.rows.length) {
      throw new Error('Package price not found.');
    }

    await rebalanceServicePackageDefaultPrice(client, servicePackageId);
    await client.query('COMMIT');

    return listRegistrarServicePackagePrices(registrarId, servicePackageId);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function setRegistrarServicePackagePriceDefault(
  registrarId,
  servicePackageId,
  priceId
) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const result = await client.query(
      `
        SELECT rspp.id, rspp.is_active
        FROM registrar_service_package_prices rspp
        INNER JOIN registrar_service_packages rsp
          ON rsp.id = rspp.service_package_id
        WHERE rspp.id = $1
          AND rspp.service_package_id = $2
          AND rsp.registrar_id = $3
        LIMIT 1
      `,
      [priceId, servicePackageId, registrarId]
    );

    if (!result.rows.length) {
      throw new Error('Package price not found.');
    }

    if (!result.rows[0].is_active) {
      throw new Error('Only active billing options can be set as default.');
    }

    await rebalanceServicePackageDefaultPrice(client, servicePackageId, priceId);
    await client.query('COMMIT');

    return listRegistrarServicePackagePrices(registrarId, servicePackageId);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
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
        r.domain_extension,
        r.target_service,
        r.product_family,
        r.selection_kind,
        r.package_code,
        r.package_name,
        r.billing_cycle,
        r.billing_period_months,
        r.currency_code,
        r.quoted_price_ksh,
        r.selection_snapshot_json,
        r.registrar_name,
        r.registrar_reference_id,
        r.status,
        r.message_sent,
        r.pushed,
        r.created_at,
        r.updated_at,
        COALESCE(r.registrar_id, reg.id) AS registrar_id,
        reg.registrar_code,
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
        ON reg.id = r.registrar_id
        OR (
          r.registrar_id IS NULL
          AND LOWER(reg.name) = LOWER(r.registrar_name)
        )
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
  createRegistrarPortalApiKey,
  deleteRegistrarServicePackage,
  deleteRegistrarServicePackagePrice,
  getDashboardData,
  getRegistrationByExternalReference,
  getRegistrarById,
  listDomainExtensions,
  listFailedPushes,
  listRecentDeliveryLogs,
  listRegistrars,
  listRegistrarDomainOfferings,
  listRegistrarServicePackagePrices,
  listRegistrarServicePackages,
  listRegistrarServiceOfferings,
  listServiceProducts,
  retryAllFailedPushes,
  retryFailedPush,
  saveRegistrarDomainOffering,
  saveRegistrarServicePackage,
  saveRegistrarServicePackagePrice,
  saveRegistrarServiceOffering,
  setRegistrarServicePackagePriceDefault,
  toggleRegistrarActive,
  toggleRegistrarDomainOfferingActive,
  toggleRegistrarServicePackageActive,
  toggleRegistrarServicePackagePriceActive,
  toggleRegistrarServiceOfferingActive,
  updateRegistrar,
};
