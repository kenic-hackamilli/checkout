require('dotenv').config();

function toNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

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
  notificationMaxAttempts: toNumber(process.env.NOTIFICATION_MAX_ATTEMPTS, 3)
};
