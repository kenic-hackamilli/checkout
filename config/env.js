const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ quiet: true });

const DEFAULT_DOMAIN_UPDATER_API_KEY_PEPPER = 'local-domain-updater-pepper';
const DOMAIN_UPDATER_PLACEHOLDER_SECRETS = new Set(['change-me']);

function toNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function isPlaceholderSecret(value) {
  const normalized = normalizeString(value).toLowerCase();
  return !normalized || DOMAIN_UPDATER_PLACEHOLDER_SECRETS.has(normalized);
}

function readEnvValue(filePath, key) {
  if (!filePath || !fs.existsSync(filePath)) {
    return '';
  }

  const parsed = dotenv.parse(fs.readFileSync(filePath, 'utf8'));
  return normalizeString(parsed[key]);
}

function resolveDomainUpdaterApiKeyPepper() {
  const configuredValue = normalizeString(process.env.DOMAIN_UPDATER_API_KEY_PEPPER);

  if (configuredValue && !isPlaceholderSecret(configuredValue)) {
    return {
      source: 'configured_env',
      value: configuredValue,
    };
  }

  const localDomainUpdaterEnvValue = readEnvValue(
    path.resolve(__dirname, '..', 'domainUpdater', '.env'),
    'DOMAIN_UPDATER_API_KEY_PEPPER'
  );

  if (
    localDomainUpdaterEnvValue &&
    !isPlaceholderSecret(localDomainUpdaterEnvValue)
  ) {
    return {
      source: 'domain_updater_local_env',
      value: localDomainUpdaterEnvValue,
    };
  }

  return {
    source: configuredValue
      ? 'default_fallback_placeholder_ignored'
      : 'default_fallback',
    value: DEFAULT_DOMAIN_UPDATER_API_KEY_PEPPER,
  };
}

const resolvedDomainUpdaterApiKeyPepper = resolveDomainUpdaterApiKeyPepper();

module.exports.env = {
  port: toNumber(process.env.PORT, 3000),

  // Database
  dbHost: process.env.DB_HOST,
  dbPort: toNumber(process.env.DB_PORT, 5432),
  dbUser: process.env.DB_USER,
  dbPassword: process.env.DB_PASSWORD,
  dbName: process.env.DB_NAME,

  // SMS
  smsApiKey: process.env.SMS_API_KEY,
  smsShortcode: process.env.SMS_SHORTCODE,
  smsPartnerId: process.env.SMS_PARTNER_ID,

  // Email
  mailMailer: process.env.MAIL_MAILER || 'smtp',
  mailHost: process.env.MAIL_HOST,
  mailPort: toNumber(process.env.MAIL_PORT, 587),
  mailEncryption: (process.env.MAIL_ENCRYPTION || '').toLowerCase(),
  mailUsername: process.env.MAIL_USERNAME,
  mailPassword: process.env.MAIL_PASSWORD,
  mailFromAddress: process.env.MAIL_FROM_ADDRESS,
  mailFromName: process.env.MAIL_FROM_NAME || 'Checkout API',

  // Retries
  notificationMaxAttempts: toNumber(process.env.NOTIFICATION_MAX_ATTEMPTS, 3),

  // Domain updater integration
  domainUpdaterPublicUrl:
    process.env.DOMAIN_UPDATER_PUBLIC_URL || 'http://localhost:4100/',
  domainUpdaterApiKeyPepper: resolvedDomainUpdaterApiKeyPepper.value,
  domainUpdaterApiKeyPepperSource: resolvedDomainUpdaterApiKeyPepper.source,
  domainUpdaterApiKeyTtlDays: toNumber(
    process.env.DOMAIN_UPDATER_API_KEY_TTL_DAYS,
    365
  ),
};
