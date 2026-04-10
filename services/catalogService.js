const pool = require('../db');

const DOMAIN_PRODUCT_FAMILY = {
  product_family: 'domain_registration',
  product_family_label: 'Domains',
};

const SERVICE_PRODUCT_FAMILY_CONFIG = {
  shared_hosting: {
    productFamily: 'hosting',
    productFamilyLabel: 'Hosting',
  },
  web_hosting: {
    productFamily: 'hosting',
    productFamilyLabel: 'Hosting',
  },
  email_hosting: {
    productFamily: 'emails',
    productFamilyLabel: 'Emails',
  },
  vps_hosting: {
    productFamily: 'servers',
    productFamilyLabel: 'VPS',
  },
  wordpress_hosting: {
    productFamily: 'wordpress',
    productFamilyLabel: 'WordPress Hosting',
  },
  ssl: {
    productFamily: 'security',
    productFamilyLabel: 'SSL Certificates',
  },
};

function getBillingCycle({ billingCycle, billingPeriodMonths }) {
  const normalizedBillingCycle =
    typeof billingCycle === 'string' ? billingCycle.trim().toLowerCase() : '';
  const normalizedBillingPeriodMonths = Number(billingPeriodMonths);

  if (normalizedBillingCycle) {
    return normalizedBillingCycle;
  }

  if (normalizedBillingPeriodMonths === 1) {
    return 'monthly';
  }

  if (normalizedBillingPeriodMonths === 12) {
    return 'yearly';
  }

  if (Number.isFinite(normalizedBillingPeriodMonths) && normalizedBillingPeriodMonths > 0) {
    return 'custom';
  }

  return 'flexible';
}

function getBillingLabel({ billingCycle, billingPeriodMonths, billingLabel }) {
  if (typeof billingLabel === 'string' && billingLabel.trim()) {
    return billingLabel.trim();
  }

  const normalizedBillingCycle =
    typeof billingCycle === 'string' ? billingCycle.trim().toLowerCase() : '';
  const normalizedBillingPeriodMonths = Number(billingPeriodMonths);

  if (normalizedBillingCycle === 'monthly' || normalizedBillingPeriodMonths === 1) {
    return 'Monthly';
  }

  if (normalizedBillingCycle === 'yearly' || normalizedBillingPeriodMonths === 12) {
    return 'Yearly';
  }

  if (Number.isFinite(normalizedBillingPeriodMonths) && normalizedBillingPeriodMonths > 0) {
    return `${normalizedBillingPeriodMonths} months`;
  }

  return 'Flexible';
}

function getPackageBillingBadgeLabel(billingLabel) {
  const normalizedBillingLabel =
    typeof billingLabel === 'string' ? billingLabel.trim() : '';

  if (!normalizedBillingLabel) {
    return 'Flexible package';
  }

  return `${normalizedBillingLabel} package`;
}

function buildBundleItemLabel(bundleItem) {
  if (bundleItem.display_name) {
    return bundleItem.display_name;
  }

  if (bundleItem.item_type === 'domain_extension' && bundleItem.extension) {
    return bundleItem.extension;
  }

  if (bundleItem.item_type === 'service_offering') {
    const baseName = bundleItem.service_name || 'Service';
    return bundleItem.plan_name
      ? `${baseName} - ${bundleItem.plan_name}`
      : baseName;
  }

  return 'Bundle item';
}

function normalizeJsonObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeTextArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean);
}

function getProductFamilyInfo(serviceCode, serviceCategory) {
  const normalizedServiceCode =
    typeof serviceCode === 'string' ? serviceCode.trim().toLowerCase() : '';

  if (SERVICE_PRODUCT_FAMILY_CONFIG[normalizedServiceCode]) {
    return SERVICE_PRODUCT_FAMILY_CONFIG[normalizedServiceCode];
  }

  const normalizedCategory =
    typeof serviceCategory === 'string' ? serviceCategory.trim().toLowerCase() : '';

  if (normalizedCategory === 'hosting') {
    return {
      productFamily: 'hosting',
      productFamilyLabel: 'Hosting',
    };
  }

  if (normalizedCategory === 'email') {
    return {
      productFamily: 'emails',
      productFamilyLabel: 'Emails',
    };
  }

  return {
    productFamily: normalizedCategory || 'other',
    productFamilyLabel: normalizedCategory
      ? normalizedCategory.charAt(0).toUpperCase() + normalizedCategory.slice(1)
      : 'Other',
  };
}

function getServiceCodesForProductFamily(productFamily) {
  const normalizedProductFamily =
    typeof productFamily === 'string' ? productFamily.trim().toLowerCase() : '';

  return Object.entries(SERVICE_PRODUCT_FAMILY_CONFIG)
    .filter(([, value]) => value.productFamily === normalizedProductFamily)
    .map(([serviceCode]) => serviceCode);
}

function getProductFamilyLabelFromId(productFamily) {
  const normalizedProductFamily =
    typeof productFamily === 'string' ? productFamily.trim().toLowerCase() : '';

  if (normalizedProductFamily === DOMAIN_PRODUCT_FAMILY.product_family) {
    return DOMAIN_PRODUCT_FAMILY.product_family_label;
  }

  const matchedEntry = Object.values(SERVICE_PRODUCT_FAMILY_CONFIG).find(
    (value) => value.productFamily === normalizedProductFamily
  );

  if (matchedEntry) {
    return matchedEntry.productFamilyLabel;
  }

  return normalizedProductFamily
    ? normalizedProductFamily.charAt(0).toUpperCase() + normalizedProductFamily.slice(1)
    : 'Other';
}

function pickLowestPricedRow(rows, priceField) {
  if (!rows.length) {
    return null;
  }

  return [...rows].sort((left, right) => {
    const leftPrice = Number(left[priceField] ?? Number.MAX_SAFE_INTEGER);
    const rightPrice = Number(right[priceField] ?? Number.MAX_SAFE_INTEGER);

    if (leftPrice !== rightPrice) {
      return leftPrice - rightPrice;
    }

    const leftBillingPeriod = Number(left.billing_period_months ?? Number.MAX_SAFE_INTEGER);
    const rightBillingPeriod = Number(right.billing_period_months ?? Number.MAX_SAFE_INTEGER);
    return leftBillingPeriod - rightBillingPeriod;
  })[0];
}

function pickDefaultPrice(prices = []) {
  if (!prices.length) {
    return null;
  }

  return [...prices].sort((left, right) => {
    if (Boolean(left.is_default) !== Boolean(right.is_default)) {
      return left.is_default ? -1 : 1;
    }

    const leftPrice = Number(left.price_ksh ?? Number.MAX_SAFE_INTEGER);
    const rightPrice = Number(right.price_ksh ?? Number.MAX_SAFE_INTEGER);

    if (leftPrice !== rightPrice) {
      return leftPrice - rightPrice;
    }

    const leftBillingPeriod = Number(left.billing_period_months ?? Number.MAX_SAFE_INTEGER);
    const rightBillingPeriod = Number(right.billing_period_months ?? Number.MAX_SAFE_INTEGER);
    return leftBillingPeriod - rightBillingPeriod;
  })[0];
}

function createRegistrarCatalogEntry(row) {
  return {
    registrar_id: row.registrar_id,
    registrar_code: row.registrar_code,
    registrar_name: row.registrar_name,
    bundles: [],
    domain_offerings: [],
    product_families: [],
    service_offerings: [],
    service_packages: [],
  };
}

function addDomainOfferings(registrarMap, rows) {
  for (const row of rows) {
    const currentRegistrar =
      registrarMap.get(row.registrar_id) || createRegistrarCatalogEntry(row);

    currentRegistrar.domain_offerings.push({
      billing_cycle: getBillingCycle({
        billingPeriodMonths: row.billing_period_months,
      }),
      billing_label: getBillingLabel({
        billingPeriodMonths: row.billing_period_months,
      }),
      billing_period_months: row.billing_period_months,
      currency_code: row.currency_code,
      domain_extension_id: row.domain_extension_id,
      extension: row.extension,
      extension_code: row.extension_code,
      extension_label: row.extension_label,
      offering_id: row.offering_id,
      registration_price_ksh: row.registration_price_ksh,
      renewal_price_ksh: row.renewal_price_ksh,
      setup_fee_ksh: row.setup_fee_ksh,
      transfer_price_ksh: row.transfer_price_ksh,
    });

    registrarMap.set(row.registrar_id, currentRegistrar);
  }
}

function addServiceOfferings(registrarMap, rows) {
  for (const row of rows) {
    const currentRegistrar =
      registrarMap.get(row.registrar_id) || createRegistrarCatalogEntry(row);

    currentRegistrar.service_offerings.push({
      billing_cycle: getBillingCycle({
        billingCycle: row.billing_cycle,
        billingPeriodMonths: row.billing_period_months,
      }),
      billing_label: getBillingLabel({
        billingCycle: row.billing_cycle,
        billingPeriodMonths: row.billing_period_months,
      }),
      billing_period_months: row.billing_period_months,
      currency_code: row.currency_code,
      features: row.features_json || {},
      offering_id: row.service_offering_id,
      plan_code: row.plan_code,
      plan_name: row.plan_name,
      price_ksh: row.price_ksh,
      service_category: row.service_category,
      service_code: row.service_code,
      service_name: row.service_name,
      setup_fee_ksh: row.setup_fee_ksh,
    });

    registrarMap.set(row.registrar_id, currentRegistrar);
  }
}

function addBundleSummaries(registrarMap, bundleRows, bundleItemRows) {
  const bundleMap = new Map();

  for (const row of bundleRows) {
    const currentRegistrar =
      registrarMap.get(row.registrar_id) || createRegistrarCatalogEntry(row);
    const bundle = {
      bundle_id: row.bundle_id,
      bundle_code: row.bundle_code,
      bundle_name: row.bundle_name,
      currency_code: row.currency_code,
      description: row.description,
      items: [],
      price_ksh: row.price_ksh,
    };

    currentRegistrar.bundles.push(bundle);
    registrarMap.set(row.registrar_id, currentRegistrar);
    bundleMap.set(row.bundle_id, bundle);
  }

  for (const itemRow of bundleItemRows) {
    const currentBundle = bundleMap.get(itemRow.bundle_id);

    if (!currentBundle) {
      continue;
    }

    currentBundle.items.push({
      bundle_item_id: itemRow.bundle_item_id,
      display_name: buildBundleItemLabel(itemRow),
      item_type: itemRow.item_type,
      quantity: itemRow.quantity,
      sort_order: itemRow.sort_order,
    });
  }
}

function groupServicePackages(rows) {
  const packageMap = new Map();

  for (const row of rows) {
    const { productFamily, productFamilyLabel } = getProductFamilyInfo(
      row.service_code,
      row.service_category
    );
    const existingPackage = packageMap.get(row.service_package_id) || {
      feature_bullets: normalizeTextArray(row.feature_bullets_json),
      package_code: row.package_code,
      package_id: row.service_package_id,
      package_name: row.package_name,
      price_count: 0,
      prices: [],
      product_family: productFamily,
      product_family_label: productFamilyLabel,
      service_category: row.service_category,
      service_code: row.service_code,
      service_name: row.service_name,
      short_description: row.short_description,
      details: normalizeJsonObject(row.details_json),
      display_order: row.display_order,
    };

    existingPackage.prices.push({
      billing_cycle: getBillingCycle({
        billingCycle: row.billing_cycle,
        billingPeriodMonths: row.billing_period_months,
      }),
      billing_label: getBillingLabel({
        billingCycle: row.billing_cycle,
        billingPeriodMonths: row.billing_period_months,
        billingLabel: row.billing_label,
      }),
      billing_period_months: row.billing_period_months,
      currency_code: row.currency_code,
      is_default: row.is_default,
      price_id: row.service_package_price_id,
      price_ksh: row.price_ksh,
      setup_fee_ksh: row.setup_fee_ksh,
    });
    existingPackage.price_count = existingPackage.prices.length;

    packageMap.set(row.service_package_id, existingPackage);
  }

  return [...packageMap.values()]
    .map((servicePackage) => {
      const defaultPrice = pickDefaultPrice(servicePackage.prices);

      return {
        ...servicePackage,
        default_price: defaultPrice,
        price_count: defaultPrice ? 1 : 0,
        prices: defaultPrice ? [defaultPrice] : [],
      };
    })
    .sort((left, right) => {
      const leftDisplayOrder = Number(left.display_order ?? Number.MAX_SAFE_INTEGER);
      const rightDisplayOrder = Number(right.display_order ?? Number.MAX_SAFE_INTEGER);

      if (leftDisplayOrder !== rightDisplayOrder) {
        return leftDisplayOrder - rightDisplayOrder;
      }

      return String(left.package_name || '').localeCompare(String(right.package_name || ''));
    });
}

function addServicePackages(registrarMap, rows) {
  const rowsByRegistrar = new Map();

  for (const row of rows) {
    const currentRows = rowsByRegistrar.get(row.registrar_id) || [];
    currentRows.push(row);
    rowsByRegistrar.set(row.registrar_id, currentRows);
  }

  for (const [registrarId, registrarRows] of rowsByRegistrar.entries()) {
    const currentRegistrar =
      registrarMap.get(registrarId) || createRegistrarCatalogEntry(registrarRows[0]);

    currentRegistrar.service_packages = groupServicePackages(registrarRows);
    registrarMap.set(registrarId, currentRegistrar);
  }
}

function addProductFamilies(registrarMap, extension) {
  for (const registrar of registrarMap.values()) {
    const familyMap = new Map();
    const matchingDomainOffers = registrar.domain_offerings.filter((offering) => {
      if (!extension) {
        return true;
      }

      return String(offering.extension || '').toLowerCase() === String(extension).toLowerCase();
    });

    if (matchingDomainOffers.length) {
      const lowestPricedDomainOffer = pickLowestPricedRow(
        matchingDomainOffers,
        'registration_price_ksh'
      );

      familyMap.set(DOMAIN_PRODUCT_FAMILY.product_family, {
        ...DOMAIN_PRODUCT_FAMILY,
        billing_label: lowestPricedDomainOffer
          ? lowestPricedDomainOffer.billing_label
          : 'Yearly',
        currency_code: lowestPricedDomainOffer
          ? lowestPricedDomainOffer.currency_code
          : 'KES',
        entry_count: matchingDomainOffers.length,
        package_count: matchingDomainOffers.length,
        service_codes: [],
        starting_price_ksh: lowestPricedDomainOffer
          ? lowestPricedDomainOffer.registration_price_ksh
          : null,
        summary_label: matchingDomainOffers[0].extension || 'Domain registration',
      });
    }

    const lowestPricedDomainOffer = matchingDomainOffers.length
      ? pickLowestPricedRow(matchingDomainOffers, 'registration_price_ksh')
      : null;
    const fallbackCurrencyCode = lowestPricedDomainOffer
      ? lowestPricedDomainOffer.currency_code
      : null;

    for (const servicePackage of registrar.service_packages) {
      const familyKey = servicePackage.product_family;
      const defaultPrice = servicePackage.default_price || pickDefaultPrice(servicePackage.prices);
      const packageStartingPrice =
        defaultPrice && Number.isFinite(Number(defaultPrice.price_ksh))
          ? Number(defaultPrice.price_ksh)
          : null;
      const currentSummary = familyMap.get(familyKey) || {
        billing_label: defaultPrice
          ? getPackageBillingBadgeLabel(defaultPrice.billing_label)
          : 'Flexible package',
        currency_code:
          (defaultPrice ? defaultPrice.currency_code : null) ||
          fallbackCurrencyCode ||
          'KES',
        domain_billing_label: null,
        domain_extension: null,
        domain_registration_price_ksh: null,
        entry_count: 0,
        package_count: 0,
        package_billing_label: defaultPrice ? defaultPrice.billing_label : null,
        product_family: familyKey,
        product_family_label: servicePackage.product_family_label,
        price_scope: 'fixed_package',
        pricing_note: null,
        service_codes: [],
        service_starting_price_ksh: packageStartingPrice,
        starting_price_ksh: packageStartingPrice,
        summary_label: servicePackage.service_name,
      };

      const packageCodes = new Set(currentSummary._package_codes || []);
      const serviceCodes = new Set(currentSummary.service_codes || []);

      packageCodes.add(servicePackage.package_code);
      serviceCodes.add(servicePackage.service_code);

      if (
        packageStartingPrice !== null &&
        (currentSummary.starting_price_ksh === null ||
          packageStartingPrice < Number(currentSummary.starting_price_ksh))
      ) {
        currentSummary.starting_price_ksh = packageStartingPrice;
        currentSummary.currency_code =
          defaultPrice.currency_code || currentSummary.currency_code;
        currentSummary.billing_label = getPackageBillingBadgeLabel(
          defaultPrice.billing_label
        );
        currentSummary.package_billing_label = defaultPrice.billing_label;
        currentSummary.service_starting_price_ksh = packageStartingPrice;
        currentSummary.summary_label = servicePackage.service_name;
      }

      currentSummary.service_codes = [...serviceCodes];
      currentSummary.package_count = packageCodes.size;
      currentSummary.entry_count = packageCodes.size;
      currentSummary._package_codes = [...packageCodes];

      familyMap.set(familyKey, currentSummary);
    }

    registrar.product_families = [...familyMap.values()]
      .map((family) => {
        const { _package_codes: _packageCodes, ...safeFamily } = family;
        return safeFamily;
      })
      .sort((left, right) => {
        if (left.product_family === DOMAIN_PRODUCT_FAMILY.product_family) {
          return -1;
        }

        if (right.product_family === DOMAIN_PRODUCT_FAMILY.product_family) {
          return 1;
        }

        return String(left.product_family_label || '').localeCompare(
          String(right.product_family_label || '')
        );
      });
  }
}

async function listDomainExtensions() {
  const result = await pool.query(`
    SELECT
      id,
      code,
      label,
      extension,
      category_key,
      sort_order,
      is_active
    FROM domain_extensions
    WHERE is_active = true
    ORDER BY sort_order ASC, label ASC
  `);

  return result.rows;
}

async function getDomainExtensionByValue(extension) {
  const result = await pool.query(
    `
      SELECT
        id,
        code,
        label,
        extension,
        category_key,
        sort_order,
        is_active
      FROM domain_extensions
      WHERE LOWER(extension) = LOWER($1)
      LIMIT 1
    `,
    [extension]
  );

  return result.rows[0] || null;
}

async function getRegistrarByCode(registrarCode) {
  const registrarResult = await pool.query(
    `
      SELECT
        id AS registrar_id,
        registrar_code,
        name AS registrar_name,
        api_endpoint,
        notification_email,
        is_active,
        created_at
      FROM registrars
      WHERE registrar_code = $1
      LIMIT 1
    `,
    [String(registrarCode || '').trim().toUpperCase()]
  );

  return registrarResult.rows[0] || null;
}

async function getDomainOfferingRows({ extension, registrarIds, registrarId }) {
  const params = [];
  const filters = ['r.is_active = true', 'rdo.is_active = true'];

  if (registrarIds) {
    params.push(registrarIds);
    filters.push(`rdo.registrar_id = ANY($${params.length}::uuid[])`);
  }

  if (registrarId) {
    params.push(registrarId);
    filters.push(`rdo.registrar_id = $${params.length}`);
  }

  if (extension) {
    params.push(extension);
    filters.push(`LOWER(de.extension) = LOWER($${params.length})`);
  }

  const result = await pool.query(
    `
      SELECT
        r.id AS registrar_id,
        r.registrar_code,
        r.name AS registrar_name,
        rdo.id AS offering_id,
        rdo.registration_price_ksh,
        rdo.renewal_price_ksh,
        rdo.transfer_price_ksh,
        rdo.setup_fee_ksh,
        rdo.currency_code,
        rdo.billing_period_months,
        de.id AS domain_extension_id,
        de.code AS extension_code,
        de.label AS extension_label,
        de.extension
      FROM registrar_domain_offerings rdo
      INNER JOIN registrars r
        ON r.id = rdo.registrar_id
      INNER JOIN domain_extensions de
        ON de.id = rdo.domain_extension_id
      WHERE ${filters.join('\n        AND ')}
      ORDER BY
        LOWER(r.name) ASC,
        rdo.registration_price_ksh ASC,
        rdo.billing_period_months ASC
    `,
    params
  );

  return result.rows;
}

async function getServiceOfferingsByRegistrarIds(registrarIds) {
  if (!registrarIds.length) {
    return [];
  }

  const result = await pool.query(
    `
      SELECT
        r.id AS registrar_id,
        r.registrar_code,
        r.name AS registrar_name,
        rso.id AS service_offering_id,
        rso.plan_code,
        rso.plan_name,
        rso.billing_cycle,
        rso.billing_period_months,
        rso.price_ksh,
        rso.setup_fee_ksh,
        rso.currency_code,
        rso.features_json,
        sp.service_code,
        sp.name AS service_name,
        sp.service_category
      FROM registrar_service_offerings rso
      INNER JOIN registrars r
        ON r.id = rso.registrar_id
      INNER JOIN service_products sp
        ON sp.id = rso.service_product_id
      WHERE rso.registrar_id = ANY($1::uuid[])
        AND r.is_active = true
        AND rso.is_active = true
        AND sp.is_active = true
      ORDER BY LOWER(r.name) ASC, LOWER(sp.name) ASC, LOWER(rso.plan_name) ASC
    `,
    [registrarIds]
  );

  return result.rows;
}

async function getServicePackagePriceRows({ registrarIds, registrarId, serviceCodes }) {
  const params = [];
  const filters = [
    'r.is_active = true',
    'rsp.is_active = true',
    'rspp.is_active = true',
    'sp.is_active = true',
  ];

  if (registrarIds) {
    params.push(registrarIds);
    filters.push(`rsp.registrar_id = ANY($${params.length}::uuid[])`);
  }

  if (registrarId) {
    params.push(registrarId);
    filters.push(`rsp.registrar_id = $${params.length}`);
  }

  if (serviceCodes && serviceCodes.length) {
    params.push(serviceCodes);
    filters.push(`sp.service_code = ANY($${params.length}::text[])`);
  }

  const result = await pool.query(
    `
      SELECT
        r.id AS registrar_id,
        r.registrar_code,
        r.name AS registrar_name,
        rsp.id AS service_package_id,
        rsp.package_code,
        rsp.package_name,
        rsp.short_description,
        rsp.details_json,
        rsp.feature_bullets_json,
        rsp.display_order,
        rspp.id AS service_package_price_id,
        rspp.billing_cycle,
        rspp.billing_period_months,
        rspp.billing_label,
        rspp.price_ksh,
        rspp.setup_fee_ksh,
        rspp.currency_code,
        rspp.is_default,
        sp.service_code,
        sp.name AS service_name,
        sp.service_category
      FROM registrar_service_packages rsp
      INNER JOIN registrars r
        ON r.id = rsp.registrar_id
      INNER JOIN service_products sp
        ON sp.id = rsp.service_product_id
      INNER JOIN registrar_service_package_prices rspp
        ON rspp.service_package_id = rsp.id
      WHERE ${filters.join('\n        AND ')}
      ORDER BY
        LOWER(r.name) ASC,
        rsp.display_order ASC,
        LOWER(rsp.package_name) ASC,
        rspp.is_default DESC,
        rspp.price_ksh ASC,
        rspp.billing_period_months ASC
    `,
    params
  );

  return result.rows;
}

async function getBundleSummariesByRegistrarIds(registrarIds) {
  if (!registrarIds.length) {
    return { bundleItemRows: [], bundleRows: [] };
  }

  const [bundleResult, bundleItemResult] = await Promise.all([
    pool.query(
      `
        SELECT
          bt.id AS bundle_id,
          bt.registrar_id,
          r.registrar_code,
          r.name AS registrar_name,
          bt.bundle_code,
          bt.bundle_name,
          bt.description,
          bt.price_ksh,
          bt.currency_code
        FROM bundle_templates bt
        INNER JOIN registrars r
          ON r.id = bt.registrar_id
        WHERE bt.registrar_id = ANY($1::uuid[])
          AND r.is_active = true
          AND bt.is_active = true
        ORDER BY LOWER(r.name) ASC, LOWER(bt.bundle_name) ASC
      `,
      [registrarIds]
    ),
    pool.query(
      `
        SELECT
          bi.id AS bundle_item_id,
          bi.bundle_id,
          bi.item_type,
          bi.display_name,
          bi.quantity,
          bi.sort_order,
          de.extension,
          sp.name AS service_name,
          rso.plan_name
        FROM bundle_items bi
        INNER JOIN bundle_templates bt
          ON bt.id = bi.bundle_id
        LEFT JOIN domain_extensions de
          ON de.id = bi.domain_extension_id
        LEFT JOIN registrar_service_offerings rso
          ON rso.id = bi.service_offering_id
        LEFT JOIN service_products sp
          ON sp.id = rso.service_product_id
        WHERE bt.registrar_id = ANY($1::uuid[])
          AND bt.is_active = true
        ORDER BY bi.sort_order ASC, bi.created_at ASC
      `,
      [registrarIds]
    ),
  ]);

  return {
    bundleItemRows: bundleItemResult.rows,
    bundleRows: bundleResult.rows,
  };
}

async function getDomainOffersByExtension({ domainName, extension }) {
  const domainExtension = await getDomainExtensionByValue(extension);

  if (!domainExtension) {
    throw new Error('Domain extension not found.');
  }

  const domainRows = await getDomainOfferingRows({ extension });
  const registrarMap = new Map();
  addDomainOfferings(registrarMap, domainRows);

  const registrarIds = [...registrarMap.keys()];
  const [serviceRows, servicePackageRows, bundleSummary] = await Promise.all([
    getServiceOfferingsByRegistrarIds(registrarIds),
    getServicePackagePriceRows({ registrarIds }),
    getBundleSummariesByRegistrarIds(registrarIds),
  ]);

  addServiceOfferings(registrarMap, serviceRows);
  addServicePackages(registrarMap, servicePackageRows);
  addBundleSummaries(
    registrarMap,
    bundleSummary.bundleRows,
    bundleSummary.bundleItemRows
  );
  addProductFamilies(registrarMap, extension);

  return {
    currency_code: 'KES',
    domain_name: domainName || null,
    extension: domainExtension,
    registrars: [...registrarMap.values()],
  };
}

async function getRegistrarCatalogByCode(registrarCode) {
  const registrar = await getRegistrarByCode(registrarCode);

  if (!registrar) {
    return null;
  }

  const [domainRows, serviceRows, servicePackageRows, bundleSummary] = await Promise.all([
    getDomainOfferingRows({ registrarId: registrar.registrar_id }),
    getServiceOfferingsByRegistrarIds([registrar.registrar_id]),
    getServicePackagePriceRows({ registrarId: registrar.registrar_id }),
    getBundleSummariesByRegistrarIds([registrar.registrar_id]),
  ]);

  const registrarMap = new Map();
  registrarMap.set(registrar.registrar_id, {
    ...registrar,
    bundles: [],
    domain_offerings: [],
    product_families: [],
    service_offerings: [],
    service_packages: [],
  });

  addDomainOfferings(registrarMap, domainRows);
  addServiceOfferings(registrarMap, serviceRows);
  addServicePackages(registrarMap, servicePackageRows);
  addBundleSummaries(
    registrarMap,
    bundleSummary.bundleRows,
    bundleSummary.bundleItemRows
  );
  addProductFamilies(registrarMap);

  return registrarMap.get(registrar.registrar_id);
}

async function getRegistrarDomainOptions({ extension, registrarCode }) {
  const registrar = await getRegistrarByCode(registrarCode);

  if (!registrar) {
    return null;
  }

  const domainExtension = await getDomainExtensionByValue(extension);

  if (!domainExtension) {
    throw new Error('Domain extension not found.');
  }

  const rows = await getDomainOfferingRows({
    extension,
    registrarId: registrar.registrar_id,
  });

  return {
    ...DOMAIN_PRODUCT_FAMILY,
    domain_name: null,
    extension: domainExtension,
    options: rows.map((row) => ({
      billing_cycle: getBillingCycle({
        billingPeriodMonths: row.billing_period_months,
      }),
      billing_label: getBillingLabel({
        billingPeriodMonths: row.billing_period_months,
      }),
      billing_period_months: row.billing_period_months,
      currency_code: row.currency_code,
      offering_id: row.offering_id,
      registration_price_ksh: row.registration_price_ksh,
      renewal_price_ksh: row.renewal_price_ksh,
      setup_fee_ksh: row.setup_fee_ksh,
      transfer_price_ksh: row.transfer_price_ksh,
    })),
    registrar: {
      registrar_code: registrar.registrar_code,
      registrar_id: registrar.registrar_id,
      registrar_name: registrar.registrar_name,
    },
  };
}

async function getRegistrarServicePackagesByFamily({ productFamily, registrarCode }) {
  const registrar = await getRegistrarByCode(registrarCode);

  if (!registrar) {
    return null;
  }

  const serviceCodes = getServiceCodesForProductFamily(productFamily);

  if (!serviceCodes.length) {
    throw new Error('Unsupported product family.');
  }

  const rows = await getServicePackagePriceRows({
    registrarId: registrar.registrar_id,
    serviceCodes,
  });

  const packages = groupServicePackages(rows);
  const familyInfo =
    packages[0] && packages[0].product_family
      ? {
          product_family: packages[0].product_family,
          product_family_label: packages[0].product_family_label,
        }
      : {
          product_family: productFamily,
          product_family_label: getProductFamilyLabelFromId(productFamily),
        };

  return {
    ...familyInfo,
    packages,
    registrar: {
      registrar_code: registrar.registrar_code,
      registrar_id: registrar.registrar_id,
      registrar_name: registrar.registrar_name,
    },
  };
}

module.exports = {
  getDomainOffersByExtension,
  getRegistrarCatalogByCode,
  getRegistrarDomainOptions,
  getRegistrarServicePackagesByFamily,
  listDomainExtensions,
};
