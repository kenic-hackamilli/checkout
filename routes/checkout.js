const express = require('express');
const router = express.Router();
const registrationController = require('../controllers/registrationController');
const catalogController = require('../controllers/catalogController');

// Read catalog data under the same /checkout base path.
router.get('/catalog/domain-extensions', catalogController.listDomainExtensions);
router.get('/catalog/domain-offers', catalogController.getDomainOffers);
router.get('/catalog/registrars/:registrarCode/offerings', catalogController.getRegistrarOfferings);
router.get(
  '/catalog/registrars/:registrarCode/domain-options',
  catalogController.getRegistrarDomainOptions
);
router.get(
  '/catalog/registrars/:registrarCode/product-families/:productFamily/packages',
  catalogController.getRegistrarServicePackagesByFamily
);

// Legacy-compatible registration entrypoint.
router.post('/', registrationController.createRegistration);
router.post('/registrations', registrationController.createRegistration);

module.exports = router;
