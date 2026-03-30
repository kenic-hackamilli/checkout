const { randomInt } = require('crypto');
const pool = require('../db');
const { sendSms } = require('./sms');
const { sendEmail, isEmailConfigured } = require('./email');
const { DELIVERY_STATUS, runDeliveryWithRetry } = require('./notificationService');
const {
  formatDomainName,
  normalizeRegistrationInput,
} = require('../utils/validation');

const PUBLIC_REFERENCE_DIGITS = '23456789';
const PUBLIC_REFERENCE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const PUBLIC_REFERENCE_CHARSET = `${PUBLIC_REFERENCE_LETTERS}${PUBLIC_REFERENCE_DIGITS}`;
const PUBLIC_REFERENCE_LENGTH = 10;

function buildRegistrarPayload(registration) {
  return {
    domain_name: registration.domain_name,
    email: registration.email,
    full_name: registration.full_name,
    phone: registration.phone,
  };
}

function getPublicRequestReference(registration) {
  return registration.external_request_id || registration.request_id;
}

function isExternalRequestIdConflict(error) {
  return Boolean(
    error &&
    error.code === '23505' &&
    error.constraint &&
    error.constraint.includes('external_request_id')
  );
}

function pickRandomCharacter(charset) {
  return charset[randomInt(0, charset.length)];
}

function shuffleCharacters(characters) {
  const result = [...characters];

  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(0, index + 1);
    const currentValue = result[index];
    result[index] = result[swapIndex];
    result[swapIndex] = currentValue;
  }

  return result;
}

function generateExternalRequestIdCandidate() {
  const characters = [
    pickRandomCharacter(PUBLIC_REFERENCE_LETTERS),
    pickRandomCharacter(PUBLIC_REFERENCE_DIGITS),
  ];

  while (characters.length < PUBLIC_REFERENCE_LENGTH) {
    characters.push(pickRandomCharacter(PUBLIC_REFERENCE_CHARSET));
  }

  return shuffleCharacters(characters).join('');
}

function buildUserSmsMessage(registration) {
  const formattedDomain = formatDomainName(registration.domain_name);

  return `Hi ${registration.full_name}, your request to register ${formattedDomain} with ${registration.registrar_name} has been received and is being processed.`;
}

function buildUserAcknowledgementEmail(registration) {
  const formattedDomain = formatDomainName(registration.domain_name);
  const publicRequestReference = getPublicRequestReference(registration);
  const subject = `We received your domain registration request for ${formattedDomain}`;
  const text = [
    `Hello ${registration.full_name},`,
    '',
    `We have received your request to register ${formattedDomain} with ${registration.registrar_name}.`,
    'Our team has logged the request and started the registrar workflow.',
    '',
    `Reference ID: ${publicRequestReference}`,
    '',
    `Await further communication from ${registration.registrar_name} as processing continues.`,
    '',
    'Thank you.',
  ].join('\n');

  const html = `
    <p>Hello ${registration.full_name},</p>
    <p>We have received your request to register <strong>${formattedDomain}</strong> with <strong>${registration.registrar_name}</strong>.</p>
    <p>Our team has logged the request and started the registrar workflow.</p>
    <p><strong>Reference ID:</strong> ${publicRequestReference}</p>
    <p>Await further communication from <strong>${registration.registrar_name}</strong> as processing continues.</p>
    <p>Thank you.</p>
  `;

  return { html, subject, text };
}

function buildRegistrarNotificationEmail(registration, registrar) {
  const formattedDomain = formatDomainName(registration.domain_name);
  const publicRequestReference = getPublicRequestReference(registration);
  const subject = `New domain registration request for ${formattedDomain}`;
  const text = [
    `Hello ${registrar.name},`,
    '',
    'A new domain registration request has been received.',
    '',
    `Reference ID: ${publicRequestReference}`,
    `Full Name: ${registration.full_name}`,
    `Email: ${registration.email}`,
    `Phone: ${registration.phone}`,
    `Domain: ${formattedDomain}`,
    '',
    'Please action it from your registrar workflow.',
  ].join('\n');

  const html = `
    <p>Hello ${registrar.name},</p>
    <p>A new domain registration request has been received.</p>
    <p>
      <strong>Reference ID:</strong> ${publicRequestReference}<br />
      <strong>Full Name:</strong> ${registration.full_name}<br />
      <strong>Email:</strong> ${registration.email}<br />
      <strong>Phone:</strong> ${registration.phone}<br />
      <strong>Domain:</strong> ${formattedDomain}
    </p>
    <p>Please action it from your registrar workflow.</p>
  `;

  return { html, subject, text };
}

function normalizeSettledResult(settledResult) {
  if (settledResult.status === 'fulfilled') {
    return settledResult.value;
  }

  return {
    error:
      settledResult.reason instanceof Error
        ? settledResult.reason.message
        : 'Unexpected async task failure',
    status: DELIVERY_STATUS.FAILED,
  };
}

async function findRegistrarByName(registrarName) {
  const query = `
    SELECT id, name, api_endpoint, notification_email, is_active
    FROM registrars
    WHERE LOWER(name) = LOWER($1)
    LIMIT 1
  `;
  const result = await pool.query(query, [registrarName]);
  return result.rows[0] || null;
}

async function getRegistrationById(requestId) {
  const query = `
    SELECT
      request_id,
      external_request_id,
      status,
      pushed,
      registrar_reference_id,
      full_name,
      email,
      phone,
      domain_name,
      registrar_name
    FROM registrations
    WHERE request_id = $1
  `;
  const result = await pool.query(query, [requestId]);
  return result.rows[0];
}

async function markSmsAcknowledged(requestId) {
  await pool.query(
    `
      UPDATE registrations
      SET message_sent = true,
          updated_at = NOW()
      WHERE request_id = $1
    `,
    [requestId]
  );
}

async function insertRegistrationWithExternalReference({
  full_name,
  email,
  phone,
  domain_name,
  registrar_name,
}) {
  const insertQuery = `
    INSERT INTO registrations (
      full_name,
      email,
      phone,
      domain_name,
      registrar_name,
      external_request_id
    )
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING
      request_id,
      external_request_id,
      status,
      pushed,
      registrar_reference_id,
      full_name,
      email,
      phone,
      domain_name,
      registrar_name
  `;

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const externalRequestId = generateExternalRequestIdCandidate();

    try {
      const result = await pool.query(insertQuery, [
        full_name,
        email,
        phone,
        domain_name,
        registrar_name,
        externalRequestId,
      ]);

      return result.rows[0];
    } catch (error) {
      if (isExternalRequestIdConflict(error)) {
        continue;
      }

      throw error;
    }
  }

  throw new Error('Unable to generate a unique external request reference.');
}

async function logFailedRegistrarPush(registrationId, errorMessage) {
  await pool.query(
    `
      INSERT INTO failed_requests (registration_id, error_message, attempted_at)
      VALUES ($1, $2, NOW())
    `,
    [registrationId, errorMessage]
  );
}

async function clearFailedRegistrarPushes(registrationId) {
  await pool.query(
    `
      DELETE FROM failed_requests
      WHERE registration_id = $1
    `,
    [registrationId]
  );
}

async function sendUserSmsAcknowledgement(registration) {
  const message = buildUserSmsMessage(registration);

  const result = await runDeliveryWithRetry({
    registrationId: registration.request_id,
    deliveryType: 'sms',
    recipientType: 'user',
    destination: registration.phone,
    templateKey: 'registration_ack_sms',
    payload: { message },
    handler: async () => sendSms(registration.phone, message),
  });

  if (result.status === DELIVERY_STATUS.SUCCESS) {
    await markSmsAcknowledged(registration.request_id);
  }

  return result;
}

async function sendUserEmailAcknowledgement(registration) {
  if (!registration.email || !isEmailConfigured()) {
    return {
      attempts: 0,
      status: DELIVERY_STATUS.SKIPPED,
    };
  }

  const emailContent = buildUserAcknowledgementEmail(registration);

  return runDeliveryWithRetry({
    registrationId: registration.request_id,
    deliveryType: 'email',
    recipientType: 'user',
    destination: registration.email,
    templateKey: 'registration_ack_email',
    subject: emailContent.subject,
    payload: { subject: emailContent.subject },
    handler: async () =>
      sendEmail({
        to: registration.email,
        ...emailContent,
      }),
  });
}

async function sendRegistrarEmailNotification(registration, registrar) {
  if (!registrar || !registrar.notification_email || !isEmailConfigured()) {
    return {
      attempts: 0,
      status: DELIVERY_STATUS.SKIPPED,
    };
  }

  const emailContent = buildRegistrarNotificationEmail(registration, registrar);

  return runDeliveryWithRetry({
    registrationId: registration.request_id,
    deliveryType: 'email',
    recipientType: 'registrar',
    destination: registrar.notification_email,
    templateKey: 'registrar_registration_email',
    subject: emailContent.subject,
    payload: {
      registrar_name: registrar.name,
      subject: emailContent.subject,
    },
    handler: async () =>
      sendEmail({
        to: registrar.notification_email,
        ...emailContent,
      }),
  });
}

async function pushToRegistrar(registration, registrar, options = {}) {
  const { forceRetry = false } = options;

  if (!registrar || !registrar.is_active) {
    return {
      attempts: 0,
      status: DELIVERY_STATUS.SKIPPED,
    };
  }

  if (!registrar.api_endpoint) {
    return {
      attempts: 0,
      status: DELIVERY_STATUS.SKIPPED,
    };
  }

  const payload = buildRegistrarPayload(registration);

  const result = await runDeliveryWithRetry({
    registrationId: registration.request_id,
    deliveryType: 'registrar_api',
    recipientType: 'registrar',
    destination: registrar.api_endpoint,
    templateKey: 'registration_push',
    payload,
    forceRetry,
    handler: async () => {
      const response = await fetch(registrar.api_endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const responseText = await response.text();

      if (!response.ok) {
        throw new Error(
          `Registrar API responded with status ${response.status}: ${responseText}`
        );
      }

      let data = null;

      try {
        data = responseText ? JSON.parse(responseText) : null;
      } catch (error) {
        data = { raw: responseText };
      }

      const referenceId =
        data && (data.reference_id || data.referenceId)
          ? data.reference_id || data.referenceId
          : null;

      await pool.query(
        `
          UPDATE registrations
          SET pushed = true,
              registrar_reference_id = $1,
              updated_at = NOW()
          WHERE request_id = $2
        `,
        [referenceId, registration.request_id]
      );

      await clearFailedRegistrarPushes(registration.request_id);

      return {
        providerReference: referenceId,
        response: data || responseText || 'OK',
      };
    },
  });

  if (result.status === DELIVERY_STATUS.FAILED) {
    await logFailedRegistrarPush(registration.request_id, result.error);
  }

  return result;
}

async function retryRegistrarPushByRegistrationId(requestId) {
  const registration = await getRegistrationById(requestId);

  if (!registration) {
    throw new Error(`Registration ${requestId} was not found.`);
  }

  const registrar = await findRegistrarByName(registration.registrar_name);
  const pushResult = await pushToRegistrar(registration, registrar, {
    forceRetry: true,
  });

  return {
    registration_id: requestId,
    ...pushResult,
  };
}

exports.createRegistration = async (payload) => {
  const { full_name, email, phone, domain_name, registrar_name } =
    normalizeRegistrationInput(payload);

  console.log('---- NEW REGISTRATION REQUEST ----');
  console.log('Processing registration request:', {
    domain_name,
    registrar_name,
  });

  const existingQuery = `
    SELECT request_id, external_request_id, status, pushed, registrar_reference_id
    FROM registrations
    WHERE email = $1 AND domain_name = $2 AND status = 'received'
    LIMIT 1
  `;
  const existing = await pool.query(existingQuery, [email, domain_name]);

  if (existing.rows.length > 0) {
    return {
      ...existing.rows[0],
      push_status: existing.rows[0].pushed ? DELIVERY_STATUS.SUCCESS : DELIVERY_STATUS.PENDING,
      message: 'You have already submitted this request and it is being processed.',
    };
  }

  const registration = await insertRegistrationWithExternalReference({
    full_name,
    email,
    phone,
    domain_name,
    registrar_name,
  });

  const registrar = await findRegistrarByName(registrar_name);

  const settledResults = await Promise.allSettled([
    sendUserSmsAcknowledgement(registration),
    sendUserEmailAcknowledgement(registration),
    sendRegistrarEmailNotification(registration, registrar),
    pushToRegistrar(registration, registrar),
  ]);

  const [, , , pushResult] = settledResults.map(normalizeSettledResult);
  const finalRegistration = await getRegistrationById(registration.request_id);

  console.log('---- REGISTRATION PROCESS COMPLETED ----');

  return {
    ...finalRegistration,
    push_status: pushResult.status || DELIVERY_STATUS.SKIPPED,
  };
};

exports.retryFailedPushes = async () => {
  console.log('---- RETRYING FAILED PUSHES ----');

  const failed = await pool.query(`
    SELECT DISTINCT ON (registration_id)
      id,
      registration_id,
      attempted_at
    FROM failed_requests
    ORDER BY registration_id, attempted_at DESC
  `);

  let retried = 0;
  let succeeded = 0;

  for (const failedRequest of failed.rows) {
    const registration = await getRegistrationById(failedRequest.registration_id);

    if (!registration) {
      continue;
    }

    const pushResult = await retryRegistrarPushByRegistrationId(
      failedRequest.registration_id
    );
    retried += 1;

    if (pushResult.status === DELIVERY_STATUS.SUCCESS) {
      succeeded += 1;
    }
  }

  console.log('---- FAILED PUSH RETRIES COMPLETED ----');

  return {
    retried,
    succeeded,
  };
};

exports.retryFailedPushByRegistrationId = retryRegistrarPushByRegistrationId;
