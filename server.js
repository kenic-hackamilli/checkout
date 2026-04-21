const express = require('express');
const { env } = require('./config/env');
const checkoutRoutes = require('./routes/checkout');
const {
  buildDatabaseTarget,
  createShortFingerprint,
  writeDiagnosticLog,
} = require('./utils/diagnostics');

const app = express();
app.use(express.json());

// Routes
app.use('/checkout', checkoutRoutes);

// Basic health check
app.get('/', (req, res) => res.send('Checkout API is running'));

const PORT = env.port || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  writeDiagnosticLog('checkout-api', 'info', 'domain_updater.integration.ready', {
    apiKeyPepperFingerprint: createShortFingerprint(env.domainUpdaterApiKeyPepper),
    databaseTarget: buildDatabaseTarget({
      database: env.dbName,
      host: env.dbHost,
      port: env.dbPort,
    }),
    domainUpdaterPublicUrl: env.domainUpdaterPublicUrl,
    port: PORT,
  });
});

module.exports = app;
