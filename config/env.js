require('dotenv').config();

module.exports.env = {
  port: process.env.PORT || 3000,

  // Database
  dbHost: process.env.DB_HOST,
  dbPort: process.env.DB_PORT,
  dbUser: process.env.DB_USER,
  dbPassword: process.env.DB_PASSWORD,
  dbName: process.env.DB_NAME,

  // SMS
  smsApiKey: process.env.SMS_API_KEY,
  smsShortcode: process.env.SMS_SHORTCODE,
  smsPartnerId: process.env.SMS_PARTNER_ID
};
