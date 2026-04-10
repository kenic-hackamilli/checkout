const { env } = require('../config/env');

/**
 * Send SMS using TextSMS API
 * @param {string} to - Recipient phone number in format 2547XXXXXXXX
 * @param {string} message - Message to send
 * @returns {Promise<{ response: string, status: number }>} - API response
 */
async function sendSms(to, message) {
  if (!env.smsApiKey || !env.smsShortcode || !env.smsPartnerId) {
    throw new Error('SMS service is not fully configured.');
  }

  try {
    const payload = {
      apikey: env.smsApiKey,
      shortcode: env.smsShortcode,
      partnerID: env.smsPartnerId,
      mobile: to,
      message,
    };

    const response = await fetch(
      'https://sms.textsms.co.ke/api/services/sendsms/',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      }
    );

    const data = await response.text();

    if (!response.ok) {
      throw new Error(`SMS API responded with status ${response.status}: ${data}`);
    }

    return {
      providerStatusCode: response.status,
      response: data,
      status: response.status,
    };
  } catch (error) {
    console.error('Error sending SMS:', error.message);
    throw new Error(`SMS sending failed: ${error.message}`);
  }
}

module.exports = { sendSms };
