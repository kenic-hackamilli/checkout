DROP INDEX IF EXISTS idx_registrar_domain_offerings_unique;

CREATE UNIQUE INDEX IF NOT EXISTS idx_registrar_domain_offerings_unique
    ON registrar_domain_offerings (registrar_id, domain_extension_id, billing_period_months);
