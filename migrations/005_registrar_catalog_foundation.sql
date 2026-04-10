CREATE SEQUENCE IF NOT EXISTS registrar_code_seq
    START WITH 1
    INCREMENT BY 1;

ALTER TABLE registrars
    ADD COLUMN IF NOT EXISTS registrar_code character varying(16);

ALTER TABLE registrars
    ALTER COLUMN registrar_code SET DEFAULT ('REG' || LPAD(nextval('registrar_code_seq')::text, 3, '0'));

UPDATE registrars
SET registrar_code = DEFAULT
WHERE registrar_code IS NULL;

ALTER TABLE registrars
    ALTER COLUMN registrar_code SET NOT NULL;

DO $$
DECLARE
    max_registrar_code bigint;
BEGIN
    SELECT MAX(CAST(SUBSTRING(registrar_code FROM '[0-9]+$') AS bigint))
    INTO max_registrar_code
    FROM registrars
    WHERE registrar_code ~ '^REG[0-9]+$';

    IF max_registrar_code IS NULL OR max_registrar_code < 1 THEN
        PERFORM setval('registrar_code_seq', 1, false);
    ELSE
        PERFORM setval('registrar_code_seq', max_registrar_code, true);
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_registrars_registrar_code
    ON registrars (registrar_code);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'registrars_registrar_code_format_check'
    ) THEN
        ALTER TABLE registrars
            ADD CONSTRAINT registrars_registrar_code_format_check
            CHECK (registrar_code ~ '^REG[0-9]{3,}$');
    END IF;
END $$;

ALTER TABLE registrations
    ADD COLUMN IF NOT EXISTS registrar_id uuid;

ALTER TABLE registrar_requests
    ADD COLUMN IF NOT EXISTS registrar_id uuid;

UPDATE registrations reg
SET registrar_id = registrar.id
FROM registrars registrar
WHERE reg.registrar_id IS NULL
  AND reg.registrar_name IS NOT NULL
  AND LOWER(reg.registrar_name) = LOWER(registrar.name);

UPDATE registrar_requests req
SET registrar_id = registrar.id
FROM registrars registrar
WHERE req.registrar_id IS NULL
  AND req.registrar_name IS NOT NULL
  AND LOWER(req.registrar_name) = LOWER(registrar.name);

CREATE INDEX IF NOT EXISTS idx_registrations_registrar_id
    ON registrations (registrar_id);

CREATE INDEX IF NOT EXISTS idx_registrar_requests_registrar_id
    ON registrar_requests (registrar_id);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'registrations_registrar_id_fkey'
    ) THEN
        ALTER TABLE registrations
            ADD CONSTRAINT registrations_registrar_id_fkey
            FOREIGN KEY (registrar_id) REFERENCES registrars(id) ON DELETE SET NULL;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'registrar_requests_registrar_id_fkey'
    ) THEN
        ALTER TABLE registrar_requests
            ADD CONSTRAINT registrar_requests_registrar_id_fkey
            FOREIGN KEY (registrar_id) REFERENCES registrars(id) ON DELETE SET NULL;
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS domain_extensions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code character varying(100) NOT NULL,
    label character varying(100) NOT NULL,
    extension character varying(30) NOT NULL,
    category_key character varying(100) NOT NULL,
    sort_order integer NOT NULL DEFAULT 0,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_domain_extensions_code
    ON domain_extensions (code);

CREATE UNIQUE INDEX IF NOT EXISTS idx_domain_extensions_extension
    ON domain_extensions (extension);

INSERT INTO domain_extensions (code, label, extension, category_key, sort_order)
VALUES
    ('company', 'Company', '.co.ke', 'Company', 1),
    ('organization', 'Organization', '.or.ke', 'Organization', 2),
    ('network', 'Network', '.ne.ke', 'Network', 3),
    ('personal', 'Personal', '.me.ke', 'Personal', 4),
    ('mobile', 'Mobile', '.mobi.ke', 'Mobile', 5),
    ('information', 'Information', '.info.ke', 'Information', 6),
    ('general', 'General', '.ke', 'General', 7)
ON CONFLICT (extension) DO NOTHING;

CREATE TABLE IF NOT EXISTS service_products (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    service_code character varying(100) NOT NULL,
    name character varying(255) NOT NULL,
    service_category character varying(100) NOT NULL,
    description text,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_service_products_service_code
    ON service_products (service_code);

INSERT INTO service_products (service_code, name, service_category, description)
VALUES
    ('shared_hosting', 'Shared Hosting', 'hosting', 'Entry-level shared hosting plans.'),
    ('vps_hosting', 'VPS Hosting', 'hosting', 'Virtual private server hosting plans.'),
    ('web_hosting', 'Web Hosting', 'hosting', 'General website hosting packages.'),
    ('wordpress_hosting', 'WordPress Hosting', 'hosting', 'Managed WordPress hosting plans.'),
    ('ssl', 'SSL Certificate', 'security', 'Website SSL and TLS certificate plans.'),
    ('email_hosting', 'Email Hosting', 'email', 'Business email hosting packages.')
ON CONFLICT (service_code) DO NOTHING;

CREATE TABLE IF NOT EXISTS registrar_domain_offerings (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    registrar_id uuid NOT NULL,
    domain_extension_id uuid NOT NULL,
    registration_price_ksh integer NOT NULL,
    renewal_price_ksh integer,
    transfer_price_ksh integer,
    setup_fee_ksh integer NOT NULL DEFAULT 0,
    currency_code character varying(3) NOT NULL DEFAULT 'KES',
    billing_period_months integer NOT NULL DEFAULT 12,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT registrar_domain_offerings_registration_price_check CHECK (registration_price_ksh >= 0),
    CONSTRAINT registrar_domain_offerings_renewal_price_check CHECK (renewal_price_ksh IS NULL OR renewal_price_ksh >= 0),
    CONSTRAINT registrar_domain_offerings_transfer_price_check CHECK (transfer_price_ksh IS NULL OR transfer_price_ksh >= 0),
    CONSTRAINT registrar_domain_offerings_setup_fee_check CHECK (setup_fee_ksh >= 0),
    CONSTRAINT registrar_domain_offerings_billing_period_check CHECK (billing_period_months > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_registrar_domain_offerings_unique
    ON registrar_domain_offerings (registrar_id, domain_extension_id);

CREATE INDEX IF NOT EXISTS idx_registrar_domain_offerings_extension
    ON registrar_domain_offerings (domain_extension_id);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'registrar_domain_offerings_registrar_id_fkey'
    ) THEN
        ALTER TABLE registrar_domain_offerings
            ADD CONSTRAINT registrar_domain_offerings_registrar_id_fkey
            FOREIGN KEY (registrar_id) REFERENCES registrars(id) ON DELETE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'registrar_domain_offerings_domain_extension_id_fkey'
    ) THEN
        ALTER TABLE registrar_domain_offerings
            ADD CONSTRAINT registrar_domain_offerings_domain_extension_id_fkey
            FOREIGN KEY (domain_extension_id) REFERENCES domain_extensions(id) ON DELETE CASCADE;
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS registrar_service_offerings (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    registrar_id uuid NOT NULL,
    service_product_id uuid NOT NULL,
    plan_code character varying(120) NOT NULL,
    plan_name character varying(255) NOT NULL,
    billing_cycle character varying(30) NOT NULL DEFAULT 'monthly',
    billing_period_months integer NOT NULL DEFAULT 1,
    price_ksh integer NOT NULL,
    setup_fee_ksh integer NOT NULL DEFAULT 0,
    currency_code character varying(3) NOT NULL DEFAULT 'KES',
    features_json jsonb NOT NULL DEFAULT '{}'::jsonb,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT registrar_service_offerings_price_check CHECK (price_ksh >= 0),
    CONSTRAINT registrar_service_offerings_setup_fee_check CHECK (setup_fee_ksh >= 0),
    CONSTRAINT registrar_service_offerings_billing_period_check CHECK (billing_period_months > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_registrar_service_offerings_unique
    ON registrar_service_offerings (registrar_id, service_product_id, plan_code);

CREATE INDEX IF NOT EXISTS idx_registrar_service_offerings_registrar_id
    ON registrar_service_offerings (registrar_id);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'registrar_service_offerings_registrar_id_fkey'
    ) THEN
        ALTER TABLE registrar_service_offerings
            ADD CONSTRAINT registrar_service_offerings_registrar_id_fkey
            FOREIGN KEY (registrar_id) REFERENCES registrars(id) ON DELETE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'registrar_service_offerings_service_product_id_fkey'
    ) THEN
        ALTER TABLE registrar_service_offerings
            ADD CONSTRAINT registrar_service_offerings_service_product_id_fkey
            FOREIGN KEY (service_product_id) REFERENCES service_products(id) ON DELETE CASCADE;
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS bundle_templates (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    registrar_id uuid NOT NULL,
    bundle_code character varying(120) NOT NULL,
    bundle_name character varying(255) NOT NULL,
    description text,
    price_ksh integer NOT NULL,
    currency_code character varying(3) NOT NULL DEFAULT 'KES',
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT bundle_templates_price_check CHECK (price_ksh >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_bundle_templates_unique
    ON bundle_templates (registrar_id, bundle_code);

CREATE INDEX IF NOT EXISTS idx_bundle_templates_registrar_id
    ON bundle_templates (registrar_id);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'bundle_templates_registrar_id_fkey'
    ) THEN
        ALTER TABLE bundle_templates
            ADD CONSTRAINT bundle_templates_registrar_id_fkey
            FOREIGN KEY (registrar_id) REFERENCES registrars(id) ON DELETE CASCADE;
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS bundle_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    bundle_id uuid NOT NULL,
    item_type character varying(30) NOT NULL,
    domain_extension_id uuid,
    service_offering_id uuid,
    display_name character varying(255),
    quantity integer NOT NULL DEFAULT 1,
    sort_order integer NOT NULL DEFAULT 0,
    created_at timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT bundle_items_type_check CHECK (item_type IN ('domain_extension', 'service_offering', 'manual')),
    CONSTRAINT bundle_items_quantity_check CHECK (quantity > 0)
);

CREATE INDEX IF NOT EXISTS idx_bundle_items_bundle_id
    ON bundle_items (bundle_id);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'bundle_items_bundle_id_fkey'
    ) THEN
        ALTER TABLE bundle_items
            ADD CONSTRAINT bundle_items_bundle_id_fkey
            FOREIGN KEY (bundle_id) REFERENCES bundle_templates(id) ON DELETE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'bundle_items_domain_extension_id_fkey'
    ) THEN
        ALTER TABLE bundle_items
            ADD CONSTRAINT bundle_items_domain_extension_id_fkey
            FOREIGN KEY (domain_extension_id) REFERENCES domain_extensions(id) ON DELETE SET NULL;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'bundle_items_service_offering_id_fkey'
    ) THEN
        ALTER TABLE bundle_items
            ADD CONSTRAINT bundle_items_service_offering_id_fkey
            FOREIGN KEY (service_offering_id) REFERENCES registrar_service_offerings(id) ON DELETE SET NULL;
    END IF;
END $$;
