const registrationService = require('../services/registrationService');

exports.createRegistration = async (req, res) => {
  console.log("---- INCOMING API REQUEST /createRegistration ----");
  console.log("Request Body:", req.body);

  try {
    const { full_name, email, phone, domain_name , registrar_name} = req.body;

    // --------------------
    // 1. Validate input
    // --------------------
    console.log("Validating request fields...");

    if (!full_name || !email || !phone || !domain_name) {
      console.log("Validation failed: Missing required fields");
      return res.status(400).json({ message: 'All fields are required.' });
    }

    console.log("Validation passed");

    // --------------------
    // 2. Create registration
    // --------------------
    console.log("Calling registration service...");

    const registration = await registrationService.createRegistration({
      full_name,
      email,
      phone,
      domain_name,
      registrar_name,
    });

    console.log("Service response:", registration);
    console.log("Sending response back to client...");

    return res.status(201).json({
      request_id: registration.request_id,
      status: registration.status,
      message:
        registration.message ||
        'Your order has been received and is being processed. Kindly await next steps from the selected registrar.'
    });

  } catch (err) {
    console.error("Controller error while creating registration:", err);
    if (err.code === 'ACTIVE_DOMAIN_ORDER_EXISTS') {
      return res.status(409).json({
        message: err.message,
        request_id: err.request_id || null,
      });
    }
    return res.status(500).json({ message: 'Server error.' });
  }
};
