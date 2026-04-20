ALTER TABLE service_products
    ADD COLUMN IF NOT EXISTS product_family character varying(100);

ALTER TABLE service_products
    ADD COLUMN IF NOT EXISTS registrar_id uuid;

UPDATE service_products
SET product_family = CASE
    WHEN service_code IN ('shared_hosting', 'web_hosting', 'wordpress_hosting') THEN 'hosting'
    WHEN service_code = 'email_hosting' THEN 'emails'
    WHEN service_code = 'vps_hosting' THEN 'servers'
    WHEN service_code = 'ssl' THEN 'security'
    WHEN LOWER(COALESCE(service_category, '')) IN ('domain', 'domains') THEN 'domain_registration'
    WHEN LOWER(COALESCE(service_category, '')) IN ('email', 'emails', 'mail') THEN 'emails'
    WHEN LOWER(COALESCE(service_category, '')) IN ('hosting', 'wordpress') THEN 'hosting'
    WHEN LOWER(COALESCE(service_category, '')) IN ('server', 'servers', 'vps') THEN 'servers'
    WHEN LOWER(COALESCE(service_category, '')) IN ('security', 'ssl', 'tls') THEN 'security'
    ELSE LOWER(REGEXP_REPLACE(COALESCE(service_category, 'service'), '[^a-zA-Z0-9]+', '_', 'g'))
END
WHERE COALESCE(product_family, '') = '';

UPDATE service_products
SET product_family = 'hosting'
WHERE product_family = 'wordpress';

UPDATE domain_updater.registrar_enabled_families AS target
SET is_enabled = target.is_enabled OR source.is_enabled
FROM domain_updater.registrar_enabled_families AS source
WHERE target.registrar_id = source.registrar_id
  AND target.product_family = 'hosting'
  AND source.product_family = 'wordpress';

UPDATE domain_updater.registrar_enabled_families
SET product_family = 'hosting'
WHERE product_family = 'wordpress'
  AND NOT EXISTS (
        SELECT 1
        FROM domain_updater.registrar_enabled_families AS existing_hosting
        WHERE existing_hosting.registrar_id = domain_updater.registrar_enabled_families.registrar_id
          AND existing_hosting.product_family = 'hosting'
    );

DELETE FROM domain_updater.registrar_enabled_families AS legacy
WHERE legacy.product_family = 'wordpress'
  AND EXISTS (
        SELECT 1
        FROM domain_updater.registrar_enabled_families AS hosting
        WHERE hosting.registrar_id = legacy.registrar_id
          AND hosting.product_family = 'hosting'
    );

ALTER TABLE service_products
    ALTER COLUMN product_family SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_service_products_product_family
    ON service_products (product_family);

CREATE INDEX IF NOT EXISTS idx_service_products_registrar_family
    ON service_products (registrar_id, product_family);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'service_products_registrar_id_fkey'
    ) THEN
        ALTER TABLE service_products
            ADD CONSTRAINT service_products_registrar_id_fkey
            FOREIGN KEY (registrar_id) REFERENCES registrars(id) ON DELETE CASCADE;
    END IF;
END $$;

UPDATE registrations
SET product_family = 'hosting'
WHERE product_family = 'wordpress'
   OR service_product_code = 'wordpress_hosting';

UPDATE registrations
SET target_service = 'hosting'
WHERE target_service = 'wordpress';

UPDATE registrations
SET selection_snapshot_json = jsonb_set(
        jsonb_set(
            CASE
                WHEN jsonb_typeof(selection_snapshot_json) = 'object'
                    THEN selection_snapshot_json
                ELSE '{}'::jsonb
            END,
            '{product_family}',
            '"hosting"'::jsonb,
            true
        ),
        '{target_service}',
        '"hosting"'::jsonb,
        true
    )
WHERE (
        selection_snapshot_json ->> 'product_family' = 'wordpress'
        OR selection_snapshot_json ->> 'service_product_code' = 'wordpress_hosting'
        OR selection_snapshot_json ->> 'target_service' = 'wordpress'
    );
