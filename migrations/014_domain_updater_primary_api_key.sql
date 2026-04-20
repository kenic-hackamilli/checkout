UPDATE domain_updater.registrar_api_keys
SET expires_at = COALESCE(expires_at, created_at + INTERVAL '365 days')
WHERE expires_at IS NULL;

UPDATE domain_updater.registrar_api_keys
SET status = 'expired'
WHERE status = 'active'
  AND expires_at IS NOT NULL
  AND expires_at <= CURRENT_TIMESTAMP;

WITH ranked_active_keys AS (
    SELECT
        id,
        ROW_NUMBER() OVER (
            PARTITION BY registrar_id
            ORDER BY created_at DESC, id DESC
        ) AS row_number
    FROM domain_updater.registrar_api_keys
    WHERE status = 'active'
)
UPDATE domain_updater.registrar_api_keys rak
SET status = 'revoked',
    revoked_at = COALESCE(rak.revoked_at, CURRENT_TIMESTAMP),
    revoked_by_actor_type = COALESCE(rak.revoked_by_actor_type, 'migration_014'),
    revoked_by_actor_id = COALESCE(rak.revoked_by_actor_id, 'single_primary_key')
FROM ranked_active_keys
WHERE rak.id = ranked_active_keys.id
  AND ranked_active_keys.row_number > 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_domain_updater_registrar_api_keys_single_active
    ON domain_updater.registrar_api_keys (registrar_id)
    WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_domain_updater_registrar_api_keys_expires_at
    ON domain_updater.registrar_api_keys (expires_at);
