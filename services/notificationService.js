const pool = require('../db');
const { env } = require('../config/env');

const DELIVERY_STATUS = Object.freeze({
  FAILED: 'failed',
  PENDING: 'pending',
  SKIPPED: 'skipped',
  SUCCESS: 'success',
});

const RETRY_DELAYS_MS = [250, 750, 1500];

function serializeDetails(value) {
  if (value == null) {
    return null;
  }

  if (typeof value === 'string') {
    return value;
  }

  return JSON.stringify(value);
}

function sleep(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

async function upsertDeliveryLog({
  registrationId,
  deliveryType,
  recipientType,
  destination,
  templateKey,
  subject,
  payload,
  maxAttempts,
}) {
  const query = `
    INSERT INTO delivery_logs (
      registration_id,
      delivery_type,
      recipient_type,
      destination,
      template_key,
      subject,
      payload,
      max_attempts,
      status
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)
    ON CONFLICT (registration_id, delivery_type, recipient_type, template_key)
    DO UPDATE
      SET destination = EXCLUDED.destination,
          subject = EXCLUDED.subject,
          payload = EXCLUDED.payload,
          max_attempts = EXCLUDED.max_attempts,
          updated_at = CURRENT_TIMESTAMP
    RETURNING *;
  `;

  const result = await pool.query(query, [
    registrationId,
    deliveryType,
    recipientType,
    destination,
    templateKey,
    subject || null,
    JSON.stringify(payload || {}),
    maxAttempts,
    DELIVERY_STATUS.PENDING,
  ]);

  return result.rows[0];
}

async function appendDeliveryAttempt({
  deliveryLogId,
  attemptNumber,
  status,
  responseMessage,
  errorMessage,
}) {
  const query = `
    INSERT INTO delivery_attempt_logs (
      delivery_log_id,
      attempt_number,
      status,
      response_message,
      error_message
    )
    VALUES ($1, $2, $3, $4, $5);
  `;

  await pool.query(query, [
    deliveryLogId,
    attemptNumber,
    status,
    responseMessage,
    errorMessage,
  ]);
}

async function updateDeliveryLog({
  deliveryLogId,
  attempts,
  status,
  responseMessage,
  errorMessage,
  providerReference,
}) {
  const query = `
    UPDATE delivery_logs
    SET attempts = $2,
        status = $3,
        last_response = $4,
        last_error = CASE
          WHEN $3 = 'success' OR $3 = 'skipped' THEN NULL
          ELSE $5
        END,
        provider_reference = COALESCE($6, provider_reference),
        first_attempted_at = COALESCE(first_attempted_at, CURRENT_TIMESTAMP),
        last_attempted_at = CURRENT_TIMESTAMP,
        delivered_at = CASE
          WHEN $3 = 'success' THEN CURRENT_TIMESTAMP
          ELSE delivered_at
        END,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = $1;
  `;

  await pool.query(query, [
    deliveryLogId,
    attempts,
    status,
    responseMessage,
    errorMessage,
    providerReference,
  ]);
}

async function runDeliveryWithRetry({
  registrationId,
  deliveryType,
  recipientType,
  destination,
  templateKey,
  subject,
  payload,
  handler,
  maxAttempts = env.notificationMaxAttempts,
  forceRetry = false,
}) {
  if (!destination) {
    return {
      attempts: 0,
      status: DELIVERY_STATUS.SKIPPED,
    };
  }

  const deliveryLog = await upsertDeliveryLog({
    registrationId,
    deliveryType,
    recipientType,
    destination,
    templateKey,
    subject,
    payload,
    maxAttempts,
  });

  const effectiveMaxAttempts = forceRetry
    ? Math.max(deliveryLog.max_attempts, deliveryLog.attempts + maxAttempts)
    : maxAttempts;

  if (forceRetry && deliveryLog.max_attempts !== effectiveMaxAttempts) {
    await pool.query(
      `
        UPDATE delivery_logs
        SET max_attempts = $2,
            status = 'pending',
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
      `,
      [deliveryLog.id, effectiveMaxAttempts]
    );
    deliveryLog.max_attempts = effectiveMaxAttempts;
  }

  if (deliveryLog.status === DELIVERY_STATUS.SUCCESS) {
    return {
      attempts: deliveryLog.attempts,
      status: DELIVERY_STATUS.SUCCESS,
    };
  }

  if (
    !forceRetry &&
    deliveryLog.status === DELIVERY_STATUS.FAILED &&
    deliveryLog.attempts >= maxAttempts
  ) {
    return {
      attempts: deliveryLog.attempts,
      error: deliveryLog.last_error,
      status: DELIVERY_STATUS.FAILED,
    };
  }

  let lastErrorMessage = null;

  for (
    let attemptNumber = deliveryLog.attempts + 1;
    attemptNumber <= effectiveMaxAttempts;
    attemptNumber += 1
  ) {
    try {
      const result = await handler({ attemptNumber, deliveryLogId: deliveryLog.id });
      const responseMessage = serializeDetails(result && (result.response || result));
      const providerReference =
        result &&
        (result.providerReference ||
          result.messageId ||
          result.referenceId ||
          null);

      await appendDeliveryAttempt({
        deliveryLogId: deliveryLog.id,
        attemptNumber,
        status: DELIVERY_STATUS.SUCCESS,
        responseMessage,
        errorMessage: null,
      });

      await updateDeliveryLog({
        deliveryLogId: deliveryLog.id,
        attempts: attemptNumber,
        status: DELIVERY_STATUS.SUCCESS,
        responseMessage,
        errorMessage: null,
        providerReference,
      });

      return {
        attempts: attemptNumber,
        providerReference,
        response: result,
        status: DELIVERY_STATUS.SUCCESS,
      };
    } catch (error) {
      lastErrorMessage = error.message || 'Unexpected delivery error';
      const nextStatus =
        attemptNumber === maxAttempts
          ? DELIVERY_STATUS.FAILED
          : DELIVERY_STATUS.PENDING;

      await appendDeliveryAttempt({
        deliveryLogId: deliveryLog.id,
        attemptNumber,
        status: DELIVERY_STATUS.FAILED,
        responseMessage: null,
        errorMessage: lastErrorMessage,
      });

      await updateDeliveryLog({
        deliveryLogId: deliveryLog.id,
        attempts: attemptNumber,
        status: nextStatus,
        responseMessage: null,
        errorMessage: lastErrorMessage,
        providerReference: null,
      });

      if (nextStatus === DELIVERY_STATUS.FAILED) {
        return {
          attempts: attemptNumber,
          error: lastErrorMessage,
          status: DELIVERY_STATUS.FAILED,
        };
      }

      const delay =
        RETRY_DELAYS_MS[attemptNumber - 1] ||
        RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1];

      await sleep(delay);
    }
  }

  return {
    attempts: effectiveMaxAttempts,
    error: lastErrorMessage,
    status: DELIVERY_STATUS.FAILED,
  };
}

module.exports = {
  DELIVERY_STATUS,
  runDeliveryWithRetry,
};
