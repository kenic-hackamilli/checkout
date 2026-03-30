const pool = require('../db');
const registrationService = require('../services/registrationService');

async function run() {
  const summary = await registrationService.retryFailedPushes();
  console.log(
    `Registrar push retry completed. Retried: ${summary.retried}, succeeded: ${summary.succeeded}`
  );
}

run()
  .then(() => pool.end())
  .catch(async (error) => {
    console.error('Registrar push retry failed:', error.message);
    await pool.end();
    process.exit(1);
  });
