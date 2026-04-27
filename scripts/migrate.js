const fs = require('fs');
const path = require('path');
const pool = require('../db');
const {
  findRegistrarIdentityConflicts,
  formatRegistrarIdentityConflicts,
} = require('./lib/registrarIdentityConflicts');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');

async function ensureMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version VARCHAR(255) PRIMARY KEY,
      applied_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

function getMigrationFiles() {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((fileName) => fileName.endsWith('.sql'))
    .sort();
}

async function getAppliedMigrations(client) {
  const result = await client.query('SELECT version FROM schema_migrations');
  return new Set(result.rows.map((row) => row.version));
}

function isRegistrarIdentityGuardrailsFailure(fileName, error) {
  if (fileName !== '018_registrar_identity_guardrails.sql') {
    return false;
  }

  return /idx_registrars_(name|primary_email|notification_email|primary_phone)_unique/i.test(
    String(error?.message || '')
  );
}

async function runPendingMigrations() {
  const client = await pool.connect();
  let transactionStarted = false;
  let currentMigrationFile = null;

  try {
    await ensureMigrationsTable(client);

    const migrationFiles = getMigrationFiles();
    const appliedMigrations = await getAppliedMigrations(client);

    for (const fileName of migrationFiles) {
      if (appliedMigrations.has(fileName)) {
        continue;
      }

      const migrationPath = path.join(MIGRATIONS_DIR, fileName);
      const sql = fs.readFileSync(migrationPath, 'utf8');
      currentMigrationFile = fileName;

      console.log(`Applying migration ${fileName}...`);
      await client.query('BEGIN');
      transactionStarted = true;
      await client.query(sql);
      await client.query(
        'INSERT INTO schema_migrations (version) VALUES ($1)',
        [fileName]
      );
      await client.query('COMMIT');
      transactionStarted = false;
      console.log(`Applied migration ${fileName}`);
    }
  } catch (error) {
    if (transactionStarted) {
      await client.query('ROLLBACK');
      transactionStarted = false;
    }

    if (isRegistrarIdentityGuardrailsFailure(currentMigrationFile, error)) {
      const conflicts = await findRegistrarIdentityConflicts(client);

      if (conflicts.length > 0) {
        console.error(
          'Registrar identity conflicts are blocking migration 018:'
        );
        console.error(formatRegistrarIdentityConflicts(conflicts));
        console.error(
          'Resolve the duplicate registrar values above, then re-run `npm run migrate`.'
        );
        console.error(
          'You can re-check the current state anytime with `npm run registrars:identity-check`.'
        );
      }
    }
    throw error;
  } finally {
    client.release();
  }
}

if (require.main === module) {
  runPendingMigrations()
    .then(() => {
      console.log('Database migrations completed successfully.');
      return pool.end();
    })
    .catch(async (error) => {
      console.error('Database migration failed:', error.stack || error);
      await pool.end();
      process.exit(1);
    });
}

module.exports = {
  runPendingMigrations,
};
