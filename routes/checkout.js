const express = require('express');
const router = express.Router();
const registrationController = require('../controllers/registrationController');

// POST /checkout
router.post('/', registrationController.createRegistration);

module.exports = router;
