function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeRegistrarCode(value) {
  return normalizeString(value).toUpperCase();
}

function normalizeExternalRequestId(value) {
  return normalizeString(value).toUpperCase();
}

function isValidExternalRequestId(value) {
  const normalizedValue = normalizeExternalRequestId(value);

  return (
    /^\d{8}$/.test(normalizedValue) ||
    /^(?=.*[A-Z])(?=.*\d)[A-Z0-9]{10}$/.test(normalizedValue)
  );
}

function normalizeEmail(value) {
  return normalizeString(value).toLowerCase();
}

function normalizePhone(value) {
  return normalizeString(value).replace(/\s+/g, '');
}

function normalizeDomainName(value) {
  return normalizeString(value).toLowerCase();
}

function normalizeServiceCode(value) {
  return normalizeString(value).toLowerCase();
}

function normalizeSelectionKind(value) {
  const normalizedValue = normalizeString(value).toLowerCase();

  return ['domain', 'service', 'bundle'].includes(normalizedValue)
    ? normalizedValue
    : '';
}

function normalizeInteger(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const normalizedValue = Number.parseInt(String(value).trim(), 10);
  return Number.isFinite(normalizedValue) ? normalizedValue : null;
}

function normalizeJsonObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  return value;
}

function normalizeRegistrationInput(payload = {}) {
  return {
    full_name: normalizeString(payload.full_name),
    email: normalizeEmail(payload.email),
    phone: normalizePhone(payload.phone),
    domain_name: normalizeDomainName(payload.domain_name),
    target_service: normalizeServiceCode(payload.target_service),
    product_family: normalizeServiceCode(payload.product_family || payload.target_service),
    selection_kind: normalizeSelectionKind(payload.selection_kind),
    domain_extension: normalizeDomainName(payload.domain_extension),
    registrar_id: normalizeString(payload.registrar_id),
    registrar_code: normalizeRegistrarCode(payload.registrar_code),
    registrar_name: normalizeString(payload.registrar_name),
    domain_offering_id: normalizeString(payload.domain_offering_id),
    service_package_id: normalizeString(payload.service_package_id),
    service_package_price_id: normalizeString(payload.service_package_price_id),
    bundle_id: normalizeString(payload.bundle_id),
    service_product_code: normalizeServiceCode(payload.service_product_code),
    package_code: normalizeString(payload.package_code),
    package_name: normalizeString(payload.package_name),
    billing_cycle: normalizeServiceCode(payload.billing_cycle),
    billing_period_months: normalizeInteger(payload.billing_period_months),
    currency_code: normalizeString(payload.currency_code).toUpperCase(),
    quoted_price_ksh: normalizeInteger(payload.quoted_price_ksh),
    selection_snapshot_json: normalizeJsonObject(payload.selection_snapshot_json),
  };
}

function hasRequiredRegistrationFields(payload = {}) {
  return Boolean(
    payload.full_name &&
    payload.email &&
    payload.phone &&
    payload.domain_name &&
    (payload.registrar_id || payload.registrar_code || payload.registrar_name)
  );
}

function formatDomainName(domainName) {
  const normalizedDomain = normalizeDomainName(domainName);

  if (!normalizedDomain) {
    return '';
  }

  return normalizedDomain.endsWith('.ke')
    ? normalizedDomain
    : `${normalizedDomain}.ke`;
}

module.exports = {
  formatDomainName,
  hasRequiredRegistrationFields,
  isValidExternalRequestId,
  normalizeExternalRequestId,
  normalizeRegistrationInput,
  normalizeRegistrarCode,
  normalizeSelectionKind,
};
