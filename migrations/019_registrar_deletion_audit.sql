CREATE TABLE IF NOT EXISTS registrar_deletion_audit (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    registrar_id uuid NOT NULL,
    registrar_code character varying(16),
    registrar_name character varying(255) NOT NULL,
    primary_email character varying(255),
    primary_phone character varying(50),
    notification_email character varying(255),
    api_endpoint text,
    was_active boolean,
    deleted_at timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_by_actor_type character varying(50) NOT NULL,
    deleted_by_actor_id character varying(255),
    confirmation_phrase character varying(50),
    snapshot_json jsonb NOT NULL DEFAULT '{}'::jsonb,
    deletion_summary_json jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_registrar_deletion_audit_registrar_id
    ON registrar_deletion_audit (registrar_id);

CREATE INDEX IF NOT EXISTS idx_registrar_deletion_audit_registrar_code
    ON registrar_deletion_audit (registrar_code);

CREATE INDEX IF NOT EXISTS idx_registrar_deletion_audit_deleted_at
    ON registrar_deletion_audit (deleted_at DESC);
