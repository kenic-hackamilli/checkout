ALTER TABLE registrations
    ADD COLUMN IF NOT EXISTS product_family character varying(120);

ALTER TABLE registrations
    ADD COLUMN IF NOT EXISTS selection_kind character varying(30);

ALTER TABLE registrations
    ADD COLUMN IF NOT EXISTS domain_offering_id uuid;

ALTER TABLE registrations
    ADD COLUMN IF NOT EXISTS service_package_id uuid;

ALTER TABLE registrations
    ADD COLUMN IF NOT EXISTS service_package_price_id uuid;

ALTER TABLE registrations
    ADD COLUMN IF NOT EXISTS bundle_id uuid;

ALTER TABLE registrations
    ADD COLUMN IF NOT EXISTS service_product_code character varying(120);

ALTER TABLE registrations
    ADD COLUMN IF NOT EXISTS package_code character varying(120);

ALTER TABLE registrations
    ADD COLUMN IF NOT EXISTS package_name character varying(255);

ALTER TABLE registrations
    ADD COLUMN IF NOT EXISTS billing_cycle character varying(30);

ALTER TABLE registrations
    ADD COLUMN IF NOT EXISTS billing_period_months integer;

ALTER TABLE registrations
    ADD COLUMN IF NOT EXISTS currency_code character varying(3);

ALTER TABLE registrations
    ADD COLUMN IF NOT EXISTS quoted_price_ksh integer;

ALTER TABLE registrations
    ADD COLUMN IF NOT EXISTS selection_snapshot_json jsonb NOT NULL DEFAULT '{}'::jsonb;

UPDATE registrations
SET product_family = COALESCE(NULLIF(product_family, ''), NULLIF(target_service, ''))
WHERE COALESCE(product_family, '') = ''
  AND COALESCE(target_service, '') <> '';

CREATE INDEX IF NOT EXISTS idx_registrations_product_family
    ON registrations (product_family);

CREATE INDEX IF NOT EXISTS idx_registrations_domain_offering_id
    ON registrations (domain_offering_id);

CREATE INDEX IF NOT EXISTS idx_registrations_service_package_id
    ON registrations (service_package_id);

CREATE INDEX IF NOT EXISTS idx_registrations_service_package_price_id
    ON registrations (service_package_price_id);

CREATE INDEX IF NOT EXISTS idx_registrations_bundle_id
    ON registrations (bundle_id);

CREATE TABLE IF NOT EXISTS registrar_service_packages (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    registrar_id uuid NOT NULL,
    service_product_id uuid NOT NULL,
    package_code character varying(120) NOT NULL,
    package_name character varying(255) NOT NULL,
    short_description text,
    details_json jsonb NOT NULL DEFAULT '{}'::jsonb,
    feature_bullets_json jsonb NOT NULL DEFAULT '[]'::jsonb,
    display_order integer NOT NULL DEFAULT 0,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT registrar_service_packages_display_order_check CHECK (display_order >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_registrar_service_packages_unique
    ON registrar_service_packages (registrar_id, service_product_id, package_code);

CREATE INDEX IF NOT EXISTS idx_registrar_service_packages_registrar_id
    ON registrar_service_packages (registrar_id);

CREATE INDEX IF NOT EXISTS idx_registrar_service_packages_service_product_id
    ON registrar_service_packages (service_product_id);

CREATE TABLE IF NOT EXISTS registrar_service_package_prices (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    service_package_id uuid NOT NULL,
    billing_cycle character varying(30) NOT NULL DEFAULT 'monthly',
    billing_period_months integer NOT NULL DEFAULT 1,
    billing_label character varying(60),
    price_ksh integer NOT NULL,
    setup_fee_ksh integer NOT NULL DEFAULT 0,
    currency_code character varying(3) NOT NULL DEFAULT 'KES',
    is_default boolean NOT NULL DEFAULT false,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT registrar_service_package_prices_price_check CHECK (price_ksh >= 0),
    CONSTRAINT registrar_service_package_prices_setup_fee_check CHECK (setup_fee_ksh >= 0),
    CONSTRAINT registrar_service_package_prices_billing_period_check CHECK (billing_period_months > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_registrar_service_package_prices_unique
    ON registrar_service_package_prices (
        service_package_id,
        billing_cycle,
        billing_period_months
    );

CREATE INDEX IF NOT EXISTS idx_registrar_service_package_prices_package_id
    ON registrar_service_package_prices (service_package_id);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'registrar_service_packages_registrar_id_fkey'
    ) THEN
        ALTER TABLE registrar_service_packages
            ADD CONSTRAINT registrar_service_packages_registrar_id_fkey
            FOREIGN KEY (registrar_id) REFERENCES registrars(id) ON DELETE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'registrar_service_packages_service_product_id_fkey'
    ) THEN
        ALTER TABLE registrar_service_packages
            ADD CONSTRAINT registrar_service_packages_service_product_id_fkey
            FOREIGN KEY (service_product_id) REFERENCES service_products(id) ON DELETE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'registrar_service_package_prices_service_package_id_fkey'
    ) THEN
        ALTER TABLE registrar_service_package_prices
            ADD CONSTRAINT registrar_service_package_prices_service_package_id_fkey
            FOREIGN KEY (service_package_id) REFERENCES registrar_service_packages(id) ON DELETE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'registrations_domain_offering_id_fkey'
    ) THEN
        ALTER TABLE registrations
            ADD CONSTRAINT registrations_domain_offering_id_fkey
            FOREIGN KEY (domain_offering_id) REFERENCES registrar_domain_offerings(id) ON DELETE SET NULL;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'registrations_service_package_id_fkey'
    ) THEN
        ALTER TABLE registrations
            ADD CONSTRAINT registrations_service_package_id_fkey
            FOREIGN KEY (service_package_id) REFERENCES registrar_service_packages(id) ON DELETE SET NULL;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'registrations_service_package_price_id_fkey'
    ) THEN
        ALTER TABLE registrations
            ADD CONSTRAINT registrations_service_package_price_id_fkey
            FOREIGN KEY (service_package_price_id) REFERENCES registrar_service_package_prices(id) ON DELETE SET NULL;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'registrations_bundle_id_fkey'
    ) THEN
        ALTER TABLE registrations
            ADD CONSTRAINT registrations_bundle_id_fkey
            FOREIGN KEY (bundle_id) REFERENCES bundle_templates(id) ON DELETE SET NULL;
    END IF;
END $$;

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
    rso.registrar_id,
    rso.service_product_id,
    rso.plan_code,
    rso.plan_name,
    NULL,
    CASE
        WHEN jsonb_typeof(rso.features_json) = 'object' THEN rso.features_json
        ELSE '{}'::jsonb
    END,
    COALESCE(
        (
            SELECT jsonb_agg(
                CONCAT(
                    INITCAP(REPLACE(feature.key, '_', ' ')),
                    ': ',
                    feature.value
                )
                ORDER BY feature.key
            )
            FROM jsonb_each_text(
                CASE
                    WHEN jsonb_typeof(rso.features_json) = 'object' THEN rso.features_json
                    ELSE '{}'::jsonb
                END
            ) AS feature
        ),
        '[]'::jsonb
    ),
    0,
    rso.is_active
FROM registrar_service_offerings rso
WHERE NOT EXISTS (
    SELECT 1
    FROM registrar_service_packages rsp
    WHERE rsp.registrar_id = rso.registrar_id
      AND rsp.service_product_id = rso.service_product_id
      AND rsp.package_code = rso.plan_code
);

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
    rsp.id,
    rso.billing_cycle,
    rso.billing_period_months,
    CASE
        WHEN LOWER(COALESCE(rso.billing_cycle, '')) = 'monthly' OR rso.billing_period_months = 1 THEN 'Monthly'
        WHEN LOWER(COALESCE(rso.billing_cycle, '')) = 'yearly' OR rso.billing_period_months = 12 THEN 'Yearly'
        WHEN rso.billing_period_months > 0 THEN CONCAT(rso.billing_period_months, ' months')
        ELSE 'Flexible'
    END,
    rso.price_ksh,
    rso.setup_fee_ksh,
    rso.currency_code,
    true,
    rso.is_active
FROM registrar_service_offerings rso
INNER JOIN registrar_service_packages rsp
    ON rsp.registrar_id = rso.registrar_id
   AND rsp.service_product_id = rso.service_product_id
   AND rsp.package_code = rso.plan_code
WHERE NOT EXISTS (
    SELECT 1
    FROM registrar_service_package_prices rspp
    WHERE rspp.service_package_id = rsp.id
      AND rspp.billing_cycle = rso.billing_cycle
      AND rspp.billing_period_months = rso.billing_period_months
);
