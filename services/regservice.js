const pool = require('../db');
const { sendSms } = require('./sms');

exports.createRegistration = async ({ full_name, email, phone, domain_name, registrar_name }) => {
  console.log("---- NEW REGISTRATION REQUEST ----");
  console.log("Payload:", { full_name, email, phone, domain_name, registrar_name });

  // --------------------
  // 1. Idempotency check
  // --------------------
  console.log("Checking for duplicate registration...");

  const existingQuery = `
    SELECT request_id, status 
    FROM registrations 
    WHERE email=$1 AND domain_name=$2 AND status='received'
    LIMIT 1
  `;
  const existing = await pool.query(existingQuery, [email, domain_name]);

  if (existing.rows.length > 0) {
    console.log("Duplicate request detected:", existing.rows[0]);

    return {
      ...existing.rows[0],
      message: 'You have already submitted this request and it is being processed.'
    };
  }

  // --------------------
  // 2. Insert new registration
  // --------------------
  console.log("Inserting new registration into database...");

  const insertQuery = `
    INSERT INTO registrations (full_name, email, phone, domain_name, registrar_name)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING request_id, status;
  `;
  const result = await pool.query(insertQuery, [full_name, email, phone, domain_name, registrar_name]);
  const registration = result.rows[0];

  console.log("Registration saved successfully:", registration);

  // --------------------
  // 3. Send SMS acknowledgment
  // --------------------
  try {
    console.log("Sending SMS acknowledgment...");

    // Avoid double .ke
    const formattedDomain = domain_name.endsWith(".ke") ? domain_name : `${domain_name}.ke`;

    const message = `Hi ${full_name}, your request to register ${formattedDomain} with ${registrar_name} has been received and its currently being processed.`;
    const smsResponse = await sendSms(phone, message);

    console.log("SMS sent successfully:", smsResponse);

    // Update message_sent flag
    await pool.query(
      `UPDATE registrations SET message_sent=true, updated_at=NOW() WHERE request_id=$1`,
      [registration.request_id]
    );

    console.log("Database updated: message_sent = true");
  } catch (smsErr) {
    console.error("SMS sending failed:", smsErr);
  }

  console.log("---- REGISTRATION PROCESS COMPLETED ----");

  return registration;
};
