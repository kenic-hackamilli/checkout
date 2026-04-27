UPDATE registrars
SET name = BTRIM(name),
    primary_email = LOWER(BTRIM(primary_email)),
    primary_phone = BTRIM(primary_phone),
    api_endpoint = BTRIM(api_endpoint),
    notification_email = LOWER(BTRIM(notification_email))
WHERE name IS DISTINCT FROM BTRIM(name)
   OR primary_email IS DISTINCT FROM LOWER(BTRIM(primary_email))
   OR primary_phone IS DISTINCT FROM BTRIM(primary_phone)
   OR api_endpoint IS DISTINCT FROM BTRIM(api_endpoint)
   OR notification_email IS DISTINCT FROM LOWER(BTRIM(notification_email));

DO $$
DECLARE
    incomplete_registrar_count integer;
BEGIN
    SELECT COUNT(*)::int
    INTO incomplete_registrar_count
    FROM registrars
    WHERE COALESCE(BTRIM(name), '') = ''
       OR COALESCE(BTRIM(primary_email), '') = ''
       OR COALESCE(BTRIM(primary_phone), '') = ''
       OR COALESCE(BTRIM(api_endpoint), '') = ''
       OR COALESCE(BTRIM(notification_email), '') = ''
       OR is_active IS NULL;

    IF incomplete_registrar_count > 0 THEN
        RAISE EXCEPTION
            'Cannot enforce complete registrar profiles while % registrar row(s) still have missing required fields. Complete or delete those registrar rows first, then rerun the migration.',
            incomplete_registrar_count;
    END IF;
END $$;

ALTER TABLE registrars
    ALTER COLUMN primary_email SET NOT NULL,
    ALTER COLUMN primary_phone SET NOT NULL,
    ALTER COLUMN api_endpoint SET NOT NULL,
    ALTER COLUMN notification_email SET NOT NULL,
    ALTER COLUMN is_active SET NOT NULL;

ALTER TABLE registrars
    DROP CONSTRAINT IF EXISTS registrars_name_not_blank_check,
    DROP CONSTRAINT IF EXISTS registrars_primary_email_not_blank_check,
    DROP CONSTRAINT IF EXISTS registrars_primary_phone_not_blank_check,
    DROP CONSTRAINT IF EXISTS registrars_api_endpoint_not_blank_check,
    DROP CONSTRAINT IF EXISTS registrars_notification_email_not_blank_check;

ALTER TABLE registrars
    ADD CONSTRAINT registrars_name_not_blank_check
        CHECK (BTRIM(name) <> ''),
    ADD CONSTRAINT registrars_primary_email_not_blank_check
        CHECK (BTRIM(primary_email) <> ''),
    ADD CONSTRAINT registrars_primary_phone_not_blank_check
        CHECK (BTRIM(primary_phone) <> ''),
    ADD CONSTRAINT registrars_api_endpoint_not_blank_check
        CHECK (BTRIM(api_endpoint) <> ''),
    ADD CONSTRAINT registrars_notification_email_not_blank_check
        CHECK (BTRIM(notification_email) <> '');
