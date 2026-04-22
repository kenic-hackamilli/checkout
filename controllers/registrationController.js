const registrationService = require('../services/registrationService');
const {
  hasRequiredRegistrationFields,
  normalizeRegistrationInput,
} = require('../utils/validation');

function normalizeTextValue(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

exports.createRegistration = async (req, res) => {
  const payload = normalizeRegistrationInput(req.body);
  const selectionSnapshot =
    payload.selection_snapshot_json && typeof payload.selection_snapshot_json === 'object'
      ? payload.selection_snapshot_json
      : {};
  const serviceTypeName =
    normalizeTextValue(selectionSnapshot.service_name) ||
    normalizeTextValue(selectionSnapshot.service_type_name) ||
    normalizeTextValue(selectionSnapshot.summary_label);
  const selectedOfferingLabel = normalizeTextValue(
    selectionSnapshot.selected_offering_label
  );

  console.log('---- ORDER RECEIVED ----', {
    full_name: payload.full_name,
    email: payload.email,
    phone: payload.phone,
    domain_name: payload.domain_name,
    domain_extension: payload.domain_extension,
    product_family: payload.product_family || null,
    selection_kind: payload.selection_kind || null,
    service_type_name: serviceTypeName,
    package_name: payload.package_name || null,
    selected_offering_label: selectedOfferingLabel,
    registrar_code: payload.registrar_code || null,
    registrar_name: payload.registrar_name,
    target_service:
      payload.service_product_code || payload.target_service || payload.product_family || null,
  });

  try {
    if (!hasRequiredRegistrationFields(payload)) {
      console.log('---- ORDER PROCESSING ----', {
        stage: 'rejected',
        http_status: 400,
        reason: 'missing_required_fields',
      });
      return res.status(400).json({ message: 'All fields are required.' });
    }

    const registration = await registrationService.createRegistration(payload);

    const userMessage =
      registration.message ||
      'We have received your order and it is being processed. Kindly await next steps from the selected registrar.';

    return res.status(201).json({
      request_id: registration.external_request_id || registration.request_id,
      registrar_code: registration.registrar_code || null,
      status: registration.status,
      pushed: Boolean(registration.pushed),
      message: userMessage,
    });

  } catch (err) {
    console.error('Controller error while creating registration:', err.message);
    if (
      err.message === 'Registrar not found.' ||
      err.message === 'Selected domain option not found.' ||
      err.message === 'Selected service package not found.' ||
      err.message === 'Selected bundle not found.'
    ) {
      console.log('---- ORDER PROCESSING ----', {
        stage: 'rejected',
        http_status: 400,
        reason: err.message,
      });
      return res.status(400).json({ message: err.message });
    }
    if (err.code === 'ACTIVE_DOMAIN_ORDER_EXISTS') {
      console.log('---- ORDER PROCESSING ----', {
        stage: 'blocked',
        conflicting_request_id: err.request_id || null,
        http_status: 409,
        reason: 'active_domain_order_exists',
      });
      return res.status(409).json({
        message: err.message,
        request_id: err.request_id || null,
      });
    }
    console.log('---- ORDER PROCESSING ----', {
      stage: 'failed',
      http_status: 500,
      reason: err.message,
    });
    return res.status(500).json({ message: 'Server error.' });
  }
};
