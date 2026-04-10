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
            message: 'Your order has been received and is being processed. Kindly await next steps from the selected registrar.'
        });

    } catch (err) {
        console.error(err);
        if (err.code === 'ACTIVE_DOMAIN_ORDER_EXISTS') {
            return res.status(409).json({
                message: err.message,
                request_id: err.request_id || null,
            });
        }
        res.status(500).json({ message: 'Server error.' });
    }
};
