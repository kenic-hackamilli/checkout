CREATE EXTENSION IF NOT EXISTS pgcrypto;

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
    registrar_name character varying(255),
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

CREATE UNIQUE INDEX IF NOT EXISTS idx_registrations_external_request_id
    ON registrations (external_request_id);

CREATE TABLE IF NOT EXISTS registrars (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name character varying(255) NOT NULL,
    api_endpoint text,
    notification_email character varying(255),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    is_active boolean DEFAULT true
);

CREATE TABLE IF NOT EXISTS registrar_requests (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    full_name character varying(255) NOT NULL,
    email character varying(255) NOT NULL,
    phone character varying(50),
    domain_name character varying(255) NOT NULL,
    registrar_name character varying(255),
    reference_id character varying(255),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);

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
