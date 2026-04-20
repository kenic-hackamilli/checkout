ALTER TABLE registrars
    ADD COLUMN IF NOT EXISTS primary_email character varying(255);

ALTER TABLE registrars
    ADD COLUMN IF NOT EXISTS primary_phone character varying(50);

ALTER TABLE registrars
    ADD COLUMN IF NOT EXISTS updated_at timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE registrars
    ADD COLUMN IF NOT EXISTS updated_by_actor_type character varying(50);

ALTER TABLE registrars
    ADD COLUMN IF NOT EXISTS updated_by_actor_id character varying(255);

UPDATE registrars
SET primary_email = notification_email
WHERE primary_email IS NULL
  AND notification_email IS NOT NULL;

UPDATE registrars
SET updated_at = COALESCE(updated_at, created_at, CURRENT_TIMESTAMP)
WHERE updated_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_registrars_primary_email
    ON registrars (LOWER(primary_email));

CREATE INDEX IF NOT EXISTS idx_registrars_primary_phone
    ON registrars (primary_phone);

CREATE INDEX IF NOT EXISTS idx_registrars_updated_at
    ON registrars (updated_at);

CREATE SCHEMA IF NOT EXISTS domain_updater;

CREATE TABLE IF NOT EXISTS domain_updater.registrar_api_keys (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    registrar_id uuid NOT NULL REFERENCES registrars(id) ON DELETE CASCADE,
    key_label character varying(120) NOT NULL,
    key_prefix character varying(40) NOT NULL,
    key_hash character varying(64) NOT NULL,
    status character varying(20) NOT NULL DEFAULT 'active',
    last_used_at timestamp without time zone,
    expires_at timestamp without time zone,
    created_by_actor_type character varying(50),
    created_by_actor_id character varying(255),
    revoked_at timestamp without time zone,
    revoked_by_actor_type character varying(50),
    revoked_by_actor_id character varying(255),
    created_at timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT registrar_api_keys_status_check CHECK (status IN ('active', 'revoked', 'expired'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_domain_updater_registrar_api_keys_prefix
    ON domain_updater.registrar_api_keys (key_prefix);

CREATE UNIQUE INDEX IF NOT EXISTS idx_domain_updater_registrar_api_keys_hash
    ON domain_updater.registrar_api_keys (key_hash);

CREATE INDEX IF NOT EXISTS idx_domain_updater_registrar_api_keys_registrar_id
    ON domain_updater.registrar_api_keys (registrar_id);

CREATE TABLE IF NOT EXISTS domain_updater.auth_challenges (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    registrar_id uuid NOT NULL REFERENCES registrars(id) ON DELETE CASCADE,
    api_key_id uuid NOT NULL REFERENCES domain_updater.registrar_api_keys(id) ON DELETE CASCADE,
    challenge_type character varying(30) NOT NULL DEFAULT 'login',
    email_request_id character varying(255),
    phone_request_id character varying(255),
    email_target_masked character varying(255),
    phone_target_masked character varying(50),
    verification_policy character varying(20) NOT NULL DEFAULT 'either_channel',
    email_verified_at timestamp without time zone,
    phone_verified_at timestamp without time zone,
    failed_attempts integer NOT NULL DEFAULT 0,
    status character varying(20) NOT NULL DEFAULT 'pending',
    expires_at timestamp without time zone NOT NULL,
    client_ip inet,
    user_agent text,
    created_at timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT auth_challenges_type_check CHECK (challenge_type IN ('login', 'step_up')),
    CONSTRAINT auth_challenges_policy_check CHECK (verification_policy IN ('either_channel', 'both_channels')),
    CONSTRAINT auth_challenges_status_check CHECK (status IN ('pending', 'verified', 'failed', 'expired', 'cancelled')),
    CONSTRAINT auth_challenges_failed_attempts_check CHECK (failed_attempts >= 0),
    CONSTRAINT auth_challenges_channel_check CHECK (email_request_id IS NOT NULL OR phone_request_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_domain_updater_auth_challenges_registrar_id
    ON domain_updater.auth_challenges (registrar_id);

CREATE INDEX IF NOT EXISTS idx_domain_updater_auth_challenges_status
    ON domain_updater.auth_challenges (status, expires_at);

CREATE TABLE IF NOT EXISTS domain_updater.portal_sessions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    registrar_id uuid NOT NULL REFERENCES registrars(id) ON DELETE CASCADE,
    api_key_id uuid NOT NULL REFERENCES domain_updater.registrar_api_keys(id) ON DELETE CASCADE,
    challenge_id uuid REFERENCES domain_updater.auth_challenges(id) ON DELETE SET NULL,
    role character varying(30) NOT NULL DEFAULT 'registrar_admin',
    session_token_hash character varying(64) NOT NULL,
    issued_at timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at timestamp without time zone NOT NULL,
    last_seen_at timestamp without time zone,
    revoked_at timestamp without time zone,
    client_ip inet,
    user_agent text,
    created_at timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT portal_sessions_role_check CHECK (role IN ('registrar_admin', 'registrar_editor', 'registrar_viewer'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_domain_updater_portal_sessions_token_hash
    ON domain_updater.portal_sessions (session_token_hash);

CREATE INDEX IF NOT EXISTS idx_domain_updater_portal_sessions_registrar_id
    ON domain_updater.portal_sessions (registrar_id);

CREATE INDEX IF NOT EXISTS idx_domain_updater_portal_sessions_expires_at
    ON domain_updater.portal_sessions (expires_at);

CREATE TABLE IF NOT EXISTS domain_updater.audit_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    registrar_id uuid REFERENCES registrars(id) ON DELETE CASCADE,
    actor_type character varying(50) NOT NULL,
    actor_id character varying(255),
    action character varying(120) NOT NULL,
    entity_type character varying(120) NOT NULL,
    entity_id character varying(255),
    before_json jsonb NOT NULL DEFAULT '{}'::jsonb,
    after_json jsonb NOT NULL DEFAULT '{}'::jsonb,
    metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_domain_updater_audit_events_registrar_id
    ON domain_updater.audit_events (registrar_id, created_at DESC);

CREATE TABLE IF NOT EXISTS domain_updater.registrar_enabled_families (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    registrar_id uuid NOT NULL REFERENCES registrars(id) ON DELETE CASCADE,
    product_family character varying(120) NOT NULL,
    is_enabled boolean NOT NULL DEFAULT true,
    created_at timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT registrar_enabled_families_unique UNIQUE (registrar_id, product_family)
);

CREATE INDEX IF NOT EXISTS idx_domain_updater_registrar_enabled_families_registrar_id
    ON domain_updater.registrar_enabled_families (registrar_id);
