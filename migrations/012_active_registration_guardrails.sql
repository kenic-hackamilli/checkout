WITH ranked_active_orders AS (
    SELECT
        request_id,
        ROW_NUMBER() OVER (
            PARTITION BY LOWER(email), LOWER(domain_name)
            ORDER BY created_at DESC, updated_at DESC, request_id DESC
        ) AS row_number
    FROM registrations
    WHERE status = 'received'
)
UPDATE registrations reg
SET status = 'superseded'
FROM ranked_active_orders ranked
WHERE reg.request_id = ranked.request_id
  AND ranked.row_number > 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_registrations_active_email_domain
    ON registrations (LOWER(email), LOWER(domain_name))
    WHERE status = 'received';
