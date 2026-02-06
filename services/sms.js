import { env } from "../config/env.js";

/**
 * Send SMS using TextSMS API
 * @param {string} to - Recipient phone number in format 2547XXXXXXXX
 * @param {string} message - Message to send
 * @returns {Promise<string>} - API response
 */
export async function sendSms(to, message) {
  try {
    const payload = {
      apikey: env.smsApiKey,
      shortcode: env.smsShortcode,
      partnerID: env.smsPartnerId,
      mobile: to,
      message,
    };

    const response = await fetch(
      "https://sms.textsms.co.ke/api/services/sendsms/",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      }
    );

    // TextSMS sometimes returns plain text, not JSON
    const data = await response.text();
    return data;
  } catch (error) {
    console.error("Error sending SMS:", error);
    throw new Error("SMS sending failed");
  }
}
