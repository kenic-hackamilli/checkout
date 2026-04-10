CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SEQUENCE IF NOT EXISTS registrar_code_seq
    START WITH 1
    INCREMENT BY 1;

CREATE TABLE IF NOT EXISTS schema_migrations (
    version character varying(255) PRIMARY KEY,
    applied_at timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS registrations (
    request_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    external_request_id character varying(10) NOT NULL,
    full_name character varying(255) NOT NULL,
    email character varying(255) NOT NULL,
    phone character varying(50) NOT NULL,
    domain_name character varying(255) NOT NULL,
    target_service character varying(120),
    product_family character varying(120),
    selection_kind character varying(30),
    domain_extension character varying(30),
    registrar_id uuid,
    registrar_name character varying(255),
    domain_offering_id uuid,
    service_package_id uuid,
    service_package_price_id uuid,
    bundle_id uuid,
    service_product_code character varying(120),
    package_code character varying(120),
    package_name character varying(255),
    billing_cycle character varying(30),
    billing_period_months integer,
    currency_code character varying(3),
    quoted_price_ksh integer,
    selection_snapshot_json jsonb NOT NULL DEFAULT '{}'::jsonb,
    registrar_reference_id character varying(255),
    status character varying(50) NOT NULL DEFAULT 'received',
    message_sent boolean DEFAULT false,
    pushed boolean DEFAULT false,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT registrations_external_request_id_format_check CHECK (
        external_request_id ~ '^[0-9]{8}$'
        OR (
            external_request_id ~ '^[A-Z0-9]{10}$'
            AND external_request_id ~ '[A-Z]'
            AND external_request_id ~ '[0-9]'
        )
    )
);

CREATE INDEX IF NOT EXISTS idx_registrations_pushed
    ON registrations (pushed);

CREATE INDEX IF NOT EXISTS idx_registrations_registrar_id
    ON registrations (registrar_id);

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

CREATE UNIQUE INDEX IF NOT EXISTS idx_registrations_external_request_id
    ON registrations (external_request_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_registrations_active_email_domain
    ON registrations (LOWER(email), LOWER(domain_name))
    WHERE status = 'received';

CREATE TABLE IF NOT EXISTS registrars (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    registrar_code character varying(16) NOT NULL DEFAULT ('REG' || LPAD(nextval('registrar_code_seq')::text, 3, '0')),
    name character varying(255) NOT NULL,
    api_endpoint text,
    notification_email character varying(255),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    is_active boolean DEFAULT true,
    CONSTRAINT registrars_registrar_code_format_check CHECK (registrar_code ~ '^REG[0-9]{3,}$')
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_registrars_registrar_code
    ON registrars (registrar_code);

CREATE TABLE IF NOT EXISTS registrar_requests (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    full_name character varying(255) NOT NULL,
    email character varying(255) NOT NULL,
    phone character varying(50),
    domain_name character varying(255) NOT NULL,
    registrar_id uuid,
    registrar_name character varying(255),
    reference_id character varying(255),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_registrar_requests_registrar_id
    ON registrar_requests (registrar_id);

CREATE TABLE IF NOT EXISTS incoming_registrations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    full_name character varying(255),
    email character varying(255),
    phone character varying(20),
    domain_name character varying(255),
    received_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    status character varying(50) DEFAULT 'received'
);

CREATE TABLE IF NOT EXISTS processed_domains (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    incoming_id uuid NOT NULL,
    registrar_reference_id character varying(255),
    processed_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    status character varying(50) DEFAULT 'completed',
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS failed_requests (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    registration_id uuid,
    attempted_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    error_message text
);

CREATE TABLE IF NOT EXISTS delivery_logs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    registration_id uuid NOT NULL,
    delivery_type character varying(30) NOT NULL,
    recipient_type character varying(30) NOT NULL,
    destination text NOT NULL,
    template_key character varying(100) NOT NULL,
    subject character varying(255),
    payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    status character varying(20) NOT NULL DEFAULT 'pending',
    attempts integer NOT NULL DEFAULT 0,
    max_attempts integer NOT NULL DEFAULT 3,
    provider_reference character varying(255),
    last_response text,
    last_error text,
    first_attempted_at timestamp without time zone,
    last_attempted_at timestamp without time zone,
    delivered_at timestamp without time zone,
    created_at timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT delivery_logs_status_check CHECK (status IN ('pending', 'success', 'failed', 'skipped')),
    CONSTRAINT delivery_logs_type_check CHECK (delivery_type IN ('sms', 'email', 'registrar_api')),
    CONSTRAINT delivery_logs_recipient_check CHECK (recipient_type IN ('user', 'registrar')),
    CONSTRAINT delivery_logs_attempts_check CHECK (attempts >= 0),
    CONSTRAINT delivery_logs_max_attempts_check CHECK (max_attempts > 0),
    CONSTRAINT delivery_logs_registration_channel_unique UNIQUE (registration_id, delivery_type, recipient_type, template_key),
    CONSTRAINT delivery_logs_registration_id_fkey FOREIGN KEY (registration_id) REFERENCES registrations(request_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS delivery_attempt_logs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    delivery_log_id uuid NOT NULL,
    attempt_number integer NOT NULL,
    status character varying(20) NOT NULL,
    response_message text,
    error_message text,
    attempted_at timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT delivery_attempt_logs_status_check CHECK (status IN ('success', 'failed')),
    CONSTRAINT delivery_attempt_logs_delivery_log_id_fkey FOREIGN KEY (delivery_log_id) REFERENCES delivery_logs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_delivery_logs_registration_id
    ON delivery_logs (registration_id);

CREATE INDEX IF NOT EXISTS idx_delivery_logs_status
    ON delivery_logs (status);

CREATE INDEX IF NOT EXISTS idx_delivery_attempt_logs_delivery_log_id
    ON delivery_attempt_logs (delivery_log_id);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'failed_requests_registration_id_fkey'
    ) THEN
        ALTER TABLE failed_requests
            ADD CONSTRAINT failed_requests_registration_id_fkey
            FOREIGN KEY (registration_id) REFERENCES registrations(request_id);
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'processed_domains_incoming_id_fkey'
    ) THEN
        ALTER TABLE processed_domains
            ADD CONSTRAINT processed_domains_incoming_id_fkey
            FOREIGN KEY (incoming_id) REFERENCES incoming_registrations(id);
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
    ON registrar_domain_offerings (registrar_id, domain_extension_id, billing_period_months);

CREATE INDEX IF NOT EXISTS idx_registrar_domain_offerings_extension
    ON registrar_domain_offerings (domain_extension_id);

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
    ON registrar_service_package_prices (service_package_id, billing_cycle, billing_period_months);

CREATE INDEX IF NOT EXISTS idx_registrar_service_package_prices_package_id
    ON registrar_service_package_prices (service_package_id);

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
        WHERE conname = 'bundle_templates_registrar_id_fkey'
    ) THEN
        ALTER TABLE bundle_templates
            ADD CONSTRAINT bundle_templates_registrar_id_fkey
            FOREIGN KEY (registrar_id) REFERENCES registrars(id) ON DELETE CASCADE;
    END IF;
END $$;

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
