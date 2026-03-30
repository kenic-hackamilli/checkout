ALTER TABLE registrations
    ADD COLUMN IF NOT EXISTS external_request_id character varying(8);

DO $$
DECLARE
    registration_record RECORD;
    generated_reference character varying(8);
BEGIN
    FOR registration_record IN
        SELECT request_id
        FROM registrations
        WHERE external_request_id IS NULL
    LOOP
        LOOP
            generated_reference := LPAD((FLOOR(RANDOM() * 100000000))::bigint::text, 8, '0');

            EXIT WHEN generated_reference <> '00000000'
                AND NOT EXISTS (
                    SELECT 1
                    FROM registrations
                    WHERE external_request_id = generated_reference
                );
        END LOOP;

        UPDATE registrations
        SET external_request_id = generated_reference
        WHERE request_id = registration_record.request_id;
    END LOOP;
END $$;

ALTER TABLE registrations
    ALTER COLUMN external_request_id SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_registrations_external_request_id
    ON registrations (external_request_id);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'registrations_external_request_id_format_check'
    ) THEN
        ALTER TABLE registrations
            ADD CONSTRAINT registrations_external_request_id_format_check
            CHECK (external_request_id ~ '^[0-9]{8}$');
    END IF;
END $$;
