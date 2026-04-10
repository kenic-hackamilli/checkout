-- Refresh the sample registrar catalog against the current package-based model.
-- This keeps the existing seven .KE extensions already supported by the app:
-- .co.ke, .or.ke, .ne.ke, .me.ke, .mobi.ke, .info.ke, .ke
-- The migration runner already wraps each migration in a transaction, so this file
-- intentionally performs a delete-then-reseed refresh without its own BEGIN/COMMIT.

WITH registrar_seed(name, api_endpoint, notification_email, is_active) AS (
    VALUES
        ('Safaricom Kenya', NULL, NULL, true),
        ('HostAfrica EAC', NULL, NULL, true),
        ('HostPinnacle Cloud Limited', NULL, NULL, true),
        ('Kenya Website Experts', NULL, NULL, true),
        ('Truehost Cloud Limited', NULL, NULL, true)
)
UPDATE registrars AS registrars
SET
    is_active = registrar_seed.is_active,
    api_endpoint = COALESCE(registrars.api_endpoint, registrar_seed.api_endpoint),
    notification_email = COALESCE(
        registrars.notification_email,
        registrar_seed.notification_email
    )
FROM registrar_seed
WHERE LOWER(registrars.name) = LOWER(registrar_seed.name);

WITH registrar_seed(name, api_endpoint, notification_email, is_active) AS (
    VALUES
        ('Safaricom Kenya', NULL, NULL, true),
        ('HostAfrica EAC', NULL, NULL, true),
        ('HostPinnacle Cloud Limited', NULL, NULL, true),
        ('Kenya Website Experts', NULL, NULL, true),
        ('Truehost Cloud Limited', NULL, NULL, true)
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

WITH sample_registrars AS (
    SELECT id
    FROM registrars
    WHERE LOWER(name) IN (
        LOWER('Safaricom Kenya'),
        LOWER('HostAfrica EAC'),
        LOWER('HostPinnacle Cloud Limited'),
        LOWER('Kenya Website Experts'),
        LOWER('Truehost Cloud Limited')
    )
)
DELETE FROM bundle_templates
WHERE registrar_id IN (SELECT id FROM sample_registrars);

WITH sample_registrars AS (
    SELECT id
    FROM registrars
    WHERE LOWER(name) IN (
        LOWER('Safaricom Kenya'),
        LOWER('HostAfrica EAC'),
        LOWER('HostPinnacle Cloud Limited'),
        LOWER('Kenya Website Experts'),
        LOWER('Truehost Cloud Limited')
    )
)
DELETE FROM registrar_service_package_prices AS registrar_service_package_prices
USING registrar_service_packages AS registrar_service_packages
WHERE registrar_service_package_prices.service_package_id = registrar_service_packages.id
  AND registrar_service_packages.registrar_id IN (SELECT id FROM sample_registrars);

WITH sample_registrars AS (
    SELECT id
    FROM registrars
    WHERE LOWER(name) IN (
        LOWER('Safaricom Kenya'),
        LOWER('HostAfrica EAC'),
        LOWER('HostPinnacle Cloud Limited'),
        LOWER('Kenya Website Experts'),
        LOWER('Truehost Cloud Limited')
    )
)
DELETE FROM registrar_service_packages
WHERE registrar_id IN (SELECT id FROM sample_registrars);

WITH sample_registrars AS (
    SELECT id
    FROM registrars
    WHERE LOWER(name) IN (
        LOWER('Safaricom Kenya'),
        LOWER('HostAfrica EAC'),
        LOWER('HostPinnacle Cloud Limited'),
        LOWER('Kenya Website Experts'),
        LOWER('Truehost Cloud Limited')
    )
)
DELETE FROM registrar_service_offerings
WHERE registrar_id IN (SELECT id FROM sample_registrars);

WITH sample_registrars AS (
    SELECT id
    FROM registrars
    WHERE LOWER(name) IN (
        LOWER('Safaricom Kenya'),
        LOWER('HostAfrica EAC'),
        LOWER('HostPinnacle Cloud Limited'),
        LOWER('Kenya Website Experts'),
        LOWER('Truehost Cloud Limited')
    )
)
DELETE FROM registrar_domain_offerings
WHERE registrar_id IN (SELECT id FROM sample_registrars);

WITH hostafrica_domain_seed(
    registrar_name,
    extension,
    registration_price_ksh,
    renewal_price_ksh,
    transfer_price_ksh,
    setup_fee_ksh,
    billing_period_months
) AS (
    VALUES
        ('HostAfrica EAC', '.ke', 3000, 3000, 2550, 0, 12),
        ('HostAfrica EAC', '.co.ke', 1450, 2350, 1200, 0, 12),
        ('HostAfrica EAC', '.or.ke', 1450, 2350, 1200, 0, 12),
        ('HostAfrica EAC', '.ne.ke', 1450, 2350, 1200, 0, 12),
        ('HostAfrica EAC', '.me.ke', 1450, 2350, 1200, 0, 12),
        ('HostAfrica EAC', '.mobi.ke', 1450, 2350, 1200, 0, 12),
        ('HostAfrica EAC', '.info.ke', 1450, 2350, 1200, 0, 12)
),
domain_base(
    extension,
    registration_base_ksh,
    renewal_base_ksh,
    transfer_base_ksh
) AS (
    VALUES
        ('.ke', 3000, 3000, 2550),
        ('.co.ke', 1450, 2350, 1200),
        ('.or.ke', 1450, 2350, 1200),
        ('.ne.ke', 1450, 2350, 1200),
        ('.me.ke', 1450, 2350, 1200),
        ('.mobi.ke', 1450, 2350, 1200),
        ('.info.ke', 1450, 2350, 1200)
),
registrar_domain_profile(
    registrar_name,
    registration_multiplier,
    renewal_multiplier,
    transfer_multiplier,
    setup_fee_ksh
) AS (
    VALUES
        ('Safaricom Kenya', 1.08, 1.04, 0.90, 0),
        ('HostPinnacle Cloud Limited', 1.03, 1.01, 0.88, 0),
        ('Kenya Website Experts', 1.12, 1.08, 0.91, 0),
        ('Truehost Cloud Limited', 0.95, 0.98, 0.85, 0)
),
synthetic_domain_seed AS (
    SELECT
        registrar_domain_profile.registrar_name,
        domain_base.extension,
        CAST(
            ROUND(
                (domain_base.registration_base_ksh * registrar_domain_profile.registration_multiplier)::numeric
                / 50.0
            ) * 50 AS integer
        ) AS registration_price_ksh,
        CAST(
            ROUND(
                (domain_base.renewal_base_ksh * registrar_domain_profile.renewal_multiplier)::numeric
                / 50.0
            ) * 50 AS integer
        ) AS renewal_price_ksh,
        CAST(
            ROUND(
                (domain_base.transfer_base_ksh * registrar_domain_profile.transfer_multiplier)::numeric
                / 50.0
            ) * 50 AS integer
        ) AS transfer_price_ksh,
        registrar_domain_profile.setup_fee_ksh,
        12 AS billing_period_months
    FROM registrar_domain_profile
    CROSS JOIN domain_base
),
all_domain_seed AS (
    SELECT * FROM hostafrica_domain_seed
    UNION ALL
    SELECT * FROM synthetic_domain_seed
)
INSERT INTO registrar_domain_offerings (
    registrar_id,
    domain_extension_id,
    registration_price_ksh,
    renewal_price_ksh,
    transfer_price_ksh,
    setup_fee_ksh,
    billing_period_months,
    currency_code,
    is_active
)
SELECT
    registrars.id,
    domain_extensions.id,
    all_domain_seed.registration_price_ksh,
    all_domain_seed.renewal_price_ksh,
    all_domain_seed.transfer_price_ksh,
    all_domain_seed.setup_fee_ksh,
    all_domain_seed.billing_period_months,
    'KES',
    true
FROM all_domain_seed
INNER JOIN registrars
    ON LOWER(registrars.name) = LOWER(all_domain_seed.registrar_name)
INNER JOIN domain_extensions
    ON LOWER(domain_extensions.extension) = LOWER(all_domain_seed.extension);

WITH package_seed(
    registrar_name,
    service_code,
    package_code,
    package_name,
    short_description,
    details_json,
    feature_bullets_json,
    display_order
) AS (
    VALUES
        (
            'Safaricom Kenya',
            'web_hosting',
            'starter',
            'Starter',
            'Affordable web hosting for small businesses starting with email and a simple website.',
            '{"storage":"500 MB SSD","email_accounts":"10","bandwidth":"Unlimited","website_builder":"Included","ftp_accounts":"Included","subdomains":"Included","email_security":"Included"}'::jsonb,
            '["500 MB SSD storage","10 business email accounts","Unlimited bandwidth","Website builder included","Email security included"]'::jsonb,
            1
        ),
        (
            'Safaricom Kenya',
            'web_hosting',
            'silver',
            'Silver',
            'Balanced business hosting with enough room for a growing company website and team email.',
            '{"storage":"2 GB SSD","email_accounts":"50","bandwidth":"Unlimited","website_builder":"Included","ftp_accounts":"Included","subdomains":"Included","email_security":"Included"}'::jsonb,
            '["2 GB SSD storage","50 business email accounts","Unlimited bandwidth","Free website builder","Email security included"]'::jsonb,
            2
        ),
        (
            'Safaricom Kenya',
            'web_hosting',
            'gold',
            'Gold',
            'Commercial-grade hosting for active SMEs that need more web space and more team mailboxes.',
            '{"storage":"10 GB SSD","email_accounts":"100","bandwidth":"Unlimited","website_builder":"Included","ftp_accounts":"Included","subdomains":"Included","email_security":"Included"}'::jsonb,
            '["10 GB SSD storage","100 email accounts","Unlimited bandwidth","Website builder included","Business-ready hosting bundle"]'::jsonb,
            3
        ),
        (
            'Safaricom Kenya',
            'web_hosting',
            'premium',
            'Premium',
            'Expanded hosting capacity for busy websites and larger teams running brand, content, and email together.',
            '{"storage":"20 GB SSD","email_accounts":"200","bandwidth":"Unlimited","website_builder":"Included","ftp_accounts":"Included","subdomains":"Included","email_security":"Included"}'::jsonb,
            '["20 GB SSD storage","200 email accounts","Unlimited bandwidth","Free website builder","Subdomains and FTP included"]'::jsonb,
            4
        ),
        (
            'Safaricom Kenya',
            'web_hosting',
            'enterprise',
            'Enterprise',
            'Reliable hosting for established businesses that need scale, more mailboxes, and more headroom.',
            '{"storage":"50 GB SSD","email_accounts":"500","bandwidth":"Unlimited","website_builder":"Included","ftp_accounts":"Included","subdomains":"Included","email_security":"Included"}'::jsonb,
            '["50 GB SSD storage","500 email accounts","Unlimited bandwidth","Strong fit for established SMEs","Website builder and email security included"]'::jsonb,
            5
        ),
        (
            'Safaricom Kenya',
            'web_hosting',
            'enterprise_plus',
            'Enterprise Plus',
            'Large-capacity commercial hosting for brands that want domain, email, and web hosting under one supplier.',
            '{"storage":"100 GB SSD","email_accounts":"1000","bandwidth":"Unlimited","website_builder":"Included","ftp_accounts":"Included","subdomains":"Included","email_security":"Included"}'::jsonb,
            '["100 GB SSD storage","1,000 email accounts","Unlimited bandwidth","Built for larger teams","Website builder and security included"]'::jsonb,
            6
        ),

        (
            'HostAfrica EAC',
            'shared_hosting',
            'launch',
            'Launch',
            'Entry shared hosting for brochure websites and small business launches.',
            '{"storage":"15 GB NVMe","websites":"1","mailboxes":"10","ssl":"Included","stack":"LiteSpeed"}'::jsonb,
            '["15 GB NVMe storage","1 website","10 mailboxes","LiteSpeed stack","SSL included"]'::jsonb,
            1
        ),
        (
            'HostAfrica EAC',
            'shared_hosting',
            'business',
            'Business',
            'A practical hosting plan for growing websites that need more speed, backups, and business mail.',
            '{"storage":"40 GB NVMe","websites":"2","mailboxes":"25","backups":"Daily","ssl":"Included"}'::jsonb,
            '["40 GB NVMe storage","25 business mailboxes","Daily backups","Free SSL","2 hosted websites"]'::jsonb,
            2
        ),
        (
            'HostAfrica EAC',
            'web_hosting',
            'litespeed_pro',
            'LiteSpeed Pro',
            'Performance hosting tuned for business traffic, caching, and faster page delivery.',
            '{"storage":"75 GB NVMe","websites":"5","mailboxes":"50","cache":"LiteSpeed Cache","support":"Priority"}'::jsonb,
            '["75 GB NVMe storage","LiteSpeed performance stack","50 mailboxes","Priority support","5 hosted websites"]'::jsonb,
            3
        ),
        (
            'HostAfrica EAC',
            'web_hosting',
            'commerce_scale',
            'Commerce Scale',
            'High-capacity hosting for stores and websites expecting heavier traffic and multiple properties.',
            '{"storage":"150 GB NVMe","websites":"Unlimited","mailboxes":"100","backups":"Daily","support":"Priority"}'::jsonb,
            '["150 GB NVMe storage","Unlimited websites","100 mailboxes","Daily backups","Built for e-commerce workloads"]'::jsonb,
            4
        ),

        (
            'HostAfrica EAC',
            'wordpress_hosting',
            'wp_launch',
            'WP Launch',
            'Managed WordPress hosting for a first business site with strong defaults and low setup overhead.',
            '{"storage":"10 GB NVMe","websites":"1","updates":"Managed","backups":"Daily","ssl":"Included"}'::jsonb,
            '["10 GB NVMe storage","Managed WordPress updates","Daily backups","SSL included","1 WordPress site"]'::jsonb,
            5
        ),
        (
            'HostAfrica EAC',
            'wordpress_hosting',
            'wp_growth',
            'WP Growth',
            'Managed WordPress for growing brands that need staging, better performance, and more site capacity.',
            '{"storage":"30 GB NVMe","websites":"3","updates":"Managed","staging":"Included","malware_scan":"Included"}'::jsonb,
            '["30 GB NVMe storage","3 WordPress sites","Staging included","Managed updates","Malware scanning"]'::jsonb,
            6
        ),
        (
            'HostAfrica EAC',
            'wordpress_hosting',
            'wp_commerce',
            'WP Commerce',
            'Commercial WordPress hosting optimized for WooCommerce and content-heavy business websites.',
            '{"storage":"80 GB NVMe","websites":"5","updates":"Managed","object_cache":"Included","backups":"Daily"}'::jsonb,
            '["80 GB NVMe storage","5 WordPress sites","WooCommerce-ready stack","Daily backups","Managed performance tuning"]'::jsonb,
            7
        ),

        (
            'HostAfrica EAC',
            'vps_hosting',
            'linux_vps_2',
            'Linux VPS 2',
            'An entry Linux VPS for startups moving beyond shared hosting into private compute.',
            '{"cpu":"2 vCPU","ram":"4 GB","storage":"80 GB NVMe","management":"Self-managed","os":"Linux"}'::jsonb,
            '["2 vCPU","4 GB RAM","80 GB NVMe storage","Linux environment","Self-managed VPS"]'::jsonb,
            8
        ),
        (
            'HostAfrica EAC',
            'vps_hosting',
            'linux_vps_4',
            'Linux VPS 4',
            'A stronger Linux VPS for production workloads that need more RAM and storage headroom.',
            '{"cpu":"4 vCPU","ram":"8 GB","storage":"160 GB NVMe","management":"Self-managed","os":"Linux"}'::jsonb,
            '["4 vCPU","8 GB RAM","160 GB NVMe storage","Linux VPS stack","Better fit for production apps"]'::jsonb,
            9
        ),
        (
            'HostAfrica EAC',
            'vps_hosting',
            'managed_vps_4',
            'Managed VPS 4',
            'Managed private infrastructure for businesses that want performance without owning the whole stack.',
            '{"cpu":"4 vCPU","ram":"8 GB","storage":"160 GB NVMe","management":"Managed","os":"Linux"}'::jsonb,
            '["4 vCPU","8 GB RAM","160 GB NVMe storage","Managed support","Ideal for growing production workloads"]'::jsonb,
            10
        ),
        (
            'HostAfrica EAC',
            'vps_hosting',
            'windows_cloud_8',
            'Windows Cloud 8',
            'Windows-based cloud infrastructure for teams that rely on Microsoft-first workloads.',
            '{"cpu":"4 vCPU","ram":"8 GB","storage":"160 GB SSD","management":"Self-managed","os":"Windows"}'::jsonb,
            '["4 vCPU","8 GB RAM","160 GB SSD storage","Windows Server environment","Commercial cloud compute"]'::jsonb,
            11
        ),
        (
            'HostAfrica EAC',
            'vps_hosting',
            'dedicated_16',
            'Dedicated 16 Core',
            'Dedicated-class compute for large projects that need isolated performance and room to scale.',
            '{"cpu":"16 vCPU","ram":"32 GB","storage":"1 TB NVMe","management":"Self-managed","os":"Linux or Windows"}'::jsonb,
            '["16 vCPU","32 GB RAM","1 TB NVMe storage","Dedicated-class resources","Built for demanding workloads"]'::jsonb,
            12
        ),

        (
            'HostPinnacle Cloud Limited',
            'web_hosting',
            'starter',
            'Starter',
            'Performance hosting for smaller sites that still want SSL, cPanel, and room to grow.',
            '{"storage":"35 GB NVMe","domain_bonus":"Free .co.ke/.com/.org","ssl":"Free","emails":"Unlimited","bandwidth":"Unlimited","control_panel":"cPanel"}'::jsonb,
            '["35 GB NVMe storage","Free domain on eligible annual plans","Free SSL","Unlimited emails","cPanel included"]'::jsonb,
            1
        ),
        (
            'HostPinnacle Cloud Limited',
            'web_hosting',
            'standard',
            'Standard',
            'Mid-tier hosting with more NVMe storage and strong value for business websites.',
            '{"storage":"100 GB NVMe","domain_bonus":"Free .co.ke/.com/.org","ssl":"Free","emails":"Unlimited","bandwidth":"Unlimited","control_panel":"cPanel"}'::jsonb,
            '["100 GB NVMe storage","Free SSL","Unlimited emails","Unlimited bandwidth","Free domain on eligible annual plans"]'::jsonb,
            2
        ),
        (
            'HostPinnacle Cloud Limited',
            'web_hosting',
            'executive',
            'Executive',
            'High-capacity NVMe hosting for e-commerce and growing multi-page business websites.',
            '{"storage":"Unlimited NVMe","domain_bonus":"Free .co.ke/.com/.org","ssl":"Free","emails":"Unlimited","bandwidth":"Unlimited","runtime":"Node.js + Python"}'::jsonb,
            '["Unlimited NVMe storage","Free SSL","Unlimited emails","Node.js and Python support","Strong fit for e-commerce"]'::jsonb,
            3
        ),
        (
            'HostPinnacle Cloud Limited',
            'web_hosting',
            'hosting_only',
            'Hosting Only',
            'Low-cost hosting for businesses that already have a domain and only need the web stack.',
            '{"storage":"35 GB NVMe","ssl":"Free","emails":"Unlimited","bandwidth":"Unlimited","control_panel":"cPanel"}'::jsonb,
            '["35 GB NVMe storage","Free SSL","Unlimited emails","Unlimited bandwidth","cPanel included"]'::jsonb,
            4
        ),

        (
            'Kenya Website Experts',
            'email_hosting',
            'pro',
            'Pro',
            'Professional business mail for teams that want a dependable branded inbox at entry cost.',
            '{"mailbox_storage":"10 GB","calendar":"Included","contacts":"Included","templates":"Included","read_receipts":"Included","forwarding":"External forwarding"}'::jsonb,
            '["10 GB mailbox space","AI writing tools","Calendar and contacts","Email templates","Read receipts"]'::jsonb,
            1
        ),
        (
            'Kenya Website Experts',
            'email_hosting',
            'premium',
            'Premium',
            'Larger mailbox capacity and stronger collaboration tooling for active business communication.',
            '{"mailbox_storage":"40 GB","calendar":"Included","contacts":"Included","templates":"Included","read_receipts":"Included","forwarding":"External forwarding"}'::jsonb,
            '["40 GB mailbox space","AI writing tools","Calendar and contacts","External forwarding","1st year free domain"]'::jsonb,
            2
        ),
        (
            'Kenya Website Experts',
            'email_hosting',
            'ultra',
            'Ultra',
            'Premium mailbox capacity for leadership teams and communication-heavy businesses.',
            '{"mailbox_storage":"100 GB","calendar":"Included","contacts":"Included","templates":"Included","read_receipts":"Included","forwarding":"External forwarding"}'::jsonb,
            '["100 GB mailbox space","AI writing tools","Calendar and contacts","Email templates","1st year free domain"]'::jsonb,
            3
        ),

        (
            'Truehost Cloud Limited',
            'shared_hosting',
            'bronze',
            'Bronze',
            'Entry shared hosting for small sites that want low friction and a clean annual price point.',
            '{"storage":"10 GB SSD","websites":"1","emails":"5","ssl":"Free","backups":"Weekly"}'::jsonb,
            '["10 GB SSD storage","1 website","5 email accounts","Free SSL","Weekly backups"]'::jsonb,
            1
        ),
        (
            'Truehost Cloud Limited',
            'shared_hosting',
            'silver',
            'Silver',
            'Balanced hosting for growing businesses that need more storage and team email.',
            '{"storage":"25 GB SSD","websites":"3","emails":"20","ssl":"Free","backups":"Daily"}'::jsonb,
            '["25 GB SSD storage","3 hosted websites","20 email accounts","Free SSL","Daily backups"]'::jsonb,
            2
        ),
        (
            'Truehost Cloud Limited',
            'shared_hosting',
            'gold',
            'Gold',
            'Commercial hosting with stronger storage, unlimited email, and better room for scale.',
            '{"storage":"60 GB NVMe","websites":"Unlimited","emails":"Unlimited","ssl":"Free","staging":"Included"}'::jsonb,
            '["60 GB NVMe storage","Unlimited websites","Unlimited emails","Free SSL","Staging included"]'::jsonb,
            3
        ),
        (
            'Truehost Cloud Limited',
            'shared_hosting',
            'platinum',
            'Platinum',
            'Higher-capacity hosting for busy sites that want stronger support and better long-term headroom.',
            '{"storage":"120 GB NVMe","websites":"Unlimited","emails":"Unlimited","ssl":"Free","support":"Priority"}'::jsonb,
            '["120 GB NVMe storage","Unlimited websites","Unlimited emails","Priority support","Free SSL"]'::jsonb,
            4
        ),

        (
            'Truehost Cloud Limited',
            'wordpress_hosting',
            'wp_start',
            'WP Start',
            'Managed WordPress hosting for a first production site with dependable daily maintenance.',
            '{"storage":"15 GB NVMe","websites":"1","updates":"Managed","backups":"Daily","ssl":"Free"}'::jsonb,
            '["15 GB NVMe storage","1 WordPress site","Managed updates","Daily backups","Free SSL"]'::jsonb,
            5
        ),
        (
            'Truehost Cloud Limited',
            'wordpress_hosting',
            'wp_scale',
            'WP Scale',
            'Managed WordPress for growth-stage brands that need more capacity and proactive protection.',
            '{"storage":"40 GB NVMe","websites":"3","updates":"Managed","backups":"Daily","malware_cleanup":"Included"}'::jsonb,
            '["40 GB NVMe storage","3 WordPress sites","Managed updates","Daily backups","Malware cleanup included"]'::jsonb,
            6
        ),

        (
            'Truehost Cloud Limited',
            'email_hosting',
            'mail_start',
            'Mail Start',
            'Essential business mail for founders and small teams that need branded communication.',
            '{"mailboxes":"5","mailbox_storage":"10 GB","spam_filter":"Included","calendar":"Included"}'::jsonb,
            '["5 mailboxes","10 GB per mailbox","Spam filtering","Calendar included","Branded business email"]'::jsonb,
            7
        ),
        (
            'Truehost Cloud Limited',
            'email_hosting',
            'mail_team',
            'Mail Team',
            'A practical team email plan with larger mailbox capacity and more seats.',
            '{"mailboxes":"15","mailbox_storage":"25 GB","spam_filter":"Advanced","calendar":"Included"}'::jsonb,
            '["15 mailboxes","25 GB per mailbox","Advanced spam filtering","Calendar included","Good fit for active teams"]'::jsonb,
            8
        ),
        (
            'Truehost Cloud Limited',
            'email_hosting',
            'mail_business',
            'Mail Business',
            'Business email at a larger scale for growing organisations running more formal communication.',
            '{"mailboxes":"50","mailbox_storage":"50 GB","spam_filter":"Advanced","archiving":"Included"}'::jsonb,
            '["50 mailboxes","50 GB per mailbox","Advanced spam filtering","Archiving included","Business-grade mail stack"]'::jsonb,
            9
        ),

        (
            'Truehost Cloud Limited',
            'vps_hosting',
            'cloud_2',
            'Cloud 2',
            'A starter VPS for developers and lean production workloads moving beyond shared hosting.',
            '{"cpu":"2 vCPU","ram":"4 GB","storage":"80 GB SSD","management":"Self-managed"}'::jsonb,
            '["2 vCPU","4 GB RAM","80 GB SSD storage","Self-managed VPS","Good step up from shared hosting"]'::jsonb,
            10
        ),
        (
            'Truehost Cloud Limited',
            'vps_hosting',
            'cloud_4',
            'Cloud 4',
            'A stronger VPS tier for web apps, APIs, and mid-sized production workloads.',
            '{"cpu":"4 vCPU","ram":"8 GB","storage":"160 GB SSD","management":"Self-managed"}'::jsonb,
            '["4 vCPU","8 GB RAM","160 GB SSD storage","Self-managed VPS","Well suited to business apps"]'::jsonb,
            11
        ),
        (
            'Truehost Cloud Limited',
            'vps_hosting',
            'cloud_8',
            'Cloud 8',
            'Private compute for more demanding websites and application stacks that need room to grow.',
            '{"cpu":"8 vCPU","ram":"16 GB","storage":"320 GB SSD","management":"Self-managed"}'::jsonb,
            '["8 vCPU","16 GB RAM","320 GB SSD storage","Private compute capacity","Built for heavier production use"]'::jsonb,
            12
        ),

        (
            'Truehost Cloud Limited',
            'ssl',
            'basic_ssl',
            'Basic SSL',
            'Simple DV certificate coverage for a single business website.',
            '{"validation":"DV","domains":"1","issuance":"Fast"}'::jsonb,
            '["Domain validation","1 covered domain","Fast issuance","Commercial site protection"]'::jsonb,
            13
        ),
        (
            'Truehost Cloud Limited',
            'ssl',
            'business_ssl',
            'Business SSL',
            'Business-focused certificate coverage with stronger trust for a public-facing site.',
            '{"validation":"OV","domains":"1","issuance":"Standard"}'::jsonb,
            '["Organisation validation","1 covered domain","Trust-focused certificate","Good fit for business sites"]'::jsonb,
            14
        ),
        (
            'Truehost Cloud Limited',
            'ssl',
            'wildcard_ssl',
            'Wildcard SSL',
            'Wildcard protection for businesses running subdomains under one brand.',
            '{"validation":"DV","domains":"Unlimited subdomains","issuance":"Fast"}'::jsonb,
            '["Wildcard certificate","Unlimited subdomains","Fast issuance","Best for multi-subdomain estates"]'::jsonb,
            15
        )
)
INSERT INTO registrar_service_packages (
    registrar_id,
    service_product_id,
    package_code,
    package_name,
    short_description,
    details_json,
    feature_bullets_json,
    display_order,
    is_active
)
SELECT
    registrars.id,
    service_products.id,
    package_seed.package_code,
    package_seed.package_name,
    package_seed.short_description,
    package_seed.details_json,
    package_seed.feature_bullets_json,
    package_seed.display_order,
    true
FROM package_seed
INNER JOIN registrars
    ON LOWER(registrars.name) = LOWER(package_seed.registrar_name)
INNER JOIN service_products
    ON service_products.service_code = package_seed.service_code;

WITH package_price_seed(
    registrar_name,
    service_code,
    package_code,
    billing_cycle,
    billing_period_months,
    billing_label,
    price_ksh,
    setup_fee_ksh,
    is_default
) AS (
    VALUES
        ('Safaricom Kenya', 'web_hosting', 'starter', 'yearly', 12, 'Yearly', 1500, 0, true),
        ('Safaricom Kenya', 'web_hosting', 'silver', 'yearly', 12, 'Yearly', 2500, 0, true),
        ('Safaricom Kenya', 'web_hosting', 'gold', 'yearly', 12, 'Yearly', 4000, 0, true),
        ('Safaricom Kenya', 'web_hosting', 'premium', 'yearly', 12, 'Yearly', 5000, 0, true),
        ('Safaricom Kenya', 'web_hosting', 'enterprise', 'yearly', 12, 'Yearly', 7100, 0, true),
        ('Safaricom Kenya', 'web_hosting', 'enterprise_plus', 'yearly', 12, 'Yearly', 9000, 0, true),

        ('HostAfrica EAC', 'shared_hosting', 'launch', 'monthly', 1, 'Monthly', 450, 0, true),
        ('HostAfrica EAC', 'shared_hosting', 'launch', 'yearly', 12, 'Yearly', 4500, 0, false),
        ('HostAfrica EAC', 'shared_hosting', 'business', 'monthly', 1, 'Monthly', 850, 0, true),
        ('HostAfrica EAC', 'shared_hosting', 'business', 'yearly', 12, 'Yearly', 8500, 0, false),
        ('HostAfrica EAC', 'web_hosting', 'litespeed_pro', 'monthly', 1, 'Monthly', 1450, 0, true),
        ('HostAfrica EAC', 'web_hosting', 'litespeed_pro', 'yearly', 12, 'Yearly', 14500, 0, false),
        ('HostAfrica EAC', 'web_hosting', 'commerce_scale', 'monthly', 1, 'Monthly', 2450, 0, true),
        ('HostAfrica EAC', 'web_hosting', 'commerce_scale', 'yearly', 12, 'Yearly', 24500, 0, false),

        ('HostAfrica EAC', 'wordpress_hosting', 'wp_launch', 'monthly', 1, 'Monthly', 650, 0, true),
        ('HostAfrica EAC', 'wordpress_hosting', 'wp_launch', 'yearly', 12, 'Yearly', 6500, 0, false),
        ('HostAfrica EAC', 'wordpress_hosting', 'wp_growth', 'monthly', 1, 'Monthly', 1200, 0, true),
        ('HostAfrica EAC', 'wordpress_hosting', 'wp_growth', 'yearly', 12, 'Yearly', 12000, 0, false),
        ('HostAfrica EAC', 'wordpress_hosting', 'wp_commerce', 'monthly', 1, 'Monthly', 2400, 0, true),
        ('HostAfrica EAC', 'wordpress_hosting', 'wp_commerce', 'yearly', 12, 'Yearly', 24000, 0, false),

        ('HostAfrica EAC', 'vps_hosting', 'linux_vps_2', 'monthly', 1, 'Monthly', 6500, 0, true),
        ('HostAfrica EAC', 'vps_hosting', 'linux_vps_2', 'yearly', 12, 'Yearly', 65000, 0, false),
        ('HostAfrica EAC', 'vps_hosting', 'linux_vps_4', 'monthly', 1, 'Monthly', 11500, 0, true),
        ('HostAfrica EAC', 'vps_hosting', 'linux_vps_4', 'yearly', 12, 'Yearly', 115000, 0, false),
        ('HostAfrica EAC', 'vps_hosting', 'managed_vps_4', 'monthly', 1, 'Monthly', 15500, 0, true),
        ('HostAfrica EAC', 'vps_hosting', 'managed_vps_4', 'yearly', 12, 'Yearly', 155000, 0, false),
        ('HostAfrica EAC', 'vps_hosting', 'windows_cloud_8', 'monthly', 1, 'Monthly', 13500, 0, true),
        ('HostAfrica EAC', 'vps_hosting', 'windows_cloud_8', 'yearly', 12, 'Yearly', 135000, 0, false),
        ('HostAfrica EAC', 'vps_hosting', 'dedicated_16', 'monthly', 1, 'Monthly', 62000, 0, true),
        ('HostAfrica EAC', 'vps_hosting', 'dedicated_16', 'yearly', 12, 'Yearly', 620000, 0, false),

        ('HostPinnacle Cloud Limited', 'web_hosting', 'starter', 'yearly', 12, 'Yearly', 4200, 0, true),
        ('HostPinnacle Cloud Limited', 'web_hosting', 'standard', 'yearly', 12, 'Yearly', 5200, 0, true),
        ('HostPinnacle Cloud Limited', 'web_hosting', 'executive', 'yearly', 12, 'Yearly', 12500, 0, true),
        ('HostPinnacle Cloud Limited', 'web_hosting', 'hosting_only', 'yearly', 12, 'Yearly', 2875, 0, true),

        ('Kenya Website Experts', 'email_hosting', 'pro', 'monthly', 1, 'Monthly', 390, 0, true),
        ('Kenya Website Experts', 'email_hosting', 'pro', 'yearly', 12, 'Yearly', 3900, 0, false),
        ('Kenya Website Experts', 'email_hosting', 'premium', 'monthly', 1, 'Monthly', 515, 0, true),
        ('Kenya Website Experts', 'email_hosting', 'premium', 'yearly', 12, 'Yearly', 5150, 0, false),
        ('Kenya Website Experts', 'email_hosting', 'ultra', 'monthly', 1, 'Monthly', 780, 0, true),
        ('Kenya Website Experts', 'email_hosting', 'ultra', 'yearly', 12, 'Yearly', 7800, 0, false),

        ('Truehost Cloud Limited', 'shared_hosting', 'bronze', 'monthly', 1, 'Monthly', 300, 0, true),
        ('Truehost Cloud Limited', 'shared_hosting', 'bronze', 'yearly', 12, 'Yearly', 3000, 0, false),
        ('Truehost Cloud Limited', 'shared_hosting', 'silver', 'monthly', 1, 'Monthly', 550, 0, true),
        ('Truehost Cloud Limited', 'shared_hosting', 'silver', 'yearly', 12, 'Yearly', 5500, 0, false),
        ('Truehost Cloud Limited', 'shared_hosting', 'gold', 'monthly', 1, 'Monthly', 950, 0, true),
        ('Truehost Cloud Limited', 'shared_hosting', 'gold', 'yearly', 12, 'Yearly', 9500, 0, false),
        ('Truehost Cloud Limited', 'shared_hosting', 'platinum', 'monthly', 1, 'Monthly', 1600, 0, true),
        ('Truehost Cloud Limited', 'shared_hosting', 'platinum', 'yearly', 12, 'Yearly', 16000, 0, false),

        ('Truehost Cloud Limited', 'wordpress_hosting', 'wp_start', 'monthly', 1, 'Monthly', 650, 0, true),
        ('Truehost Cloud Limited', 'wordpress_hosting', 'wp_start', 'yearly', 12, 'Yearly', 6500, 0, false),
        ('Truehost Cloud Limited', 'wordpress_hosting', 'wp_scale', 'monthly', 1, 'Monthly', 1250, 0, true),
        ('Truehost Cloud Limited', 'wordpress_hosting', 'wp_scale', 'yearly', 12, 'Yearly', 12500, 0, false),

        ('Truehost Cloud Limited', 'email_hosting', 'mail_start', 'monthly', 1, 'Monthly', 250, 0, true),
        ('Truehost Cloud Limited', 'email_hosting', 'mail_start', 'yearly', 12, 'Yearly', 2500, 0, false),
        ('Truehost Cloud Limited', 'email_hosting', 'mail_team', 'monthly', 1, 'Monthly', 450, 0, true),
        ('Truehost Cloud Limited', 'email_hosting', 'mail_team', 'yearly', 12, 'Yearly', 4500, 0, false),
        ('Truehost Cloud Limited', 'email_hosting', 'mail_business', 'monthly', 1, 'Monthly', 750, 0, true),
        ('Truehost Cloud Limited', 'email_hosting', 'mail_business', 'yearly', 12, 'Yearly', 7500, 0, false),

        ('Truehost Cloud Limited', 'vps_hosting', 'cloud_2', 'monthly', 1, 'Monthly', 3500, 0, true),
        ('Truehost Cloud Limited', 'vps_hosting', 'cloud_2', 'yearly', 12, 'Yearly', 35000, 0, false),
        ('Truehost Cloud Limited', 'vps_hosting', 'cloud_4', 'monthly', 1, 'Monthly', 6500, 0, true),
        ('Truehost Cloud Limited', 'vps_hosting', 'cloud_4', 'yearly', 12, 'Yearly', 65000, 0, false),
        ('Truehost Cloud Limited', 'vps_hosting', 'cloud_8', 'monthly', 1, 'Monthly', 12500, 0, true),
        ('Truehost Cloud Limited', 'vps_hosting', 'cloud_8', 'yearly', 12, 'Yearly', 125000, 0, false),

        ('Truehost Cloud Limited', 'ssl', 'basic_ssl', 'yearly', 12, 'Yearly', 1800, 0, true),
        ('Truehost Cloud Limited', 'ssl', 'business_ssl', 'yearly', 12, 'Yearly', 4200, 0, true),
        ('Truehost Cloud Limited', 'ssl', 'wildcard_ssl', 'yearly', 12, 'Yearly', 12000, 0, true)
)
INSERT INTO registrar_service_package_prices (
    service_package_id,
    billing_cycle,
    billing_period_months,
    billing_label,
    price_ksh,
    setup_fee_ksh,
    currency_code,
    is_default,
    is_active
)
SELECT
    registrar_service_packages.id,
    package_price_seed.billing_cycle,
    package_price_seed.billing_period_months,
    package_price_seed.billing_label,
    package_price_seed.price_ksh,
    package_price_seed.setup_fee_ksh,
    'KES',
    package_price_seed.is_default,
    true
FROM package_price_seed
INNER JOIN registrars
    ON LOWER(registrars.name) = LOWER(package_price_seed.registrar_name)
INNER JOIN service_products
    ON service_products.service_code = package_price_seed.service_code
INNER JOIN registrar_service_packages
    ON registrar_service_packages.registrar_id = registrars.id
   AND registrar_service_packages.service_product_id = service_products.id
   AND registrar_service_packages.package_code = package_price_seed.package_code;
