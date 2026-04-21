const { createHmac, randomBytes } = require('crypto');
const { env } = require('../config/env');
const {
  createShortFingerprint,
  writeDiagnosticLog,
} = require('../utils/diagnostics');

const API_KEY_PREFIX = 'dkc-';
const API_KEY_SECRET_CHARSET =
  'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
const API_KEY_SECRET_LENGTH = 20;

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function buildPortalKeyLabel(label) {
  return normalizeString(label) || 'Primary Portal Key';
}

function buildApiKeyExpiryDate(ttlDays = env.domainUpdaterApiKeyTtlDays) {
  const normalizedTtlDays = Number(ttlDays);

  if (!Number.isFinite(normalizedTtlDays) || normalizedTtlDays <= 0) {
    return null;
  }

  return new Date(Date.now() + normalizedTtlDays * 24 * 60 * 60 * 1000);
}

function hashWithPepper(value, pepper) {
  return createHmac('sha256', String(pepper || ''))
    .update(String(value || ''))
    .digest('hex');
}

function generateFromCharset(length, charset) {
  let output = '';

  while (output.length < length) {
    const bytes = randomBytes(length * 2);

    for (const byte of bytes) {
      output += charset[byte % charset.length];

      if (output.length === length) {
        break;
      }
    }
  }

  return output;
}

function generateApiKey() {
  const secret = generateFromCharset(
    API_KEY_SECRET_LENGTH,
    API_KEY_SECRET_CHARSET
  );
  const key = `${API_KEY_PREFIX}${secret}`;

  return {
    key,
    prefix: key.slice(0, 12),
  };
}

async function writeAuditEvent(client, payload = {}) {
  await client.query(
    `
      INSERT INTO domain_updater.audit_events (
        registrar_id,
        actor_type,
        actor_id,
        action,
        entity_type,
        entity_id,
        before_json,
        after_json,
        metadata_json
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb)
    `,
    [
      payload.registrarId || null,
      payload.actorType,
      payload.actorId || null,
      payload.action,
      payload.entityType,
      payload.entityId || null,
      JSON.stringify(payload.before || {}),
      JSON.stringify(payload.after || {}),
      JSON.stringify(payload.metadata || {}),
    ]
  );
}

async function revokeRegistrarActiveApiKeys(
  client,
  {
    actorId = null,
    actorType = 'system',
    reason = 'rotation',
    registrarId,
  } = {}
) {
  const revokeResult = await client.query(
    `
      UPDATE domain_updater.registrar_api_keys
      SET status = 'revoked',
          revoked_at = CURRENT_TIMESTAMP,
          revoked_by_actor_type = $2,
          revoked_by_actor_id = $3
      WHERE registrar_id = $1
        AND status = 'active'
      RETURNING id, key_prefix
    `,
    [registrarId, actorType, actorId]
  );

  for (const row of revokeResult.rows) {
    await writeAuditEvent(client, {
      registrarId,
      actorType,
      actorId,
      action: 'credential.api_key.revoked',
      entityType: 'registrar_api_key',
      entityId: row.id,
      metadata: {
        key_prefix: row.key_prefix,
        reason,
      },
    });
  }

  return revokeResult.rows.length;
}

async function createPrimaryRegistrarApiKey(client, registrar, options = {}) {
  if (!registrar || !registrar.id) {
    throw new Error('Registrar context is required to issue an API key.');
  }

  const actorType = normalizeString(options.actorType) || 'system';
  const actorId = normalizeString(options.actorId) || null;
  const revokeExisting = options.revokeExisting !== false;
  const keyLabel = buildPortalKeyLabel(options.keyLabel);
  const expiresAt = options.expiresAt || buildApiKeyExpiryDate(options.ttlDays);
  let rotatedCount = 0;

  if (revokeExisting) {
    rotatedCount = await revokeRegistrarActiveApiKeys(client, {
      actorId,
      actorType,
      reason: options.rotationReason || 'rotation',
      registrarId: registrar.id,
    });
  }

  const generatedKey = generateApiKey();
  const keyHash = hashWithPepper(generatedKey.key, env.domainUpdaterApiKeyPepper);
  const insertResult = await client.query(
    `
      INSERT INTO domain_updater.registrar_api_keys (
        registrar_id,
        key_label,
        key_prefix,
        key_hash,
        status,
        expires_at,
        created_by_actor_type,
        created_by_actor_id
      )
      VALUES ($1, $2, $3, $4, 'active', $5, $6, $7)
      RETURNING id, created_at, expires_at
    `,
    [
      registrar.id,
      keyLabel,
      generatedKey.prefix,
      keyHash,
      expiresAt,
      actorType,
      actorId,
    ]
  );

  await writeAuditEvent(client, {
    registrarId: registrar.id,
    actorType,
    actorId,
    action: 'credential.api_key.created',
    entityType: 'registrar_api_key',
    entityId: insertResult.rows[0].id,
    metadata: {
      expires_at: insertResult.rows[0].expires_at,
      key_label: keyLabel,
      key_prefix: generatedKey.prefix,
      rotated_existing_key_count: rotatedCount,
    },
  });

  writeDiagnosticLog('checkout-api', 'info', 'domain_updater.api_key.issued', {
    actorId,
    actorType,
    apiKeyPepperFingerprint: createShortFingerprint(env.domainUpdaterApiKeyPepper),
    apiKeyPepperSource: env.domainUpdaterApiKeyPepperSource,
    expiresAt: insertResult.rows[0].expires_at,
    keyId: insertResult.rows[0].id,
    keyLabel,
    keyPrefix: generatedKey.prefix,
    registrarCode: registrar.registrar_code || null,
    registrarId: registrar.id,
    registrarName: registrar.name || null,
    rotatedExistingKeyCount: rotatedCount,
  });

  return {
    apiKey: generatedKey.key,
    createdAt: insertResult.rows[0].created_at,
    expiresAt: insertResult.rows[0].expires_at,
    keyId: insertResult.rows[0].id,
    keyLabel,
    keyPrefix: generatedKey.prefix,
    registrar: {
      id: registrar.id,
      name: registrar.name,
      primaryEmail: registrar.primary_email || null,
      registrarCode: registrar.registrar_code || null,
    },
    rotatedCount,
  };
}

module.exports = {
  buildApiKeyExpiryDate,
  buildPortalKeyLabel,
  createPrimaryRegistrarApiKey,
};
