CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS failed_requests (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    registration_id uuid,
    attempted_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    error_message text
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

CREATE TABLE IF NOT EXISTS registrars (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name character varying(255) NOT NULL,
    api_endpoint text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    is_active boolean DEFAULT true
);

CREATE TABLE IF NOT EXISTS registrations (
    request_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    full_name character varying(255) NOT NULL,
    email character varying(255) NOT NULL,
    phone character varying(50) NOT NULL,
    domain_name character varying(255) NOT NULL,
    registrar_name character varying(255),
    status character varying(50) NOT NULL DEFAULT 'received',
    message_sent boolean DEFAULT false,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    pushed boolean DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_registrations_pushed
    ON registrations (pushed);

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
