const registrationService = require('../services/registrationService');
const {
  normalizeRegistrationInput,
  validateRegistrationInput,
} = require('../utils/validation');

exports.createRegistration = async (req, res) => {
  const payload = normalizeRegistrationInput(req.body);
  const validation = validateRegistrationInput(payload);

  console.log('---- ORDER RECEIVED ----', {
    first_name: payload.first_name,
    last_name: payload.last_name,
    phone: payload.phone,
    email: payload.email,
    company_name: payload.company_name || null,
    city: payload.city || null,
    state: payload.state || null,
    country: payload.country || null,
    domain_name: payload.domain_name,
    domain_extension: payload.domain_extension,
    plus: payload.plus || null,
    type: payload.type || null,
    package: payload.package || null,
    registrar_name: payload.registrar_name,
    price_ksh: payload.price_ksh,
    period: payload.period || null,
  });

  try {
    if (!validation.isValid) {
      console.log('---- ORDER PROCESSING ----', {
        stage: 'rejected',
        http_status: 422,
        reason: 'invalid_registration_payload',
        validation_errors: validation.errors,
      });
      return res.status(422).json({
        error_code: 'INVALID_REGISTRATION_PAYLOAD',
        errors: validation.errors,
        message: 'The registration payload is incomplete or invalid.',
      });
    }

    const registration = await registrationService.createRegistration(payload);

    const userMessage =
      registration.message ||
      'We have received your order and it is being processed. Kindly await next steps from the selected registrar.';

    return res.status(201).json({
      request_id: registration.external_request_id || registration.request_id,
      status: registration.status,
      pushed: Boolean(registration.pushed),
      message: userMessage,
    });

  } catch (err) {
    console.error('Controller error while creating registration:', err.message);
    const notFoundErrorCodes = {
      'Registrar not found.': 'REGISTRAR_NOT_FOUND',
      'Selected bundle not found.': 'SELECTED_BUNDLE_NOT_FOUND',
      'Selected domain option not found.': 'SELECTED_DOMAIN_OPTION_NOT_FOUND',
      'Selected service package not found.': 'SELECTED_SERVICE_PACKAGE_NOT_FOUND',
    };
    const notFoundErrorCode = notFoundErrorCodes[err.message];

    if (notFoundErrorCode) {
      console.log('---- ORDER PROCESSING ----', {
        stage: 'rejected',
        http_status: 404,
        reason: err.message,
      });
      return res.status(404).json({
        error_code: notFoundErrorCode,
        message: err.message,
      });
    }
    if (err.code === 'ACTIVE_DOMAIN_ORDER_EXISTS') {
      console.log('---- ORDER PROCESSING ----', {
        stage: 'blocked',
        conflicting_request_id: err.request_id || null,
        http_status: 409,
        reason: 'active_domain_order_exists',
      });
      return res.status(409).json({
        error_code: 'ACTIVE_DOMAIN_ORDER_EXISTS',
        message: err.message,
        request_id: err.request_id || null,
      });
    }
    console.log('---- ORDER PROCESSING ----', {
      stage: 'failed',
      http_status: 500,
      reason: err.message,
    });
    return res.status(500).json({
      error_code: 'INTERNAL_SERVER_ERROR',
      message: 'Server error.',
    });
  }
};
