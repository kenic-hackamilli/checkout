CREATE UNIQUE INDEX IF NOT EXISTS idx_registrars_name_unique
    ON registrars (LOWER(BTRIM(name)));

CREATE UNIQUE INDEX IF NOT EXISTS idx_registrars_primary_email_unique
    ON registrars (LOWER(BTRIM(primary_email)))
    WHERE primary_email IS NOT NULL
      AND BTRIM(primary_email) <> '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_registrars_notification_email_unique
    ON registrars (LOWER(BTRIM(notification_email)))
    WHERE notification_email IS NOT NULL
      AND BTRIM(notification_email) <> '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_registrars_primary_phone_unique
    ON registrars (regexp_replace(BTRIM(primary_phone), '[^0-9+]', '', 'g'))
    WHERE primary_phone IS NOT NULL
      AND BTRIM(primary_phone) <> '';
