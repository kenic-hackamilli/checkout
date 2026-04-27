const pool = require('../db');
const {
  findRegistrarIdentityConflicts,
  formatRegistrarIdentityConflicts,
} = require('./lib/registrarIdentityConflicts');

async function run() {
  const client = await pool.connect();

  try {
    const conflicts = await findRegistrarIdentityConflicts(client);

    if (!conflicts.length) {
      console.log('No registrar identity conflicts found.');
      return;
    }

    console.error('Registrar identity conflicts found:');
    console.error(formatRegistrarIdentityConflicts(conflicts));
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch(async (error) => {
  console.error(
    'Unable to inspect registrar identity conflicts:',
    error.stack || error
  );
  try {
    await pool.end();
  } catch {}
  process.exit(1);
});
