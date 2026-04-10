ALTER TABLE registrations
    ADD COLUMN IF NOT EXISTS target_service character varying(120);

ALTER TABLE registrations
    ADD COLUMN IF NOT EXISTS domain_extension character varying(30);
