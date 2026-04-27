const { randomInt } = require('crypto');
const pool = require('../db');
const { sendSms } = require('./sms');
const { sendEmail, isEmailConfigured } = require('./email');
const { DELIVERY_STATUS, runDeliveryWithRetry } = require('./notificationService');
const {
  formatDomainName,
  normalizeRegistrationInput,
} = require('../utils/validation');

const PUBLIC_REFERENCE_DIGITS = '23456789';
const PUBLIC_REFERENCE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const PUBLIC_REFERENCE_CHARSET = `${PUBLIC_REFERENCE_LETTERS}${PUBLIC_REFERENCE_DIGITS}`;
const PUBLIC_REFERENCE_LENGTH = 10;

const PRODUCT_FAMILY_ALIASES = {
  domain: 'domain_registration',
  domains: 'domain_registration',
  email: 'emails',
  emails: 'emails',
  mail: 'emails',
  security: 'security',
  server: 'servers',
  servers: 'servers',
  ssl: 'security',
  tls: 'security',
  vps: 'servers',
};

function getBillingCycleFromMonths(billingPeriodMonths) {
  const normalizedBillingPeriodMonths = Number(billingPeriodMonths);

  if (normalizedBillingPeriodMonths === 1) {
    return 'monthly';
  }

  if (normalizedBillingPeriodMonths === 12) {
    return 'yearly';
  }

  if (Number.isFinite(normalizedBillingPeriodMonths) && normalizedBillingPeriodMonths > 0) {
    return 'custom';
  }

  return 'flexible';
}

function getBillingLabel({ billingCycle, billingPeriodMonths, billingLabel }) {
  if (typeof billingLabel === 'string' && billingLabel.trim()) {
    return billingLabel.trim();
  }

  const normalizedBillingCycle =
    typeof billingCycle === 'string' ? billingCycle.trim().toLowerCase() : '';
  const normalizedBillingPeriodMonths = Number(billingPeriodMonths);

  if (normalizedBillingCycle === 'monthly' || normalizedBillingPeriodMonths === 1) {
    return 'Monthly';
  }

  if (normalizedBillingCycle === 'yearly' || normalizedBillingPeriodMonths === 12) {
    return 'Yearly';
  }

  if (Number.isFinite(normalizedBillingPeriodMonths) && normalizedBillingPeriodMonths > 0) {
    return `${normalizedBillingPeriodMonths} months`;
  }

  return 'Flexible';
}

function normalizeProductFamilyValue(value) {
  const normalized =
    typeof value === 'string'
      ? value.trim().toLowerCase().replace(/[\s-]+/g, '_')
      : '';

  return PRODUCT_FAMILY_ALIASES[normalized] || normalized;
}

function getProductFamilyFromServiceCode(serviceCode) {
  const normalizedServiceCode =
    typeof serviceCode === 'string' ? serviceCode.trim().toLowerCase() : '';

  if (['shared_hosting', 'web_hosting'].includes(normalizedServiceCode)) {
    return 'hosting';
  }

  if (normalizedServiceCode === 'email_hosting') {
    return 'emails';
  }

  if (normalizedServiceCode === 'vps_hosting') {
    return 'servers';
  }

  if (normalizedServiceCode === 'wordpress_hosting') {
    return 'hosting';
  }

  if (normalizedServiceCode === 'ssl') {
    return 'security';
  }

  return normalizeProductFamilyValue(normalizedServiceCode) || '';
}

function normalizeJsonObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeTextArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean);
}

function normalizeTextValue(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function formatPrice(amount, currencyCode) {
  if (amount === null || amount === undefined || Number.isNaN(Number(amount))) {
    return 'On request';
  }

  return new Intl.NumberFormat('en-KE', {
    style: 'currency',
    currency: currencyCode || 'KES',
    maximumFractionDigits: 0,
  }).format(Number(amount));
}

function humanizeProductFamily(value) {
  return normalizeTextValue(value).replace(/_/g, ' ');
}

function titleCase(value) {
  return value.replace(/\b\w/g, (character) => character.toUpperCase());
}

function getProductFamilyCopy(productFamily) {
  const family = normalizeProductFamilyValue(productFamily);

  switch (family) {
    case 'domain_registration':
      return {
        descriptorKeywords: ['domain'],
        offeringLabel: 'domain registration',
        productLabel: 'Domain Registration',
      };
    case 'hosting':
      return {
        descriptorKeywords: ['hosting'],
        offeringLabel: 'hosting plan',
        productLabel: 'Hosting',
      };
    case 'emails':
      return {
        descriptorKeywords: ['email', 'mail', 'mailbox'],
        offeringLabel: 'email service',
        productLabel: 'Emails',
      };
    case 'servers':
      return {
        descriptorKeywords: ['vps', 'server', 'cloud'],
        offeringLabel: 'server plan',
        productLabel: 'Servers',
      };
    case 'security':
      return {
        descriptorKeywords: ['security', 'ssl', 'certificate', 'tls'],
        offeringLabel: 'security service',
        productLabel: 'Security',
      };
    case 'bundle':
      return {
        descriptorKeywords: ['bundle', 'package'],
        offeringLabel: 'package',
        productLabel: 'Package',
      };
    default: {
      const humanizedFamily = humanizeProductFamily(family || 'service');

      return {
        descriptorKeywords: humanizedFamily
          .split(/\s+/)
          .map((token) => token.toLowerCase())
          .filter(Boolean),
        offeringLabel: humanizedFamily || 'service',
        productLabel: titleCase(humanizedFamily || 'service'),
      };
    }
  }
}

function buildServiceSelectionLabel({ serviceTypeName, packageName }) {
  const normalizedServiceTypeName = normalizeTextValue(serviceTypeName);
  const normalizedPackageName = normalizeTextValue(packageName);

  if (normalizedServiceTypeName && normalizedPackageName) {
    const lowerServiceTypeName = normalizedServiceTypeName.toLowerCase();
    const lowerPackageName = normalizedPackageName.toLowerCase();

    if (
      lowerServiceTypeName === lowerPackageName ||
      lowerPackageName.includes(lowerServiceTypeName)
    ) {
      return normalizedPackageName;
    }

    if (lowerServiceTypeName.includes(lowerPackageName)) {
      return normalizedServiceTypeName;
    }

    return `${normalizedServiceTypeName} (${normalizedPackageName})`;
  }

  return normalizedServiceTypeName || normalizedPackageName || '';
}

function getRegistrationSnapshot(registration) {
  return normalizeJsonObject(registration.selection_snapshot_json);
}

function getNormalizedProductFamily(registration) {
  const snapshot = getRegistrationSnapshot(registration);
  const snapshotProductFamily = normalizeProductFamilyValue(snapshot.product_family);
  const registrationProductFamily = normalizeProductFamilyValue(
    registration.product_family
  );
  const targetService = normalizeProductFamilyValue(registration.target_service);
  const serviceProductCode =
    normalizeTextValue(registration.service_product_code) ||
    normalizeTextValue(snapshot.service_product_code);

  const resolvedProductFamily =
    registrationProductFamily ||
    snapshotProductFamily ||
    (targetService === 'domain_registration_only' ? 'domain_registration' : targetService) ||
    getProductFamilyFromServiceCode(serviceProductCode);

  return resolvedProductFamily === 'domain_registration_only'
    ? 'domain_registration'
    : resolvedProductFamily;
}

function getSelectionDetails(registration) {
  const snapshot = getRegistrationSnapshot(registration);

  return {
    packageName:
      normalizeTextValue(snapshot.package) ||
      normalizeTextValue(registration.package_name) ||
      normalizeTextValue(snapshot.package_name),
    serviceTypeName:
      normalizeTextValue(snapshot.type) ||
      normalizeTextValue(snapshot.service_name) ||
      normalizeTextValue(snapshot.service_type_name) ||
      normalizeTextValue(snapshot.summary_label),
  };
}

function isDomainOnlySelection(registration) {
  return (
    registration.selection_kind === 'domain' ||
    registration.target_service === 'domain_registration_only' ||
    registration.target_service === 'domain_registration' ||
    getNormalizedProductFamily(registration) === 'domain_registration'
  );
}

function getNumericSnapshotValue(snapshot, keys = []) {
  for (const key of keys) {
    const value = snapshot ? snapshot[key] : null;

    if (value === null || value === undefined || value === '') {
      continue;
    }

    const normalizedValue = Number(value);
    if (Number.isFinite(normalizedValue)) {
      return normalizedValue;
    }
  }

  return null;
}

function buildSelectionSummary(registration) {
  const snapshot = getRegistrationSnapshot(registration);
  const formattedDomain = formatDomainName(registration.domain_name) || 'your selected domain';
  const isDomainOnly = isDomainOnlySelection(registration);
  const productFamily = getNormalizedProductFamily(registration);
  const { productLabel } = getProductFamilyCopy(productFamily);
  const { packageName, serviceTypeName } = getSelectionDetails(registration);
  const plusService =
    normalizeTextValue(snapshot.plus) ||
    (!isDomainOnly ? productLabel : '');
  const period =
    normalizeTextValue(snapshot.period) ||
    getBillingLabel({
      billingCycle: registration.billing_cycle,
      billingLabel: normalizeTextValue(snapshot.billing_label),
      billingPeriodMonths: registration.billing_period_months,
    });
  const currencyCode =
    normalizeTextValue(snapshot.currency_code) ||
    normalizeTextValue(registration.currency_code) ||
    'KES';
  const priceKsh =
    getNumericSnapshotValue(snapshot, ['price_ksh', 'quoted_price_ksh']) ??
    (registration.quoted_price_ksh === null || registration.quoted_price_ksh === undefined
      ? null
      : Number(registration.quoted_price_ksh));

  return {
    currencyCode,
    domainExtension:
      normalizeTextValue(snapshot.domain_extension) ||
      normalizeTextValue(registration.domain_extension) ||
      null,
    formattedDomain,
    isDomainOnly,
    packageName: !isDomainOnly && packageName ? packageName : null,
    period: period || null,
    plusService: !isDomainOnly && plusService ? plusService : null,
    priceKsh,
    registrarName:
      normalizeTextValue(snapshot.registrar_name) || getSafeRegistrarName(registration),
    serviceTypeName: !isDomainOnly && serviceTypeName ? serviceTypeName : null,
  };
}

function buildSelectionSnapshotSummary({
  currency_code,
  domain_extension,
  domain_name,
  packageName,
  period,
  plus,
  price_ksh,
  registrar_name,
  type,
}) {
  return {
    currency_code: normalizeTextValue(currency_code) || null,
    domain_extension: normalizeTextValue(domain_extension) || null,
    domain_name: formatDomainName(domain_name),
    package: normalizeTextValue(packageName) || null,
    period: normalizeTextValue(period) || null,
    plus: normalizeTextValue(plus) || null,
    price_ksh:
      price_ksh === null || price_ksh === undefined || Number.isNaN(Number(price_ksh))
        ? null
        : Number(price_ksh),
    registrar_name: normalizeTextValue(registrar_name) || null,
    type: normalizeTextValue(type) || null,
  };
}

function buildPurchaseCopy(registration) {
  const {
    formattedDomain,
    isDomainOnly,
    packageName,
    plusService,
    serviceTypeName,
  } = buildSelectionSummary(registration);
  const selectedOfferingLabel =
    packageName || serviceTypeName || plusService || null;
  const purchaseSummary = isDomainOnly
    ? `domain registration for ${formattedDomain}`
    : `domain registration for ${formattedDomain} with ${selectedOfferingLabel}`;
  const purchaseAction = isDomainOnly
    ? `register the domain ${formattedDomain}`
    : `register the domain ${formattedDomain} with the ${selectedOfferingLabel}`;

  return {
    formattedDomain,
    isDomainOnly,
    purchaseAction,
    purchaseSummary,
    selectedOfferingLabel,
  };
}

function buildRegistrarPayload(registration) {
  const selectionSummary = buildSelectionSummary(registration);

  return {
    order_reference: getPublicRequestReference(registration),
    domain_name: formatDomainName(registration.domain_name) || registration.domain_name,
    domain_extension: selectionSummary.domainExtension,
    first_name: registration.first_name || null,
    last_name: registration.last_name || null,
    phone: registration.phone,
    email: registration.email,
    company_name: registration.company_name || null,
    kra_pin: registration.kra_pin || null,
    street_address: registration.street_address || null,
    city: registration.city || null,
    state: registration.state || null,
    postcode: registration.postcode || null,
    country: registration.country || null,
    plus: selectionSummary.plusService,
    type: selectionSummary.serviceTypeName,
    package: selectionSummary.packageName,
    registrar_name: selectionSummary.registrarName,
    price_ksh: selectionSummary.priceKsh,
    currency_code: selectionSummary.currencyCode,
    period: selectionSummary.period,
  };
}

function getSafeRegistrarName(registration) {
  return typeof registration.registrar_name === 'string' && registration.registrar_name.trim()
    ? registration.registrar_name.trim()
    : 'the selected registrar';
}

function buildCustomerFullName(registration) {
  const fullName = normalizeTextValue(registration.full_name);

  if (fullName) {
    return fullName;
  }

  return [
    normalizeTextValue(registration.first_name),
    normalizeTextValue(registration.last_name),
  ]
    .filter(Boolean)
    .join(' ');
}

function getSafeCustomerName(registration) {
  return (
    normalizeTextValue(registration.first_name) ||
    buildCustomerFullName(registration) ||
    'there'
  );
}

function maskKraPin(value) {
  const normalizedValue = normalizeTextValue(value);

  if (!normalizedValue) {
    return '';
  }

  if (normalizedValue.length <= 2) {
    return normalizedValue;
  }

  return `${normalizedValue[0]}${'*'.repeat(normalizedValue.length - 2)}${
    normalizedValue[normalizedValue.length - 1]
  }`;
}

function buildCustomerOrderCopy(registration) {
  const selectionSummary = buildSelectionSummary(registration);
  const planName =
    selectionSummary.packageName ||
    selectionSummary.serviceTypeName ||
    selectionSummary.plusService ||
    'Domain registration';

  return {
    customerName: getSafeCustomerName(registration),
    formattedDomain: selectionSummary.formattedDomain,
    isDomainOnly: selectionSummary.isDomainOnly,
    packageName: selectionSummary.packageName,
    planName: selectionSummary.isDomainOnly ? 'Domain registration' : planName,
    registrarName: selectionSummary.registrarName,
    productLabel: selectionSummary.plusService || 'Domain Registration',
    selectedOfferingLabel:
      selectionSummary.packageName || selectionSummary.serviceTypeName || null,
    serviceTypeName: selectionSummary.serviceTypeName,
  };
}

function buildCommunicationOrderRows(
  registration,
  { includePeriod = false, includePrice = false, includeRegistrar = false } = {}
) {
  const selectionSummary = buildSelectionSummary(registration);
  const rows = [['Domain', selectionSummary.formattedDomain]];

  if (!selectionSummary.isDomainOnly) {
    rows.push(['Plus', selectionSummary.plusService]);

    if (selectionSummary.serviceTypeName) {
      rows.push(['Type', selectionSummary.serviceTypeName]);
    }

    if (selectionSummary.packageName) {
      rows.push(['Package', selectionSummary.packageName]);
    }
  }

  if (includePeriod) {
    rows.push(['Period', selectionSummary.period]);
  }

  if (includePrice) {
    rows.push(['Price', formatPrice(selectionSummary.priceKsh, selectionSummary.currencyCode)]);
  }

  if (includeRegistrar) {
    rows.push(['Registrar', selectionSummary.registrarName]);
  }

  return rows.filter(([, value]) => Boolean(value));
}

function buildSubmittedCustomerRows(registration) {
  return [
    ['First Name', normalizeTextValue(registration.first_name)],
    ['Last Name', normalizeTextValue(registration.last_name)],
    ['Phone', normalizeTextValue(registration.phone)],
    ['Email', normalizeTextValue(registration.email)],
    ['Company Name', normalizeTextValue(registration.company_name)],
    ['KRA PIN', maskKraPin(registration.kra_pin)],
    ['Street Address', normalizeTextValue(registration.street_address)],
    ['City', normalizeTextValue(registration.city)],
    ['State', normalizeTextValue(registration.state)],
    ['Post Code', normalizeTextValue(registration.postcode)],
    ['Country', normalizeTextValue(registration.country)],
  ].filter(([, value]) => Boolean(value));
}

function buildDetailLines(rows = []) {
  return rows.map(([label, value]) => `${label}: ${value}`);
}

function buildDetailListHtml(rows = []) {
  return `<ul>${rows
    .map(([label, value]) => `<li><strong>${label}:</strong> ${value}</li>`)
    .join('')}</ul>`;
}

function buildShortOrderConfirmationMessage(
  registration,
  { includeGreeting = true, includeReference = false } = {}
) {
  const { customerName, registrarName } = buildCustomerOrderCopy(registration);
  const detailLines = buildDetailLines(buildCommunicationOrderRows(registration));

  return [
    includeGreeting
      ? `Hi ${customerName}, we have received your order and it is now being processed.`
      : 'We have received your order and it is now being processed.',
    '',
    'Order Details:',
    ...detailLines,
    '',
    `Kindly await next steps from ${registrarName}.`,
    ...(includeReference
      ? [`Order Reference: ${getPublicRequestReference(registration)}`]
      : []),
  ].join('\n');
}

function buildClientAcknowledgementMessage(registration) {
  return buildShortOrderConfirmationMessage(registration);
}

function buildActiveDomainOrderConflictMessage(existingRegistration) {
  const { registrarName } = buildCustomerOrderCopy(existingRegistration);
  const detailLines = buildDetailLines(
    buildCommunicationOrderRows(existingRegistration)
  );

  return [
    'This domain already has an active order in progress.',
    '',
    'Order Details:',
    ...detailLines,
    '',
    `Kindly await next steps from ${registrarName}.`,
    `Order Reference: ${getPublicRequestReference(existingRegistration)}`,
  ].join('\n');
}

function getPublicRequestReference(registration) {
  return registration.external_request_id || registration.request_id || null;
}

function createActiveDomainOrderConflictError(existingRegistration) {
  const conflictError = new Error(
    buildActiveDomainOrderConflictMessage(existingRegistration)
  );

  conflictError.code = 'ACTIVE_DOMAIN_ORDER_EXISTS';
  conflictError.request_id = getPublicRequestReference(existingRegistration);

  return conflictError;
}

function buildTargetServiceValue(registration) {
  const snapshot = getRegistrationSnapshot(registration);

  return (
    normalizeTextValue(registration.service_product_code) ||
    normalizeTextValue(snapshot.service_product_code) ||
    normalizeTextValue(registration.target_service) ||
    getNormalizedProductFamily(registration) ||
    'domain_registration_only'
  );
}

function buildOrderLogContext(registration) {
  const selectionSummary = buildSelectionSummary(registration);

  return {
    order_reference: getPublicRequestReference(registration),
    first_name: normalizeTextValue(registration.first_name) || null,
    last_name: normalizeTextValue(registration.last_name) || null,
    phone: normalizeTextValue(registration.phone) || null,
    email: normalizeTextValue(registration.email) || null,
    company_name: normalizeTextValue(registration.company_name) || null,
    city: normalizeTextValue(registration.city) || null,
    state: normalizeTextValue(registration.state) || null,
    postcode: normalizeTextValue(registration.postcode) || null,
    country: normalizeTextValue(registration.country) || null,
    domain_name:
      selectionSummary.formattedDomain ||
      normalizeTextValue(registration.domain_name) ||
      null,
    domain_extension: selectionSummary.domainExtension,
    plus: selectionSummary.plusService,
    type: selectionSummary.serviceTypeName,
    package: selectionSummary.packageName,
    registrar_name: selectionSummary.registrarName,
    period: selectionSummary.period,
    currency_code: selectionSummary.currencyCode,
    price_ksh: selectionSummary.priceKsh,
  };
}

function buildDeliveryAuditLine(result) {
  const status = result.status || DELIVERY_STATUS.FAILED;
  const parts = [status];

  if (result.reason) {
    parts.push(`reason=${result.reason}`);
  }

  if (Number(result.attempts || 0) > 0) {
    parts.push(`attempts=${Number(result.attempts)}`);
  }

  if (result.providerStatusCode !== null && result.providerStatusCode !== undefined) {
    parts.push(`status_code=${Number(result.providerStatusCode)}`);
  }

  if (result.providerReference) {
    parts.push(`provider_ref=${result.providerReference}`);
  }

  if (result.audit_error) {
    parts.push(`audit_error=${result.audit_error}`);
  }

  if (result.error) {
    parts.push(`error=${result.error}`);
  }

  return parts.join(' | ');
}

function isExternalRequestIdConflict(error) {
  return Boolean(
    error &&
    error.code === '23505' &&
    error.constraint &&
    error.constraint.includes('external_request_id')
  );
}

function isActiveOrderConflict(error) {
  return Boolean(
    error &&
    error.code === '23505' &&
    error.constraint === 'idx_registrations_active_email_domain'
  );
}

function pickRandomCharacter(charset) {
  return charset[randomInt(0, charset.length)];
}

function shuffleCharacters(characters) {
  const result = [...characters];

  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(0, index + 1);
    const currentValue = result[index];
    result[index] = result[swapIndex];
    result[swapIndex] = currentValue;
  }

  return result;
}

function generateExternalRequestIdCandidate() {
  const characters = [
    pickRandomCharacter(PUBLIC_REFERENCE_LETTERS),
    pickRandomCharacter(PUBLIC_REFERENCE_DIGITS),
  ];

  while (characters.length < PUBLIC_REFERENCE_LENGTH) {
    characters.push(pickRandomCharacter(PUBLIC_REFERENCE_CHARSET));
  }

  return shuffleCharacters(characters).join('');
}

function buildDeliveryPayloadContext(registration) {
  const orderLogContext = buildOrderLogContext(registration);

  return {
    domain_name: orderLogContext.domain_name,
    domain_extension: orderLogContext.domain_extension,
    order_reference: orderLogContext.order_reference,
    plus: orderLogContext.plus,
    type: orderLogContext.type,
    package: orderLogContext.package,
    period: orderLogContext.period,
    price_ksh: orderLogContext.price_ksh,
    currency_code: orderLogContext.currency_code,
    registrar_name: orderLogContext.registrar_name,
  };
}

function buildUserSmsMessage(registration) {
  const publicRequestReference = getPublicRequestReference(registration);
  const { customerName, registrarName } =
    buildCustomerOrderCopy(registration);
  const detailRows = buildCommunicationOrderRows(registration);
  const detailSegments = detailRows.map(([label, value]) => `${label}: ${value}.`);

  return [
    `Hi ${customerName}, we have received your order.`,
    ...detailSegments,
    `Ref ${publicRequestReference}.`,
    `${registrarName} is processing it.`,
  ].join(' ');
}

function buildUserAcknowledgementEmail(registration) {
  const publicRequestReference = getPublicRequestReference(registration);
  const { customerName, formattedDomain, registrarName } = buildCustomerOrderCopy(registration);
  const orderDetailRows = [
    ['Order Reference', publicRequestReference],
    ...buildCommunicationOrderRows(registration, {
      includePeriod: true,
      includePrice: true,
      includeRegistrar: true,
    }),
  ];
  const customerDetailRows = buildSubmittedCustomerRows(registration);
  const subject = `Order Received - ${formattedDomain}`;
  const detailRows = [
    'Order Details:',
    ...buildDetailLines(orderDetailRows),
    '',
    'Submitted Details:',
    ...buildDetailLines(customerDetailRows),
  ];
  const text = [
    `Hello ${customerName},`,
    '',
    'We have received your order and started processing it.',
    '',
    ...detailRows,
    '',
    `Kindly await next steps from ${registrarName}.`,
  ].join('\n');

  const html = `
    <p>Hello ${customerName},</p>
    <p>We have received your order and started processing it.</p>
    <p><strong>Order Details</strong></p>
    ${buildDetailListHtml(orderDetailRows)}
    <p><strong>Submitted Details</strong></p>
    ${buildDetailListHtml(customerDetailRows)}
    <p>Kindly await next steps from <strong>${registrarName}</strong>.</p>
  `;

  return { html, subject, text };
}

function buildRegistrarNotificationEmail(registration, registrar) {
  const publicRequestReference = getPublicRequestReference(registration);
  const { formattedDomain, isDomainOnly, planName } = buildCustomerOrderCopy(registration);
  const orderDetailRows = [
    ['Order Reference', publicRequestReference],
    ...buildCommunicationOrderRows(registration, {
      includePeriod: true,
      includePrice: true,
    }),
  ];
  const customerDetailRows = buildSubmittedCustomerRows(registration);
  const subject =
    planName && !isDomainOnly
      ? `New customer order - ${formattedDomain} - ${planName}`
      : `New customer order - ${formattedDomain}`;
  const text = [
    `Hello ${registrar.name},`,
    '',
    'A new customer order has been placed on the platform.',
    '',
    'Order Details:',
    ...buildDetailLines(orderDetailRows),
    '',
    'Customer Details:',
    ...buildDetailLines(customerDetailRows),
    '',
    'Please action it from your registrar workflow.',
  ].join('\n');

  const html = `
    <p>Hello ${registrar.name},</p>
    <p>A new customer order has been placed on the platform.</p>
    <p><strong>Order Details</strong></p>
    ${buildDetailListHtml(orderDetailRows)}
    <p><strong>Customer Details</strong></p>
    ${buildDetailListHtml(customerDetailRows)}
    <p>Please action it from your registrar workflow.</p>
  `;

  return { html, subject, text };
}

function normalizeSettledResult(settledResult) {
  if (settledResult.status === 'fulfilled') {
    return settledResult.value;
  }

  return {
    error:
      settledResult.reason instanceof Error
        ? settledResult.reason.message
        : 'Unexpected async task failure',
    status: DELIVERY_STATUS.FAILED,
  };
}

async function findRegistrarByName(registrarName) {
  return findRegistrarByIdentifiers({ registrarName });
}

async function findRegistrarByIdentifiers({
  registrarId,
  registrarCode,
  registrarName,
}) {
  const normalizedRegistrarId =
    typeof registrarId === 'string' ? registrarId.trim() : '';
  const normalizedRegistrarCode =
    typeof registrarCode === 'string' ? registrarCode.trim().toUpperCase() : '';
  const normalizedRegistrarName =
    typeof registrarName === 'string' ? registrarName.trim() : '';

  if (!normalizedRegistrarId && !normalizedRegistrarCode && !normalizedRegistrarName) {
    return null;
  }

  const query = `
    SELECT id, registrar_code, name, api_endpoint, notification_email, is_active
    FROM registrars
    WHERE
      ($1 <> '' AND id::text = $1)
      OR ($2 <> '' AND registrar_code = $2)
      OR ($3 <> '' AND LOWER(name) = LOWER($3))
    ORDER BY
      CASE
        WHEN $1 <> '' AND id::text = $1 THEN 1
        WHEN $2 <> '' AND registrar_code = $2 THEN 2
        ELSE 3
      END
    LIMIT 1
  `;
  const result = await pool.query(query, [
    normalizedRegistrarId,
    normalizedRegistrarCode,
    normalizedRegistrarName,
  ]);
  return result.rows[0] || null;
}

async function findRegistrarForRegistration(registration) {
  if (!registration) {
    return null;
  }

  return findRegistrarByIdentifiers({
    registrarId: registration.registrar_id,
    registrarName: registration.registrar_name,
  });
}

async function getRegistrationById(requestId) {
  const query = `
    SELECT
      reg.request_id,
      reg.external_request_id,
      reg.status,
      reg.pushed,
      reg.registrar_reference_id,
      reg.first_name,
      reg.last_name,
      reg.full_name,
      reg.phone,
      reg.email,
      reg.company_name,
      reg.kra_pin,
      reg.street_address,
      reg.city,
      reg.state,
      reg.postcode,
      reg.country,
      reg.domain_name,
      reg.target_service,
      reg.product_family,
      reg.selection_kind,
      reg.domain_extension,
      reg.domain_offering_id,
      reg.service_package_id,
      reg.service_package_price_id,
      reg.bundle_id,
      reg.service_product_code,
      reg.package_code,
      reg.package_name,
      reg.billing_cycle,
      reg.billing_period_months,
      reg.currency_code,
      reg.quoted_price_ksh,
      reg.selection_snapshot_json,
      reg.registrar_id,
      reg.registrar_name,
      registrar.registrar_code
    FROM registrations reg
    LEFT JOIN registrars registrar
      ON registrar.id = reg.registrar_id
      OR (
        reg.registrar_id IS NULL
        AND reg.registrar_name IS NOT NULL
        AND LOWER(registrar.name) = LOWER(reg.registrar_name)
      )
    WHERE reg.request_id = $1
  `;
  const result = await pool.query(query, [requestId]);
  return result.rows[0];
}

function normalizeMatchValue(value) {
  return normalizeTextValue(value).toLowerCase();
}

function matchesRequestedValue(actualValue, requestedValue) {
  const normalizedRequestedValue = normalizeMatchValue(requestedValue);

  if (!normalizedRequestedValue) {
    return true;
  }

  return normalizeMatchValue(actualValue) === normalizedRequestedValue;
}

function matchesRequestedBillingLabel(row, requestedPeriod) {
  const normalizedRequestedPeriod = normalizeMatchValue(requestedPeriod);

  if (!normalizedRequestedPeriod) {
    return true;
  }

  const rowBillingLabel = getBillingLabel({
    billingCycle: row.billing_cycle,
    billingLabel: row.billing_label,
    billingPeriodMonths: row.billing_period_months,
  });

  return normalizeMatchValue(rowBillingLabel) === normalizedRequestedPeriod;
}

function matchesRequestedPrice(actualPrice, requestedPrice) {
  if (requestedPrice === null || requestedPrice === undefined) {
    return true;
  }

  return Number(actualPrice) === Number(requestedPrice);
}

async function resolveDomainSelection({
  domainName,
  domainExtension,
  domainOfferingId,
  period,
  priceKsh,
  registrarId,
  selectionSnapshotJson,
}) {
  const normalizedDomainExtension = normalizeTextValue(domainExtension).toLowerCase();

  if (!domainOfferingId && !normalizedDomainExtension) {
    return null;
  }

  let row = null;

  if (domainOfferingId) {
    const params = [domainOfferingId];
    let registrarFilter = '';

    if (registrarId) {
      params.push(registrarId);
      registrarFilter = ` AND rdo.registrar_id = $${params.length}`;
    }

    const result = await pool.query(
      `
        SELECT
          rdo.id AS domain_offering_id,
          rdo.registrar_id,
          rdo.registration_price_ksh,
          rdo.currency_code,
          rdo.billing_period_months,
          de.code AS extension_code,
          de.label AS extension_label,
          de.extension,
          r.registrar_code,
          r.name AS registrar_name
        FROM registrar_domain_offerings rdo
        INNER JOIN domain_extensions de
          ON de.id = rdo.domain_extension_id
        INNER JOIN registrars r
          ON r.id = rdo.registrar_id
        WHERE rdo.id = $1
          AND rdo.is_active = true
          ${registrarFilter}
        LIMIT 1
      `,
      params
    );

    row = result.rows[0] || null;
  } else {
    const params = [normalizedDomainExtension];
    let registrarFilter = '';

    if (registrarId) {
      params.push(registrarId);
      registrarFilter = ` AND rdo.registrar_id = $${params.length}`;
    }

    const result = await pool.query(
      `
        SELECT
          rdo.id AS domain_offering_id,
          rdo.registrar_id,
          rdo.registration_price_ksh,
          rdo.currency_code,
          rdo.billing_period_months,
          de.code AS extension_code,
          de.label AS extension_label,
          de.extension,
          r.registrar_code,
          r.name AS registrar_name
        FROM registrar_domain_offerings rdo
        INNER JOIN domain_extensions de
          ON de.id = rdo.domain_extension_id
        INNER JOIN registrars r
          ON r.id = rdo.registrar_id
        WHERE rdo.is_active = true
          AND LOWER(de.extension) = $1
          ${registrarFilter}
        ORDER BY rdo.billing_period_months ASC, rdo.registration_price_ksh ASC
      `,
      params
    );

    row =
      result.rows.find(
        (candidate) =>
          matchesRequestedBillingLabel(candidate, period) &&
          matchesRequestedPrice(candidate.registration_price_ksh, priceKsh)
      ) || null;
  }

  if (!row) {
    throw new Error('Selected domain option not found.');
  }

  return {
    billing_cycle: getBillingCycleFromMonths(row.billing_period_months),
    billing_period_months: row.billing_period_months,
    currency_code: row.currency_code,
    domain_extension: row.extension,
    domain_offering_id: row.domain_offering_id,
    package_code: row.extension_code || row.extension,
    package_name: row.extension_label || row.extension,
    product_family: 'domain_registration',
    quoted_price_ksh: row.registration_price_ksh,
    selection_kind: 'domain',
    selection_snapshot_json: {
      ...normalizeJsonObject(selectionSnapshotJson),
      billing_cycle: getBillingCycleFromMonths(row.billing_period_months),
      billing_label: getBillingLabel({
        billingPeriodMonths: row.billing_period_months,
      }),
      billing_period_months: row.billing_period_months,
      currency_code: row.currency_code,
      domain_extension: row.extension,
      domain_name: formatDomainName(domainName),
      package_code: row.extension_code || row.extension,
      package_name: row.extension_label || row.extension,
      price_ksh: row.registration_price_ksh,
      product_family: 'domain_registration',
      quoted_price_ksh: row.registration_price_ksh,
      registrar_code: row.registrar_code,
      registrar_name: row.registrar_name,
      selection_kind: 'domain',
    },
    target_service: 'domain_registration_only',
  };
}

async function resolveServiceSelection({
  plus,
  type,
  packageName,
  domainExtension,
  domainName,
  priceKsh,
  period,
  registrarId,
  servicePackageId,
  servicePackagePriceId,
  selectionSnapshotJson,
  targetService,
}) {
  const normalizedRequestedFamily = normalizeProductFamilyValue(plus || targetService);
  const normalizedRequestedType = normalizeMatchValue(type);
  const normalizedRequestedPackage = normalizeMatchValue(packageName);
  const hasSummarySelection =
    Boolean(normalizedRequestedFamily) ||
    Boolean(normalizedRequestedType) ||
    Boolean(normalizedRequestedPackage);

  if (!servicePackageId && !servicePackagePriceId && !hasSummarySelection) {
    return null;
  }

  const params = [];
  const filters = [
    'rsp.is_active = true',
    'rspp.is_active = true',
    'sp.is_active = true',
  ];

  if (servicePackagePriceId) {
    params.push(servicePackagePriceId);
    filters.push(`rspp.id = $${params.length}`);
  } else {
    if (servicePackageId) {
      params.push(servicePackageId);
      filters.push(`rsp.id = $${params.length}`);
    }
  }

  if (registrarId) {
    params.push(registrarId);
    filters.push(`rsp.registrar_id = $${params.length}`);
  }

  if (normalizedRequestedFamily && normalizedRequestedFamily !== 'domain_registration') {
    params.push(normalizedRequestedFamily);
    filters.push(`sp.product_family = $${params.length}`);
  }

  const result = await pool.query(
    `
      SELECT
        rsp.id AS service_package_id,
        rsp.registrar_id,
        rsp.package_code,
        rsp.package_name,
        rsp.short_description,
        rsp.details_json,
        rsp.feature_bullets_json,
        rspp.id AS service_package_price_id,
        rspp.billing_cycle,
        rspp.billing_period_months,
        rspp.billing_label,
        rspp.price_ksh,
        rspp.currency_code,
        rspp.is_default,
        sp.service_code,
        sp.product_family,
        sp.name AS service_name,
        r.registrar_code,
        r.name AS registrar_name
      FROM registrar_service_packages rsp
      INNER JOIN registrar_service_package_prices rspp
        ON rspp.service_package_id = rsp.id
      INNER JOIN service_products sp
        ON sp.id = rsp.service_product_id
      INNER JOIN registrars r
        ON r.id = rsp.registrar_id
      WHERE ${filters.join('\n        AND ')}
      ORDER BY rspp.is_default DESC, rspp.price_ksh ASC, rspp.billing_period_months ASC
      LIMIT 200
    `,
    params
  );

  const matchingRows = result.rows.filter(
    (candidate) =>
      (!normalizedRequestedType ||
        matchesRequestedValue(candidate.service_name, normalizedRequestedType)) &&
      (!normalizedRequestedPackage ||
        matchesRequestedValue(candidate.package_name, normalizedRequestedPackage)) &&
      matchesRequestedBillingLabel(candidate, period) &&
      matchesRequestedPrice(candidate.price_ksh, priceKsh)
  );
  const row =
    matchingRows[0] ||
    (!hasSummarySelection ? result.rows[0] || null : null);

  if (!row) {
    throw new Error('Selected service package not found.');
  }

  const normalizedTargetService =
    normalizeProductFamilyValue(targetService) ||
    normalizeProductFamilyValue(row.product_family) ||
    normalizeTextValue(row.service_code);
  const productFamily =
    normalizeProductFamilyValue(row.product_family) ||
    getProductFamilyFromServiceCode(normalizedTargetService) ||
    getProductFamilyFromServiceCode(row.service_code);
  const packagePriceKsh = Number.isFinite(Number(row.price_ksh))
    ? Number(row.price_ksh)
    : null;
  const serviceBillingLabel = getBillingLabel({
    billingCycle: row.billing_cycle,
    billingLabel: row.billing_label,
    billingPeriodMonths: row.billing_period_months,
  });

  return {
    billing_cycle: row.billing_cycle || getBillingCycleFromMonths(row.billing_period_months),
    billing_period_months: row.billing_period_months,
    currency_code: row.currency_code,
    domain_extension: domainExtension || null,
    domain_offering_id: null,
    package_code: row.package_code,
    package_name: row.package_name,
    product_family: productFamily,
    quoted_price_ksh: packagePriceKsh,
    selection_kind: 'service',
    selection_snapshot_json: {
      ...normalizeJsonObject(selectionSnapshotJson),
      billing_cycle: row.billing_cycle || getBillingCycleFromMonths(row.billing_period_months),
      billing_label: serviceBillingLabel,
      billing_period_months: row.billing_period_months,
      currency_code: row.currency_code,
      details: normalizeJsonObject(row.details_json),
      domain_extension: domainExtension || null,
      domain_name: formatDomainName(domainName),
      feature_bullets: normalizeTextArray(row.feature_bullets_json),
      package_code: row.package_code,
      package_name: row.package_name,
      package_billing_label: serviceBillingLabel,
      package_price_ksh: packagePriceKsh,
      price_ksh: packagePriceKsh,
      product_family: productFamily,
      quoted_price_ksh: packagePriceKsh,
      registrar_code: row.registrar_code,
      registrar_name: row.registrar_name,
      selection_kind: 'service',
      target_service: normalizedTargetService,
      service_name: row.service_name,
      service_product_code: row.service_code,
      short_description: row.short_description,
    },
    service_package_id: row.service_package_id,
    service_package_price_id: row.service_package_price_id,
    service_product_code: row.service_code,
    target_service: normalizedTargetService,
  };
}

async function resolveBundleSelection({
  bundleId,
  domainName,
  registrarId,
  selectionSnapshotJson,
  targetService,
}) {
  if (!bundleId) {
    return null;
  }

  const params = [bundleId];
  let registrarFilter = '';

  if (registrarId) {
    params.push(registrarId);
    registrarFilter = ` AND bt.registrar_id = $${params.length}`;
  }

  const result = await pool.query(
    `
      SELECT
        bt.id AS bundle_id,
        bt.registrar_id,
        bt.bundle_code,
        bt.bundle_name,
        bt.description,
        bt.price_ksh,
        bt.currency_code,
        r.registrar_code,
        r.name AS registrar_name
      FROM bundle_templates bt
      INNER JOIN registrars r
        ON r.id = bt.registrar_id
      WHERE bt.id = $1
        AND bt.is_active = true
        ${registrarFilter}
      LIMIT 1
    `,
    params
  );

  const row = result.rows[0] || null;

  if (!row) {
    throw new Error('Selected bundle not found.');
  }

  return {
    bundle_id: row.bundle_id,
    currency_code: row.currency_code,
    package_code: row.bundle_code,
    package_name: row.bundle_name,
    product_family: targetService || 'bundle',
    quoted_price_ksh: row.price_ksh,
    selection_kind: 'bundle',
    selection_snapshot_json: {
      ...normalizeJsonObject(selectionSnapshotJson),
      bundle_id: row.bundle_id,
      currency_code: row.currency_code,
      description: row.description,
      domain_name: formatDomainName(domainName),
      package_code: row.bundle_code,
      package_name: row.bundle_name,
      price_ksh: row.price_ksh,
      product_family: targetService || 'bundle',
      quoted_price_ksh: row.price_ksh,
      registrar_code: row.registrar_code,
      registrar_name: row.registrar_name,
      selection_kind: 'bundle',
    },
    target_service: targetService || 'bundle',
  };
}

function buildFallbackSelection({
  billing_cycle,
  billing_period_months,
  currency_code,
  domain_extension,
  domain_name,
  package_code,
  package_name,
  product_family,
  quoted_price_ksh,
  selection_kind,
  selection_snapshot_json,
  service_product_code,
  target_service,
}) {
  const normalizedTargetService = normalizeProductFamilyValue(target_service);
  const normalizedSelectionKind =
    selection_kind ||
    (normalizedTargetService === 'domain_registration' ||
    normalizedTargetService === 'domain_registration_only'
      ? 'domain'
      : '');
  const normalizedProductFamily = normalizeProductFamilyValue(
    product_family || normalizedTargetService || null
  );

  return {
    billing_cycle,
    billing_period_months,
    currency_code,
    domain_extension,
    package_code,
    package_name,
    product_family: normalizedProductFamily,
    quoted_price_ksh,
    selection_kind: normalizedSelectionKind,
    selection_snapshot_json: {
      ...normalizeJsonObject(selection_snapshot_json),
      billing_cycle: billing_cycle || null,
      billing_period_months: billing_period_months || null,
      currency_code: currency_code || null,
      domain_extension: domain_extension || null,
      domain_name: formatDomainName(domain_name),
      package_code: package_code || null,
      package_name: package_name || null,
      product_family: normalizedProductFamily,
      quoted_price_ksh: quoted_price_ksh,
      selection_kind: normalizedSelectionKind,
      service_product_code: service_product_code || null,
    },
    service_product_code,
    target_service:
      normalizedTargetService ||
      normalizedProductFamily ||
      (normalizedSelectionKind === 'domain' ? 'domain_registration_only' : null),
  };
}

async function resolveSelection(payload, resolvedRegistrarId) {
  const hasServiceSummarySelection = Boolean(
    normalizeTextValue(payload.plus) ||
      normalizeTextValue(payload.type) ||
      normalizeTextValue(payload.package)
  );
  const prefersDomainSelection =
    payload.selection_kind === 'domain' ||
    (!payload.service_package_id &&
      !payload.service_package_price_id &&
      !payload.bundle_id &&
      !hasServiceSummarySelection);

  if (prefersDomainSelection) {
    const domainSelection = await resolveDomainSelection({
      domainName: payload.domain_name,
      domainExtension: payload.domain_extension,
      domainOfferingId: payload.domain_offering_id,
      period: payload.period,
      priceKsh: payload.price_ksh,
      registrarId: resolvedRegistrarId,
      selectionSnapshotJson: payload.selection_snapshot_json,
    });

    if (domainSelection) {
      return domainSelection;
    }
  }

  const serviceSelection = await resolveServiceSelection({
    plus: payload.plus,
    type: payload.type,
    packageName: payload.package || payload.package_name,
    domainExtension: payload.domain_extension,
    domainName: payload.domain_name,
    period: payload.period,
    priceKsh: payload.price_ksh,
    registrarId: resolvedRegistrarId,
    selectionSnapshotJson: payload.selection_snapshot_json,
    servicePackageId: payload.service_package_id,
    servicePackagePriceId: payload.service_package_price_id,
    targetService: payload.target_service || payload.product_family,
  });

  if (serviceSelection) {
    return serviceSelection;
  }

  const bundleSelection = await resolveBundleSelection({
    bundleId: payload.bundle_id,
    domainName: payload.domain_name,
    registrarId: resolvedRegistrarId,
    selectionSnapshotJson: payload.selection_snapshot_json,
    targetService: payload.target_service || payload.product_family,
  });

  if (bundleSelection) {
    return bundleSelection;
  }

  if (prefersDomainSelection) {
    throw new Error('Selected domain option not found.');
  }

  if (payload.bundle_id) {
    throw new Error('Selected bundle not found.');
  }

  throw new Error('Selected service package not found.');
}

async function findActiveDomainOrderConflict({ domain_name, email }) {
  const result = await pool.query(
    `
      SELECT
        request_id,
        external_request_id,
        status,
        pushed,
        registrar_reference_id,
        first_name,
        last_name,
        full_name,
        phone,
        email,
        domain_name,
        target_service,
        product_family,
        selection_kind,
        service_product_code,
        package_name,
        registrar_name,
        selection_snapshot_json
      FROM registrations
      WHERE email = $1
        AND domain_name = $2
        AND status = 'received'
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [email, domain_name]
  );

  return result.rows[0] || null;
}

async function markSmsAcknowledged(requestId) {
  await pool.query(
    `
      UPDATE registrations
      SET message_sent = true,
          updated_at = NOW()
      WHERE request_id = $1
    `,
    [requestId]
  );
}

async function insertRegistrationWithExternalReference({
  first_name,
  last_name,
  phone,
  email,
  company_name,
  kra_pin,
  street_address,
  city,
  state,
  postcode,
  country,
  full_name,
  domain_name,
  target_service,
  product_family,
  selection_kind,
  domain_extension,
  domain_offering_id,
  service_package_id,
  service_package_price_id,
  bundle_id,
  service_product_code,
  package_code,
  package_name,
  billing_cycle,
  billing_period_months,
  currency_code,
  quoted_price_ksh,
  selection_snapshot_json,
  registrar_id,
  registrar_name,
}) {
  const insertQuery = `
    INSERT INTO registrations (
      first_name,
      last_name,
      phone,
      email,
      company_name,
      kra_pin,
      street_address,
      city,
      state,
      postcode,
      country,
      full_name,
      domain_name,
      target_service,
      product_family,
      selection_kind,
      domain_extension,
      domain_offering_id,
      service_package_id,
      service_package_price_id,
      bundle_id,
      service_product_code,
      package_code,
      package_name,
      billing_cycle,
      billing_period_months,
      currency_code,
      quoted_price_ksh,
      selection_snapshot_json,
      registrar_id,
      registrar_name,
      external_request_id
    )
    VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
      $11, $12, $13, $14, $15, $16, $17, $18,
      $19, $20, $21, $22, $23, $24, $25, $26,
      $27, $28, $29, $30, $31, $32
    )
    RETURNING
      request_id,
      external_request_id,
      status,
      pushed,
      registrar_reference_id,
      first_name,
      last_name,
      phone,
      email,
      company_name,
      kra_pin,
      street_address,
      city,
      state,
      postcode,
      country,
      full_name,
      domain_name,
      target_service,
      product_family,
      selection_kind,
      domain_extension,
      domain_offering_id,
      service_package_id,
      service_package_price_id,
      bundle_id,
      service_product_code,
      package_code,
      package_name,
      billing_cycle,
      billing_period_months,
      currency_code,
      quoted_price_ksh,
      selection_snapshot_json,
      registrar_id,
      registrar_name
  `;

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const externalRequestId = generateExternalRequestIdCandidate();

    try {
      const result = await pool.query(insertQuery, [
        first_name,
        last_name,
        phone,
        email,
        company_name,
        kra_pin,
        street_address,
        city,
        state,
        postcode,
        country,
        full_name,
        domain_name,
        target_service,
        product_family,
        selection_kind,
        domain_extension,
        domain_offering_id,
        service_package_id,
        service_package_price_id,
        bundle_id,
        service_product_code,
        package_code,
        package_name,
        billing_cycle,
        billing_period_months,
        currency_code,
        quoted_price_ksh,
        selection_snapshot_json || {},
        registrar_id,
        registrar_name,
        externalRequestId,
      ]);

      return result.rows[0];
    } catch (error) {
      if (isExternalRequestIdConflict(error)) {
        continue;
      }

      throw error;
    }
  }

  throw new Error('Unable to generate a unique external request reference.');
}

async function logFailedRegistrarPush(registrationId, errorMessage) {
  await pool.query(
    `
      INSERT INTO failed_requests (registration_id, error_message, attempted_at)
      VALUES ($1, $2, NOW())
    `,
    [registrationId, errorMessage]
  );
}

async function clearFailedRegistrarPushes(registrationId) {
  await pool.query(
    `
      DELETE FROM failed_requests
      WHERE registration_id = $1
    `,
    [registrationId]
  );
}

async function sendUserSmsAcknowledgement(registration) {
  const message = buildUserSmsMessage(registration);

  const result = await runDeliveryWithRetry({
    registrationId: registration.request_id,
    deliveryType: 'sms',
    recipientType: 'user',
    destination: registration.phone,
    templateKey: 'registration_ack_sms',
    payload: {
      message,
      ...buildDeliveryPayloadContext(registration),
    },
    handler: async () => sendSms(registration.phone, message),
  });

  if (result.status === DELIVERY_STATUS.SUCCESS) {
    try {
      await markSmsAcknowledged(registration.request_id);
    } catch (error) {
      const auditError = `message_sent sync failed: ${
        error instanceof Error ? error.message : 'Unexpected database error'
      }`;

      console.error('---- ORDER PROCESSING ----', {
        stage: 'audit_warning',
        ...buildOrderLogContext(registration),
        audit_error: auditError,
        channel: 'user_sms',
      });

      return {
        ...result,
        audit_error: result.audit_error
          ? `${result.audit_error} | ${auditError}`
          : auditError,
      };
    }
  }

  return result;
}

async function sendUserEmailAcknowledgement(registration) {
  if (!registration.email || !isEmailConfigured()) {
    return {
      attempts: 0,
      reason: registration.email ? 'email_service_not_configured' : 'missing_email',
      status: DELIVERY_STATUS.SKIPPED,
    };
  }

  const emailContent = buildUserAcknowledgementEmail(registration);

  return runDeliveryWithRetry({
    registrationId: registration.request_id,
    deliveryType: 'email',
    recipientType: 'user',
    destination: registration.email,
    templateKey: 'registration_ack_email',
    subject: emailContent.subject,
    payload: {
      subject: emailContent.subject,
      ...buildDeliveryPayloadContext(registration),
    },
    handler: async () =>
      sendEmail({
        to: registration.email,
        ...emailContent,
      }),
  });
}

async function sendRegistrarEmailNotification(registration, registrar) {
  if (!registrar || !registrar.notification_email || !isEmailConfigured()) {
    return {
      attempts: 0,
      reason: !registrar
        ? 'registrar_not_found'
        : !registrar.notification_email
        ? 'no_registrar_email'
        : 'email_service_not_configured',
      status: DELIVERY_STATUS.SKIPPED,
    };
  }

  const emailContent = buildRegistrarNotificationEmail(registration, registrar);

  return runDeliveryWithRetry({
    registrationId: registration.request_id,
    deliveryType: 'email',
    recipientType: 'registrar',
    destination: registrar.notification_email,
    templateKey: 'registrar_registration_email',
    subject: emailContent.subject,
    payload: {
      ...buildDeliveryPayloadContext(registration),
      registrar_name: registrar.name,
      subject: emailContent.subject,
    },
    handler: async () =>
      sendEmail({
        to: registrar.notification_email,
        ...emailContent,
      }),
  });
}

async function pushToRegistrar(registration, registrar, options = {}) {
  const { forceRetry = false } = options;

  if (!registrar) {
    return {
      attempts: 0,
      reason: 'registrar_not_found',
      status: DELIVERY_STATUS.SKIPPED,
    };
  }

  if (!registrar.is_active) {
    return {
      attempts: 0,
      reason: 'registrar_inactive',
      status: DELIVERY_STATUS.SKIPPED,
    };
  }

  if (!registrar.api_endpoint) {
    return {
      attempts: 0,
      reason: 'no_registrar_endpoint',
      status: DELIVERY_STATUS.SKIPPED,
    };
  }

  const payload = buildRegistrarPayload(registration);

  const result = await runDeliveryWithRetry({
    registrationId: registration.request_id,
    deliveryType: 'registrar_api',
    recipientType: 'registrar',
    destination: registrar.api_endpoint,
    templateKey: 'registration_push',
    payload,
    forceRetry,
    handler: async () => {
      const response = await fetch(registrar.api_endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const responseText = await response.text();

      if (!response.ok) {
        throw new Error(
          `Registrar API responded with status ${response.status}: ${responseText}`
        );
      }

      let data = null;

      try {
        data = responseText ? JSON.parse(responseText) : null;
      } catch (error) {
        data = { raw: responseText };
      }

      const referenceId =
        data && (data.reference_id || data.referenceId)
          ? data.reference_id || data.referenceId
          : null;

      let auditError = null;

      try {
        await pool.query(
          `
            UPDATE registrations
            SET pushed = true,
                registrar_reference_id = $1,
                updated_at = NOW()
            WHERE request_id = $2
          `,
          [referenceId, registration.request_id]
        );

        await clearFailedRegistrarPushes(registration.request_id);
      } catch (error) {
        auditError = `registrar push sync failed: ${
          error instanceof Error ? error.message : 'Unexpected database error'
        }`;

        console.error('---- ORDER PROCESSING ----', {
          stage: 'audit_warning',
          ...buildOrderLogContext(registration),
          audit_error: auditError,
          destination: registrar.api_endpoint,
          provider_reference: referenceId,
          provider_status_code: response.status,
        });
      }

      return {
        auditError,
        providerStatusCode: response.status,
        providerReference: referenceId,
        response: data || responseText || 'OK',
      };
    },
  });

  if (result.status === DELIVERY_STATUS.FAILED) {
    await logFailedRegistrarPush(registration.request_id, result.error);
  }

  return result;
}

async function retryRegistrarPushByRegistrationId(requestId) {
  const registration = await getRegistrationById(requestId);

  if (!registration) {
    throw new Error(`Registration ${requestId} was not found.`);
  }

  const registrar = await findRegistrarForRegistration(registration);
  const pushResult = await pushToRegistrar(registration, registrar, {
    forceRetry: true,
  });

  return {
    registration_id: requestId,
    ...pushResult,
  };
}

async function processRegistrationSideEffects(registration, registrar) {
  const settledResults = await Promise.allSettled([
    sendUserSmsAcknowledgement(registration),
    sendUserEmailAcknowledgement(registration),
    sendRegistrarEmailNotification(registration, registrar),
    pushToRegistrar(registration, registrar),
  ]);

  const [smsResult, emailResult, registrarEmailResult, pushResult] =
    settledResults.map(normalizeSettledResult);

  console.log('---- ORDER PROCESSING ----', {
    stage: 'delivery_summary',
    ...buildOrderLogContext(registration),
    channels: {
      registrar_email: buildDeliveryAuditLine(registrarEmailResult),
      registrar_push: buildDeliveryAuditLine(pushResult),
      user_email: buildDeliveryAuditLine(emailResult),
      user_sms: buildDeliveryAuditLine(smsResult),
    },
  });

  return {
    email: emailResult,
    push: pushResult,
    registrarEmail: registrarEmailResult,
    sms: smsResult,
  };
}

exports.createRegistration = async (payload) => {
  const normalizedPayload = normalizeRegistrationInput(payload);
  const {
    first_name,
    last_name,
    phone,
    email,
    company_name,
    kra_pin,
    street_address,
    city,
    state,
    postcode,
    country,
    domain_name,
    plus,
    type,
    package: selectedPackage,
    price_ksh,
    period,
    currency_code,
    target_service,
    product_family,
    domain_extension,
    registrar_id,
    registrar_code,
    registrar_name,
  } = normalizedPayload;

  const registrar = await findRegistrarByIdentifiers({
    registrarId: registrar_id,
    registrarCode: registrar_code,
    registrarName: registrar_name,
  });

  if (!registrar && (registrar_id || registrar_code || registrar_name)) {
    throw new Error('Registrar not found.');
  }

  const resolvedRegistrarId = registrar ? registrar.id : null;
  const resolvedRegistrarName = registrar ? registrar.name : registrar_name;
  const selection = await resolveSelection(normalizedPayload, resolvedRegistrarId);
  const initialSelectionSnapshot = buildSelectionSnapshotSummary({
    currency_code: selection.currency_code || currency_code,
    domain_extension: selection.domain_extension || domain_extension,
    domain_name,
    packageName: selectedPackage || selection.package_name || normalizedPayload.package_name,
    period:
      period ||
      getBillingLabel({
        billingCycle: selection.billing_cycle,
        billingPeriodMonths: selection.billing_period_months,
      }),
    plus,
    price_ksh:
      selection.quoted_price_ksh === null || selection.quoted_price_ksh === undefined
        ? price_ksh
        : selection.quoted_price_ksh,
    registrar_name: resolvedRegistrarName,
    type,
  });
  const selectionContext = {
    ...selection,
    domain_name,
    first_name,
    last_name,
    phone,
    email,
    company_name,
    kra_pin,
    street_address,
    city,
    state,
    postcode,
    country,
    domain_extension: selection.domain_extension || domain_extension,
    product_family: selection.product_family || product_family,
    registrar_name: resolvedRegistrarName,
    selection_snapshot_json: initialSelectionSnapshot,
    service_product_code: selection.service_product_code || normalizedPayload.service_product_code,
    target_service: selection.target_service || target_service,
  };
  const resolvedSelectionSummary = buildSelectionSummary(selectionContext);
  const enrichedSelectionSnapshot = buildSelectionSnapshotSummary({
    currency_code: resolvedSelectionSummary.currencyCode,
    domain_extension: resolvedSelectionSummary.domainExtension,
    domain_name,
    packageName: resolvedSelectionSummary.packageName,
    period: resolvedSelectionSummary.period,
    plus: resolvedSelectionSummary.plusService,
    price_ksh: resolvedSelectionSummary.priceKsh,
    registrar_name: resolvedSelectionSummary.registrarName,
    type: resolvedSelectionSummary.serviceTypeName,
  });
  const orderLogContext = buildOrderLogContext({
    ...selectionContext,
    selection_snapshot_json: enrichedSelectionSnapshot,
    status: 'received',
  });

  const activeDomainOrder = await findActiveDomainOrderConflict({
    domain_name,
    email,
  });

  if (activeDomainOrder) {
    console.log('---- ORDER PROCESSING ----', {
      stage: 'blocked',
      ...orderLogContext,
      blocking_order_reference:
        activeDomainOrder.external_request_id || activeDomainOrder.request_id,
      reason: 'active_domain_order_exists',
    });

    throw createActiveDomainOrderConflictError(activeDomainOrder);
  }

  let registration;

  try {
    registration = await insertRegistrationWithExternalReference({
      first_name,
      last_name,
      phone,
      email,
      company_name,
      kra_pin,
      street_address,
      city,
      state,
      postcode,
      country,
      full_name: null,
      domain_name,
      target_service: selection.target_service || target_service,
      product_family: selection.product_family || product_family,
      selection_kind: selection.selection_kind,
      domain_extension: selection.domain_extension || domain_extension,
      domain_offering_id: selection.domain_offering_id || null,
      service_package_id: selection.service_package_id || null,
      service_package_price_id: selection.service_package_price_id || null,
      bundle_id: selection.bundle_id || null,
      service_product_code: selection.service_product_code || null,
      package_code: selection.package_code || null,
      package_name: selection.package_name || null,
      billing_cycle: selection.billing_cycle || null,
      billing_period_months: selection.billing_period_months || null,
      currency_code: selection.currency_code || null,
      quoted_price_ksh: selection.quoted_price_ksh || null,
      selection_snapshot_json: enrichedSelectionSnapshot,
      registrar_id: resolvedRegistrarId,
      registrar_name: resolvedRegistrarName,
    });
  } catch (error) {
    if (isActiveOrderConflict(error)) {
      const conflictingOrder = await findActiveDomainOrderConflict({
        domain_name,
        email,
      });

      if (conflictingOrder) {
        console.log('---- ORDER PROCESSING ----', {
          stage: 'blocked',
          ...orderLogContext,
          blocking_order_reference:
            conflictingOrder.external_request_id || conflictingOrder.request_id,
          reason: 'active_domain_order_exists',
        });

        throw createActiveDomainOrderConflictError(conflictingOrder);
      }
    }

    throw error;
  }

  void processRegistrationSideEffects(registration, registrar).catch((error) => {
    console.error('---- ORDER PROCESSING ----', {
      stage: 'delivery_worker_failed',
      ...buildOrderLogContext({
        ...registration,
        selection_snapshot_json: enrichedSelectionSnapshot,
      }),
      error: error.message,
    });
  });

  console.log('---- ORDER PROCESSING ----', {
    stage: 'accepted',
    ...buildOrderLogContext({
      ...registration,
      selection_snapshot_json: enrichedSelectionSnapshot,
    }),
    processing_mode: 'background_dispatch',
  });

  return {
    ...registration,
    message: buildClientAcknowledgementMessage({
      ...selectionContext,
      selection_snapshot_json: enrichedSelectionSnapshot,
    }),
    push_status:
      registrar && registrar.is_active && registrar.api_endpoint
        ? DELIVERY_STATUS.PENDING
        : DELIVERY_STATUS.SKIPPED,
  };
};

exports.retryFailedPushes = async () => {
  console.log('---- RETRYING FAILED PUSHES ----');

  const failed = await pool.query(`
    SELECT DISTINCT ON (registration_id)
      id,
      registration_id,
      attempted_at
    FROM failed_requests
    ORDER BY registration_id, attempted_at DESC
  `);

  let retried = 0;
  let succeeded = 0;

  for (const failedRequest of failed.rows) {
    const registration = await getRegistrationById(failedRequest.registration_id);

    if (!registration) {
      continue;
    }

    const pushResult = await retryRegistrarPushByRegistrationId(
      failedRequest.registration_id
    );
    retried += 1;

    if (pushResult.status === DELIVERY_STATUS.SUCCESS) {
      succeeded += 1;
    }
  }

  console.log('---- FAILED PUSH RETRIES COMPLETED ----');

  return {
    retried,
    succeeded,
  };
};

exports.retryFailedPushByRegistrationId = retryRegistrarPushByRegistrationId;
