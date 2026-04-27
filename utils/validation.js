const USER_PROFILE_LIMITS = {
  city: { min: 2, max: 60 },
  company_name: { min: 2, max: 120 },
  first_name: { min: 2, max: 50 },
  kra_pin: { exact: 11 },
  last_name: { min: 2, max: 50 },
  postcode: { min: 3, max: 12 },
  state: { min: 2, max: 60 },
  street_address: { min: 5, max: 140 },
  country: { min: 2, max: 60 },
};

const REGISTRATION_EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const REGISTRATION_PHONE_REGEX = /^\+[1-9][0-9]{7,14}$/;
const REGISTRATION_POSTCODE_REGEX = /^[A-Z0-9][A-Z0-9 -]*[A-Z0-9]$/i;
const REGISTRATION_KRA_PIN_REGEX = /^[A-Z][0-9]{9}[A-Z]$/;

function pickFirstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null);
}

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeInlineString(value) {
  return normalizeString(value).replace(/\s+/g, ' ');
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

function normalizePurchaseLabel(value) {
  return normalizeInlineString(value);
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

function normalizeNullableInlineString(value) {
  const normalizedValue = normalizeInlineString(value);
  return normalizedValue || null;
}

function normalizeNullableCompactUppercaseString(value) {
  const normalizedValue = normalizeString(value).replace(/\s+/g, '').toUpperCase();
  return normalizedValue || null;
}

function normalizeUppercaseInlineString(value) {
  return normalizeInlineString(value).toUpperCase();
}

function normalizeNullablePurchaseLabel(value) {
  const normalizedValue = normalizePurchaseLabel(value);
  return normalizedValue || null;
}

function splitFullName(value) {
  const parts = normalizeInlineString(value).split(/\s+/).filter(Boolean);

  return {
    first_name: parts[0] || '',
    last_name: parts.slice(1).join(' '),
  };
}

function getLengthError(value, label, limits) {
  if (value.length < limits.min) {
    return `${label} must be at least ${limits.min} characters.`;
  }

  if (value.length > limits.max) {
    return `${label} must be ${limits.max} characters or fewer.`;
  }

  return null;
}

function validateNameField(value, label, limits) {
  if (!value) {
    return `${label} is required.`;
  }

  const lengthError = getLengthError(value, label, limits);
  if (lengthError) {
    return lengthError;
  }

  if (/\d/.test(value)) {
    return `${label} should not include numbers.`;
  }

  return null;
}

function validateEmail(value) {
  if (!value) {
    return 'Email address is required.';
  }

  if (!REGISTRATION_EMAIL_REGEX.test(value)) {
    return 'Use a valid email address.';
  }

  return null;
}

function validatePhone(value) {
  if (!value) {
    return 'Phone number is required.';
  }

  if (!REGISTRATION_PHONE_REGEX.test(value)) {
    return 'Phone number must use international format like +254712345678.';
  }

  return null;
}

function validateOptionalCompanyName(value) {
  if (!value) {
    return null;
  }

  return getLengthError(value, 'Company name', USER_PROFILE_LIMITS.company_name);
}

function validateKraPin(value) {
  if (!value) {
    return null;
  }

  if (value.length !== USER_PROFILE_LIMITS.kra_pin.exact) {
    return `KRA PIN must be ${USER_PROFILE_LIMITS.kra_pin.exact} characters.`;
  }

  if (!REGISTRATION_KRA_PIN_REGEX.test(value)) {
    return 'Use a valid KRA PIN format, for example A123456789Z.';
  }

  return null;
}

function validateStreetAddress(value) {
  if (!value) {
    return 'Street address is required.';
  }

  const lengthError = getLengthError(
    value,
    'Street address',
    USER_PROFILE_LIMITS.street_address
  );

  if (lengthError) {
    return lengthError;
  }

  if (!/[A-Za-z0-9]/.test(value)) {
    return 'Street address should include letters or numbers.';
  }

  return null;
}

function validateLocationField(value, label, limits, { allowNumbers = true } = {}) {
  if (!value) {
    return `${label} is required.`;
  }

  const lengthError = getLengthError(value, label, limits);
  if (lengthError) {
    return lengthError;
  }

  if (!allowNumbers && /\d/.test(value)) {
    return `${label} should not include numbers.`;
  }

  return null;
}

function validatePostcode(value) {
  if (!value) {
    return 'Post code is required.';
  }

  const lengthError = getLengthError(value, 'Post code', USER_PROFILE_LIMITS.postcode);
  if (lengthError) {
    return lengthError;
  }

  if (!REGISTRATION_POSTCODE_REGEX.test(value)) {
    return 'Post code can only include letters, numbers, spaces, or hyphens.';
  }

  return null;
}

function normalizeRegistrationInput(payload = {}) {
  const input = payload && typeof payload === 'object' ? payload : {};
  const normalizedFirstNameCandidate = normalizeInlineString(
    pickFirstDefined(input.first_name, input.firstName)
  );
  const normalizedLastNameCandidate = normalizeInlineString(
    pickFirstDefined(input.last_name, input.lastName)
  );
  const normalizedLegacyFullName = normalizeInlineString(
    pickFirstDefined(input.full_name, input.fullName)
  );
  const splitLegacyName =
    !normalizedFirstNameCandidate || !normalizedLastNameCandidate
      ? splitFullName(normalizedLegacyFullName)
      : { first_name: '', last_name: '' };
  const first_name = normalizedFirstNameCandidate || splitLegacyName.first_name;
  const last_name = normalizedLastNameCandidate || splitLegacyName.last_name;
  const domain_extension = normalizeDomainName(input.domain_extension);
  const plus = normalizeNullablePurchaseLabel(
    pickFirstDefined(input.plus, input.product_family_label)
  );
  const normalizedType = normalizeNullablePurchaseLabel(
    pickFirstDefined(input.type, input.service_type_name, input.service_name)
  );
  const selectedPackage = normalizeNullablePurchaseLabel(
    pickFirstDefined(input.package, input.package_name)
  );
  const typeLooksLikeDomainExtension =
    !plus &&
    !selectedPackage &&
    normalizedType &&
    domain_extension &&
    normalizeDomainName(normalizedType) === domain_extension;
  const type = typeLooksLikeDomainExtension ? null : normalizedType;

  return {
    first_name,
    last_name,
    phone: normalizePhone(input.phone),
    email: normalizeEmail(input.email),
    company_name: normalizeNullableInlineString(
      pickFirstDefined(input.company_name, input.companyName)
    ),
    kra_pin: normalizeNullableCompactUppercaseString(
      pickFirstDefined(input.kra_pin, input.kraPin)
    ),
    street_address: normalizeInlineString(
      pickFirstDefined(input.street_address, input.streetAddress)
    ),
    city: normalizeInlineString(input.city),
    state: normalizeInlineString(input.state),
    postcode: normalizeUppercaseInlineString(input.postcode),
    country: normalizeInlineString(input.country),
    domain_name: normalizeDomainName(input.domain_name),
    domain_extension,
    plus,
    type,
    package: selectedPackage,
    registrar_id: normalizeString(input.registrar_id),
    registrar_code: normalizeRegistrarCode(input.registrar_code),
    registrar_name: normalizeInlineString(
      pickFirstDefined(input.registrar_name, input.registrar)
    ),
    price_ksh: normalizeInteger(
      pickFirstDefined(input.price_ksh, input.quoted_price_ksh)
    ),
    period: normalizeNullablePurchaseLabel(
      pickFirstDefined(input.period, input.billing_label, input.package_billing_label)
    ),
    currency_code: normalizeString(input.currency_code).toUpperCase(),
    user_id: normalizeString(input.user_id),
    target_service: normalizeServiceCode(input.target_service),
    product_family: normalizeServiceCode(input.product_family || input.target_service),
    selection_kind: normalizeSelectionKind(input.selection_kind),
    domain_offering_id: normalizeString(input.domain_offering_id),
    service_package_id: normalizeString(input.service_package_id),
    service_package_price_id: normalizeString(input.service_package_price_id),
    bundle_id: normalizeString(input.bundle_id),
    service_product_code: normalizeServiceCode(input.service_product_code),
    package_code: normalizeString(input.package_code),
    package_name: normalizeNullablePurchaseLabel(
      pickFirstDefined(input.package_name, input.package)
    ),
    billing_cycle: normalizeServiceCode(input.billing_cycle),
    billing_period_months: normalizeInteger(input.billing_period_months),
    quoted_price_ksh: normalizeInteger(
      pickFirstDefined(input.quoted_price_ksh, input.price_ksh)
    ),
    selection_snapshot_json: normalizeJsonObject(input.selection_snapshot_json),
    legacy_full_name: normalizedLegacyFullName || null,
  };
}

function validateRegistrationInput(payload = {}) {
  const normalizedPayload = normalizeRegistrationInput(payload);
  const errors = {};

  const firstNameError = validateNameField(
    normalizedPayload.first_name,
    'First name',
    USER_PROFILE_LIMITS.first_name
  );
  if (firstNameError) {
    errors.first_name = firstNameError;
  }

  const lastNameError = validateNameField(
    normalizedPayload.last_name,
    'Last name',
    USER_PROFILE_LIMITS.last_name
  );
  if (lastNameError) {
    errors.last_name = lastNameError;
  }

  const emailError = validateEmail(normalizedPayload.email);
  const phoneError = validatePhone(normalizedPayload.phone);
  if (phoneError) {
    errors.phone = phoneError;
  }

  if (emailError) {
    errors.email = emailError;
  }

  const companyNameError = validateOptionalCompanyName(normalizedPayload.company_name);
  if (companyNameError) {
    errors.company_name = companyNameError;
  }

  const kraPinError = validateKraPin(normalizedPayload.kra_pin);
  if (kraPinError) {
    errors.kra_pin = kraPinError;
  }

  const streetAddressError = validateStreetAddress(normalizedPayload.street_address);
  if (streetAddressError) {
    errors.street_address = streetAddressError;
  }

  const cityError = validateLocationField(
    normalizedPayload.city,
    'City',
    USER_PROFILE_LIMITS.city,
    { allowNumbers: false }
  );
  if (cityError) {
    errors.city = cityError;
  }

  const stateError = validateLocationField(
    normalizedPayload.state,
    'State',
    USER_PROFILE_LIMITS.state,
    { allowNumbers: false }
  );
  if (stateError) {
    errors.state = stateError;
  }

  const postcodeError = validatePostcode(normalizedPayload.postcode);
  if (postcodeError) {
    errors.postcode = postcodeError;
  }

  const countryError = validateLocationField(
    normalizedPayload.country,
    'Country',
    USER_PROFILE_LIMITS.country
  );
  if (countryError) {
    errors.country = countryError;
  }

  if (!normalizedPayload.domain_name) {
    errors.domain_name = 'Domain name is required.';
  }

  if (!normalizedPayload.domain_extension) {
    errors.domain_extension = 'Domain extension is required.';
  }

  if (
    !normalizedPayload.registrar_id &&
    !normalizedPayload.registrar_code &&
    !normalizedPayload.registrar_name
  ) {
    errors.registrar = 'Registrar selection is required.';
  }

  if (!normalizedPayload.period) {
    errors.period = 'Billing period is required.';
  }

  return {
    errors,
    isValid: Object.keys(errors).length === 0,
    normalizedPayload,
  };
}

function hasRequiredRegistrationFields(payload = {}) {
  return validateRegistrationInput(payload).isValid;
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
  validateRegistrationInput,
};
