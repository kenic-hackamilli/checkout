ALTER TABLE registrars
    ADD COLUMN IF NOT EXISTS notification_email character varying(255);

ALTER TABLE registrations
    ADD COLUMN IF NOT EXISTS registrar_reference_id character varying(255);

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
    CONSTRAINT delivery_logs_max_attempts_check CHECK (max_attempts > 0)
);

CREATE TABLE IF NOT EXISTS delivery_attempt_logs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    delivery_log_id uuid NOT NULL,
    attempt_number integer NOT NULL,
    status character varying(20) NOT NULL,
    response_message text,
    error_message text,
    attempted_at timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT delivery_attempt_logs_status_check CHECK (status IN ('success', 'failed'))
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
        WHERE conname = 'delivery_logs_registration_id_fkey'
    ) THEN
        ALTER TABLE delivery_logs
            ADD CONSTRAINT delivery_logs_registration_id_fkey
            FOREIGN KEY (registration_id) REFERENCES registrations(request_id) ON DELETE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'delivery_attempt_logs_delivery_log_id_fkey'
    ) THEN
        ALTER TABLE delivery_attempt_logs
            ADD CONSTRAINT delivery_attempt_logs_delivery_log_id_fkey
            FOREIGN KEY (delivery_log_id) REFERENCES delivery_logs(id) ON DELETE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'delivery_logs_registration_channel_unique'
    ) THEN
        ALTER TABLE delivery_logs
            ADD CONSTRAINT delivery_logs_registration_channel_unique
            UNIQUE (registration_id, delivery_type, recipient_type, template_key);
    END IF;
END $$;
