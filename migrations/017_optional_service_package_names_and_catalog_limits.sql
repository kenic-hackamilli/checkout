ALTER TABLE registrar_service_packages
    ALTER COLUMN package_name DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_registrar_service_packages_single_unnamed
    ON registrar_service_packages (registrar_id, service_product_id)
    WHERE package_name IS NULL;

ALTER TABLE registrar_domain_offerings
    DROP CONSTRAINT IF EXISTS registrar_domain_offerings_registration_price_check,
    DROP CONSTRAINT IF EXISTS registrar_domain_offerings_renewal_price_check,
    DROP CONSTRAINT IF EXISTS registrar_domain_offerings_transfer_price_check,
    DROP CONSTRAINT IF EXISTS registrar_domain_offerings_setup_fee_check,
    DROP CONSTRAINT IF EXISTS registrar_domain_offerings_billing_period_check;

ALTER TABLE registrar_domain_offerings
    ADD CONSTRAINT registrar_domain_offerings_registration_price_check
        CHECK (registration_price_ksh >= 0 AND registration_price_ksh <= 50000) NOT VALID,
    ADD CONSTRAINT registrar_domain_offerings_renewal_price_check
        CHECK (renewal_price_ksh IS NULL OR (renewal_price_ksh >= 0 AND renewal_price_ksh <= 50000)) NOT VALID,
    ADD CONSTRAINT registrar_domain_offerings_transfer_price_check
        CHECK (transfer_price_ksh IS NULL OR (transfer_price_ksh >= 0 AND transfer_price_ksh <= 50000)) NOT VALID,
    ADD CONSTRAINT registrar_domain_offerings_setup_fee_check
        CHECK (setup_fee_ksh >= 0 AND setup_fee_ksh <= 50000) NOT VALID,
    ADD CONSTRAINT registrar_domain_offerings_billing_period_check
        CHECK (billing_period_months > 0 AND billing_period_months <= 24) NOT VALID;

ALTER TABLE registrar_service_offerings
    DROP CONSTRAINT IF EXISTS registrar_service_offerings_price_check,
    DROP CONSTRAINT IF EXISTS registrar_service_offerings_setup_fee_check,
    DROP CONSTRAINT IF EXISTS registrar_service_offerings_billing_period_check;

ALTER TABLE registrar_service_offerings
    ADD CONSTRAINT registrar_service_offerings_price_check
        CHECK (price_ksh >= 0 AND price_ksh <= 50000) NOT VALID,
    ADD CONSTRAINT registrar_service_offerings_setup_fee_check
        CHECK (setup_fee_ksh >= 0 AND setup_fee_ksh <= 50000) NOT VALID,
    ADD CONSTRAINT registrar_service_offerings_billing_period_check
        CHECK (billing_period_months > 0 AND billing_period_months <= 24) NOT VALID;

ALTER TABLE registrar_service_package_prices
    DROP CONSTRAINT IF EXISTS registrar_service_package_prices_price_check,
    DROP CONSTRAINT IF EXISTS registrar_service_package_prices_setup_fee_check,
    DROP CONSTRAINT IF EXISTS registrar_service_package_prices_billing_period_check;

ALTER TABLE registrar_service_package_prices
    ADD CONSTRAINT registrar_service_package_prices_price_check
        CHECK (price_ksh >= 0 AND price_ksh <= 50000) NOT VALID,
    ADD CONSTRAINT registrar_service_package_prices_setup_fee_check
        CHECK (setup_fee_ksh >= 0 AND setup_fee_ksh <= 50000) NOT VALID,
    ADD CONSTRAINT registrar_service_package_prices_billing_period_check
        CHECK (billing_period_months > 0 AND billing_period_months <= 24) NOT VALID;
