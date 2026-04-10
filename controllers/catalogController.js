const catalogService = require('../services/catalogService');

exports.listDomainExtensions = async (_req, res) => {
  try {
    const data = await catalogService.listDomainExtensions();
    return res.status(200).json({ data });
  } catch (error) {
    console.error('Catalog controller error while listing domain extensions:', error.message);
    return res.status(500).json({ message: 'Server error.' });
  }
};

exports.getDomainOffers = async (req, res) => {
  const extension = typeof req.query.extension === 'string' ? req.query.extension.trim() : '';
  const domainName =
    typeof req.query.domain_name === 'string'
      ? req.query.domain_name.trim()
      : typeof req.query.domain === 'string'
      ? req.query.domain.trim()
      : '';

  if (!extension) {
    return res.status(400).json({ message: 'Query parameter "extension" is required.' });
  }

  try {
    const data = await catalogService.getDomainOffersByExtension({
      domainName,
      extension,
    });

    return res.status(200).json({ data });
  } catch (error) {
    console.error('Catalog controller error while listing domain offers:', error.message);
    if (error.message === 'Domain extension not found.') {
      return res.status(404).json({ message: error.message });
    }

    return res.status(500).json({ message: 'Server error.' });
  }
};

exports.getRegistrarOfferings = async (req, res) => {
  const registrarCode =
    typeof req.params.registrarCode === 'string' ? req.params.registrarCode.trim() : '';

  if (!registrarCode) {
    return res.status(400).json({ message: 'Registrar code is required.' });
  }

  try {
    const data = await catalogService.getRegistrarCatalogByCode(registrarCode);

    if (!data) {
      return res.status(404).json({ message: 'Registrar not found.' });
    }

    return res.status(200).json({ data });
  } catch (error) {
    console.error('Catalog controller error while loading registrar offerings:', error.message);
    return res.status(500).json({ message: 'Server error.' });
  }
};

exports.getRegistrarDomainOptions = async (req, res) => {
  const registrarCode =
    typeof req.params.registrarCode === 'string' ? req.params.registrarCode.trim() : '';
  const extension = typeof req.query.extension === 'string' ? req.query.extension.trim() : '';

  if (!registrarCode) {
    return res.status(400).json({ message: 'Registrar code is required.' });
  }

  if (!extension) {
    return res.status(400).json({ message: 'Query parameter "extension" is required.' });
  }

  try {
    const data = await catalogService.getRegistrarDomainOptions({
      extension,
      registrarCode,
    });

    if (!data) {
      return res.status(404).json({ message: 'Registrar not found.' });
    }

    return res.status(200).json({ data });
  } catch (error) {
    console.error('Catalog controller error while loading registrar domain options:', error.message);

    if (error.message === 'Domain extension not found.') {
      return res.status(404).json({ message: error.message });
    }

    return res.status(500).json({ message: 'Server error.' });
  }
};

exports.getRegistrarServicePackagesByFamily = async (req, res) => {
  const registrarCode =
    typeof req.params.registrarCode === 'string' ? req.params.registrarCode.trim() : '';
  const productFamily =
    typeof req.params.productFamily === 'string' ? req.params.productFamily.trim() : '';

  if (!registrarCode) {
    return res.status(400).json({ message: 'Registrar code is required.' });
  }

  if (!productFamily) {
    return res.status(400).json({ message: 'Product family is required.' });
  }

  try {
    const data = await catalogService.getRegistrarServicePackagesByFamily({
      productFamily,
      registrarCode,
    });

    if (!data) {
      return res.status(404).json({ message: 'Registrar not found.' });
    }

    return res.status(200).json({ data });
  } catch (error) {
    console.error('Catalog controller error while loading registrar service packages:', error.message);

    if (error.message === 'Unsupported product family.') {
      return res.status(400).json({ message: error.message });
    }

    return res.status(500).json({ message: 'Server error.' });
  }
};
