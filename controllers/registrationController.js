const registrationService = require('../services/registrationService');
const {
  hasRequiredRegistrationFields,
  normalizeRegistrationInput,
} = require('../utils/validation');

exports.createRegistration = async (req, res) => {
  const payload = normalizeRegistrationInput(req.body);

  console.log('---- INCOMING API REQUEST /createRegistration ----');
  console.log('Registration request received:', {
    domain_name: payload.domain_name,
    registrar_name: payload.registrar_name,
  });

  try {
    if (!hasRequiredRegistrationFields(payload)) {
      console.log('Validation failed: missing required fields');
      return res.status(400).json({ message: 'All fields are required.' });
    }

    const registration = await registrationService.createRegistration(payload);

    let userMessage = registration.message ||
      'Your domain registration request has been received and is being processed.';

    if (!registration.message && registration.push_status === 'success') {
      userMessage = 'Your request has been submitted and sent to the registrar.';
    } else if (!registration.message && registration.push_status === 'failed') {
      userMessage = 'Your request has been submitted, but registrar push failed. It will be retried automatically.';
    } else if (!registration.message && registration.push_status === 'skipped') {
      userMessage = 'Your request has been submitted and saved. Registrar push is not configured for this registrar yet.';
    }

    console.log('Sending response back to client...');

    return res.status(201).json({
      request_id: registration.external_request_id || registration.request_id,
      status: registration.status,
      pushed: Boolean(registration.pushed),
      message: userMessage,
    });

  } catch (err) {
    console.error('Controller error while creating registration:', err.message);
    return res.status(500).json({ message: 'Server error.' });
  }
};
