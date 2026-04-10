WITH registrar_seed(name, api_endpoint, notification_email, is_active) AS (
    VALUES
        ('Truehost Cloud Limited', NULL, NULL, true),
        ('Kenya Website Experts', NULL, NULL, true),
        ('Safaricom Kenya', NULL, NULL, true),
        ('HostPinnacle Cloud Limited', NULL, NULL, true)
)
INSERT INTO registrars (name, api_endpoint, notification_email, is_active)
SELECT
    registrar_seed.name,
    registrar_seed.api_endpoint,
    registrar_seed.notification_email,
    registrar_seed.is_active
FROM registrar_seed
WHERE NOT EXISTS (
    SELECT 1
    FROM registrars
    WHERE LOWER(registrars.name) = LOWER(registrar_seed.name)
);

WITH domain_offer_seed(
    registrar_name,
    extension,
    registration_price_ksh,
    renewal_price_ksh,
    transfer_price_ksh,
    setup_fee_ksh,
    billing_period_months
) AS (
    VALUES
        ('Truehost Cloud Limited', '.co.ke', 1199, 1199, 950, 0, 12),
        ('Truehost Cloud Limited', '.or.ke', 1099, 1099, 900, 0, 12),
        ('Truehost Cloud Limited', '.me.ke', 1499, 1499, 1150, 0, 12),
        ('Truehost Cloud Limited', '.ke', 3199, 3199, 2800, 0, 12),

        ('Kenya Website Experts', '.co.ke', 1299, 1299, 999, 100, 12),
        ('Kenya Website Experts', '.or.ke', 1199, 1199, 950, 100, 12),
        ('Kenya Website Experts', '.ne.ke', 1399, 1399, 1100, 100, 12),
        ('Kenya Website Experts', '.info.ke', 1699, 1699, 1350, 100, 12),

        ('Safaricom Kenya', '.co.ke', 1399, 1399, 1099, 0, 12),
        ('Safaricom Kenya', '.or.ke', 1299, 1299, 999, 0, 12),
        ('Safaricom Kenya', '.mobi.ke', 1599, 1599, 1200, 0, 12),
        ('Safaricom Kenya', '.ke', 3599, 3599, 3000, 0, 12),

        ('HostPinnacle Cloud Limited', '.co.ke', 999, 999, 850, 0, 12),
        ('HostPinnacle Cloud Limited', '.or.ke', 1099, 1099, 900, 0, 12),
        ('HostPinnacle Cloud Limited', '.ne.ke', 1249, 1249, 980, 0, 12),
        ('HostPinnacle Cloud Limited', '.me.ke', 1449, 1449, 1100, 0, 12),
        ('HostPinnacle Cloud Limited', '.info.ke', 1649, 1649, 1300, 0, 12),
        ('HostPinnacle Cloud Limited', '.mobi.ke', 1549, 1549, 1200, 0, 12),
        ('HostPinnacle Cloud Limited', '.ke', 2999, 2999, 2600, 0, 12)
)
INSERT INTO registrar_domain_offerings (
    registrar_id,
    domain_extension_id,
    registration_price_ksh,
    renewal_price_ksh,
    transfer_price_ksh,
    setup_fee_ksh,
    billing_period_months
)
SELECT
    registrars.id,
    domain_extensions.id,
    domain_offer_seed.registration_price_ksh,
    domain_offer_seed.renewal_price_ksh,
    domain_offer_seed.transfer_price_ksh,
    domain_offer_seed.setup_fee_ksh,
    domain_offer_seed.billing_period_months
FROM domain_offer_seed
INNER JOIN registrars
    ON LOWER(registrars.name) = LOWER(domain_offer_seed.registrar_name)
INNER JOIN domain_extensions
    ON LOWER(domain_extensions.extension) = LOWER(domain_offer_seed.extension)
WHERE NOT EXISTS (
    SELECT 1
    FROM registrar_domain_offerings
    WHERE registrar_domain_offerings.registrar_id = registrars.id
      AND registrar_domain_offerings.domain_extension_id = domain_extensions.id
);

WITH service_offer_seed(
    registrar_name,
    service_code,
    plan_code,
    plan_name,
    billing_cycle,
    billing_period_months,
    price_ksh,
    setup_fee_ksh,
    features_json
) AS (
    VALUES
        (
            'Truehost Cloud Limited',
            'shared_hosting',
            'starter_shared',
            'Starter Shared',
            'monthly',
            1,
            349,
            0,
            '{"storage":"10 GB","websites":"1","ssl":"Included"}'::jsonb
        ),
        (
            'Truehost Cloud Limited',
            'wordpress_hosting',
            'wp_launch',
            'WordPress Launch',
            'monthly',
            1,
            799,
            0,
            '{"storage":"15 GB","updates":"Managed","backups":"Daily"}'::jsonb
        ),
        (
            'Truehost Cloud Limited',
            'email_hosting',
            'biz_mail',
            'Business Mail',
            'monthly',
            1,
            250,
            0,
            '{"mailboxes":"5","storage_per_mailbox":"10 GB"}'::jsonb
        ),
        (
            'Truehost Cloud Limited',
            'ssl',
            'ssl_basic',
            'Basic SSL',
            'yearly',
            12,
            1800,
            0,
            '{"validation":"DV","issuance":"Fast"}'::jsonb
        ),

        (
            'Kenya Website Experts',
            'shared_hosting',
            'business_shared',
            'Business Shared',
            'monthly',
            1,
            420,
            0,
            '{"storage":"20 GB","websites":"3","bandwidth":"Unmetered"}'::jsonb
        ),
        (
            'Kenya Website Experts',
            'web_hosting',
            'web_pro',
            'Web Pro',
            'yearly',
            12,
            4200,
            0,
            '{"storage":"40 GB","support":"Priority","domains":"2"}'::jsonb
        ),
        (
            'Kenya Website Experts',
            'email_hosting',
            'team_mail',
            'Team Mail',
            'monthly',
            1,
            320,
            0,
            '{"mailboxes":"10","spam_filter":"Advanced"}'::jsonb
        ),
        (
            'Kenya Website Experts',
            'ssl',
            'ssl_site',
            'Site SSL',
            'yearly',
            12,
            2200,
            0,
            '{"validation":"DV","site_seal":"Included"}'::jsonb
        ),

        (
            'Safaricom Kenya',
            'shared_hosting',
            'business_host',
            'Business Host',
            'monthly',
            1,
            650,
            0,
            '{"storage":"25 GB","uptime":"99.9%","ssl":"Included"}'::jsonb
        ),
        (
            'Safaricom Kenya',
            'vps_hosting',
            'vps_launch',
            'VPS Launch',
            'monthly',
            1,
            4200,
            0,
            '{"cpu":"2 vCPU","ram":"4 GB","storage":"80 GB SSD"}'::jsonb
        ),
        (
            'Safaricom Kenya',
            'email_hosting',
            'enterprise_mail',
            'Enterprise Mail',
            'monthly',
            1,
            550,
            0,
            '{"mailboxes":"15","archiving":"Included"}'::jsonb
        ),
        (
            'Safaricom Kenya',
            'ssl',
            'ssl_managed',
            'Managed SSL',
            'yearly',
            12,
            2600,
            0,
            '{"validation":"DV","renewal_support":"Managed"}'::jsonb
        ),

        (
            'HostPinnacle Cloud Limited',
            'shared_hosting',
            'launch_shared',
            'Launch Shared',
            'monthly',
            1,
            299,
            0,
            '{"storage":"12 GB","websites":"1","backups":"Weekly"}'::jsonb
        ),
        (
            'HostPinnacle Cloud Limited',
            'wordpress_hosting',
            'wp_growth',
            'WordPress Growth',
            'monthly',
            1,
            699,
            0,
            '{"storage":"20 GB","backups":"Daily","cdn":"Included"}'::jsonb
        ),
        (
            'HostPinnacle Cloud Limited',
            'vps_hosting',
            'vps_scale',
            'VPS Scale',
            'monthly',
            1,
            3800,
            0,
            '{"cpu":"2 vCPU","ram":"4 GB","storage":"60 GB SSD"}'::jsonb
        ),
        (
            'HostPinnacle Cloud Limited',
            'email_hosting',
            'mail_plus',
            'Mail Plus',
            'monthly',
            1,
            280,
            0,
            '{"mailboxes":"6","storage_per_mailbox":"15 GB"}'::jsonb
        ),
        (
            'HostPinnacle Cloud Limited',
            'ssl',
            'ssl_guard',
            'SSL Guard',
            'yearly',
            12,
            1500,
            0,
            '{"validation":"DV","installation_help":"Included"}'::jsonb
        )
)
INSERT INTO registrar_service_offerings (
    registrar_id,
    service_product_id,
    plan_code,
    plan_name,
    billing_cycle,
    billing_period_months,
    price_ksh,
    setup_fee_ksh,
    features_json
)
SELECT
    registrars.id,
    service_products.id,
    service_offer_seed.plan_code,
    service_offer_seed.plan_name,
    service_offer_seed.billing_cycle,
    service_offer_seed.billing_period_months,
    service_offer_seed.price_ksh,
    service_offer_seed.setup_fee_ksh,
    service_offer_seed.features_json
FROM service_offer_seed
INNER JOIN registrars
    ON LOWER(registrars.name) = LOWER(service_offer_seed.registrar_name)
INNER JOIN service_products
    ON service_products.service_code = service_offer_seed.service_code
WHERE NOT EXISTS (
    SELECT 1
    FROM registrar_service_offerings
    WHERE registrar_service_offerings.registrar_id = registrars.id
      AND registrar_service_offerings.service_product_id = service_products.id
      AND registrar_service_offerings.plan_code = service_offer_seed.plan_code
);

WITH bundle_seed(registrar_name, bundle_code, bundle_name, description, price_ksh) AS (
    VALUES
        (
            'Truehost Cloud Limited',
            'domain-launch-pack',
            'Domain Launch Pack',
            'A simple starter bundle for domain registration and shared hosting.',
            2299
        ),
        (
            'Kenya Website Experts',
            'brand-starter-pack',
            'Brand Starter Pack',
            'A sample business web presence bundle with email hosting.',
            2799
        ),
        (
            'Safaricom Kenya',
            'business-online-pack',
            'Business Online Pack',
            'A sample commercial package for domain, hosting, and email readiness.',
            3399
        ),
        (
            'HostPinnacle Cloud Limited',
            'website-jumpstart-pack',
            'Website Jumpstart Pack',
            'A sample low-friction launch bundle for a new .KE business domain.',
            2199
        )
)
INSERT INTO bundle_templates (
    registrar_id,
    bundle_code,
    bundle_name,
    description,
    price_ksh
)
SELECT
    registrars.id,
    bundle_seed.bundle_code,
    bundle_seed.bundle_name,
    bundle_seed.description,
    bundle_seed.price_ksh
FROM bundle_seed
INNER JOIN registrars
    ON LOWER(registrars.name) = LOWER(bundle_seed.registrar_name)
WHERE NOT EXISTS (
    SELECT 1
    FROM bundle_templates
    WHERE bundle_templates.registrar_id = registrars.id
      AND bundle_templates.bundle_code = bundle_seed.bundle_code
);

INSERT INTO bundle_items (
    bundle_id,
    item_type,
    domain_extension_id,
    display_name,
    quantity,
    sort_order
)
SELECT
    bundle_templates.id,
    'domain_extension',
    domain_extensions.id,
    '1 year .co.ke registration',
    1,
    1
FROM bundle_templates
INNER JOIN registrars
    ON registrars.id = bundle_templates.registrar_id
INNER JOIN domain_extensions
    ON domain_extensions.extension = '.co.ke'
WHERE bundle_templates.bundle_code IN (
    'domain-launch-pack',
    'brand-starter-pack',
    'business-online-pack',
    'website-jumpstart-pack'
)
  AND NOT EXISTS (
      SELECT 1
      FROM bundle_items
      WHERE bundle_items.bundle_id = bundle_templates.id
        AND bundle_items.item_type = 'domain_extension'
        AND bundle_items.domain_extension_id = domain_extensions.id
  );

WITH bundle_service_seed(registrar_name, bundle_code, plan_code, sort_order) AS (
    VALUES
        ('Truehost Cloud Limited', 'domain-launch-pack', 'starter_shared', 2),
        ('Kenya Website Experts', 'brand-starter-pack', 'business_shared', 2),
        ('Kenya Website Experts', 'brand-starter-pack', 'team_mail', 3),
        ('Safaricom Kenya', 'business-online-pack', 'business_host', 2),
        ('Safaricom Kenya', 'business-online-pack', 'enterprise_mail', 3),
        ('HostPinnacle Cloud Limited', 'website-jumpstart-pack', 'launch_shared', 2),
        ('HostPinnacle Cloud Limited', 'website-jumpstart-pack', 'mail_plus', 3)
)
INSERT INTO bundle_items (
    bundle_id,
    item_type,
    service_offering_id,
    display_name,
    quantity,
    sort_order
)
SELECT
    bundle_templates.id,
    'service_offering',
    registrar_service_offerings.id,
    registrar_service_offerings.plan_name,
    1,
    bundle_service_seed.sort_order
FROM bundle_service_seed
INNER JOIN registrars
    ON LOWER(registrars.name) = LOWER(bundle_service_seed.registrar_name)
INNER JOIN bundle_templates
    ON bundle_templates.registrar_id = registrars.id
   AND bundle_templates.bundle_code = bundle_service_seed.bundle_code
INNER JOIN registrar_service_offerings
    ON registrar_service_offerings.registrar_id = registrars.id
   AND registrar_service_offerings.plan_code = bundle_service_seed.plan_code
WHERE NOT EXISTS (
    SELECT 1
    FROM bundle_items
    WHERE bundle_items.bundle_id = bundle_templates.id
      AND bundle_items.item_type = 'service_offering'
      AND bundle_items.service_offering_id = registrar_service_offerings.id
);
