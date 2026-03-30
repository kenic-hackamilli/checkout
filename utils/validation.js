function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
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

function normalizeRegistrationInput(payload = {}) {
  return {
    full_name: normalizeString(payload.full_name),
    email: normalizeEmail(payload.email),
    phone: normalizePhone(payload.phone),
    domain_name: normalizeDomainName(payload.domain_name),
    registrar_name: normalizeString(payload.registrar_name),
  };
}

function hasRequiredRegistrationFields(payload = {}) {
  return Boolean(
    payload.full_name &&
    payload.email &&
    payload.phone &&
    payload.domain_name &&
    payload.registrar_name
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
};
