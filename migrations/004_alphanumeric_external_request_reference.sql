ALTER TABLE registrations
    ALTER COLUMN external_request_id TYPE character varying(10);

ALTER TABLE registrations
    DROP CONSTRAINT IF EXISTS registrations_external_request_id_format_check;

ALTER TABLE registrations
    ADD CONSTRAINT registrations_external_request_id_format_check
    CHECK (
        external_request_id ~ '^[0-9]{8}$'
        OR (
            external_request_id ~ '^[A-Z0-9]{10}$'
            AND external_request_id ~ '[A-Z]'
            AND external_request_id ~ '[0-9]'
        )
    );
