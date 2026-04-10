-- Enforce one package price per service package to avoid monthly/yearly duplication.

WITH ranked_prices AS (
    SELECT
        id,
        service_package_id,
        ROW_NUMBER() OVER (
            PARTITION BY service_package_id
            ORDER BY
                is_default DESC,
                is_active DESC,
                price_ksh ASC,
                billing_period_months ASC,
                created_at ASC,
                id ASC
        ) AS row_rank
    FROM registrar_service_package_prices
)
DELETE FROM registrar_service_package_prices AS rspp
USING ranked_prices
WHERE rspp.id = ranked_prices.id
  AND ranked_prices.row_rank > 1;

UPDATE registrar_service_package_prices
SET billing_cycle = CASE
        WHEN billing_period_months = 1 THEN 'monthly'
        WHEN billing_period_months = 12 THEN 'yearly'
        ELSE COALESCE(NULLIF(LOWER(billing_cycle), ''), 'custom')
    END,
    is_default = true,
    updated_at = NOW();

DROP INDEX IF EXISTS idx_registrar_service_package_prices_unique;

CREATE UNIQUE INDEX IF NOT EXISTS idx_registrar_service_package_prices_single_price
    ON registrar_service_package_prices (service_package_id);
