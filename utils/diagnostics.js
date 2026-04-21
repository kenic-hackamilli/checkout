const { createHash } = require('crypto');

function normalizeString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function createShortFingerprint(value) {
  return createHash('sha256')
    .update(String(value || ''))
    .digest('hex')
    .slice(0, 12);
}

function truncateString(value, maxLength = 180) {
  const normalized = normalizeString(value);

  if (!normalized) {
    return null;
  }

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(0, maxLength - 3))}...`;
}

function buildApiKeySummary(value) {
  const normalized = normalizeString(value);

  return {
    length: normalized.length || 0,
    prefix: normalized ? normalized.slice(0, 12) : null,
    present: Boolean(normalized),
  };
}

function buildDatabaseTarget({
  connectionString = null,
  host = null,
  port = null,
  database = null,
} = {}) {
  const normalizedConnectionString = normalizeString(connectionString);

  if (normalizedConnectionString) {
    try {
      const parsed = new URL(normalizedConnectionString);

      return {
        database: normalizeString(parsed.pathname).replace(/^\/+/, '') || null,
        host: parsed.hostname || null,
        port: parsed.port ? Number(parsed.port) : null,
        source: 'connection_string',
      };
    } catch (_error) {
      return {
        database: null,
        host: null,
        port: null,
        source: 'connection_string_unparseable',
      };
    }
  }

  return {
    database: normalizeString(database) || null,
    host: normalizeString(host) || null,
    port: Number.isFinite(Number(port)) ? Number(port) : null,
    source: 'field_config',
  };
}

function writeDiagnosticLog(service, level, event, details = {}) {
  const payload = {
    details,
    event,
    level,
    service,
    timestamp: new Date().toISOString(),
  };

  const writer =
    level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;

  writer(JSON.stringify(payload));
}

module.exports = {
  buildApiKeySummary,
  buildDatabaseTarget,
  createShortFingerprint,
  truncateString,
  writeDiagnosticLog,
};
