const registrationService = require('../services/registrationService');

exports.createRegistration = async (req, res) => {
    try {
        const { full_name, email, phone, domain_name } = req.body;

        if (!full_name || !email || !phone || !domain_name) {
            return res.status(400).json({ message: 'All fields are required.' });
        }

        const result = await registrationService.createRegistration({
            full_name,
            email,
            phone,
            domain_name
        });

        res.status(201).json({
            request_id: result.request_id,
            status: result.status,
            message: 'Your domain registration request has been received and is being processed.'
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error.' });
    }
};
