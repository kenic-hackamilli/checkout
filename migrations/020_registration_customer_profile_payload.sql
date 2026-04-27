ALTER TABLE registrations
    ADD COLUMN IF NOT EXISTS first_name character varying(120);

ALTER TABLE registrations
    ADD COLUMN IF NOT EXISTS last_name character varying(120);

ALTER TABLE registrations
    ADD COLUMN IF NOT EXISTS company_name character varying(255);

ALTER TABLE registrations
    ADD COLUMN IF NOT EXISTS kra_pin character varying(20);

ALTER TABLE registrations
    ADD COLUMN IF NOT EXISTS street_address character varying(255);

ALTER TABLE registrations
    ADD COLUMN IF NOT EXISTS city character varying(120);

ALTER TABLE registrations
    ADD COLUMN IF NOT EXISTS country character varying(120);

ALTER TABLE registrations
    ADD COLUMN IF NOT EXISTS state character varying(120);

ALTER TABLE registrations
    ADD COLUMN IF NOT EXISTS postcode character varying(20);

UPDATE registrations
SET full_name = CONCAT_WS(
        ' ',
        NULLIF(BTRIM(first_name), ''),
        NULLIF(BTRIM(last_name), '')
    )
WHERE COALESCE(BTRIM(full_name), '') = ''
  AND (
    COALESCE(BTRIM(first_name), '') <> ''
    OR COALESCE(BTRIM(last_name), '') <> ''
  );

UPDATE registrations
SET first_name = COALESCE(
        NULLIF(BTRIM(first_name), ''),
        NULLIF(SPLIT_PART(BTRIM(full_name), ' ', 1), '')
    ),
    last_name = COALESCE(
        NULLIF(BTRIM(last_name), ''),
        NULLIF(
            BTRIM(
                SUBSTRING(
                    BTRIM(full_name)
                    FROM LENGTH(SPLIT_PART(BTRIM(full_name), ' ', 1)) + 1
                )
            ),
            ''
        )
    )
WHERE COALESCE(BTRIM(full_name), '') <> '';
