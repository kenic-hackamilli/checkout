const { Pool } = require('pg');
const { env } = require('./config/env');

const pool = new Pool({
  host: env.dbHost || 'localhost',
  user: env.dbUser || 'postgres',
  password: env.dbPassword || 'your_password',
  database: env.dbName || 'domain_registry',
  port: env.dbPort || 5432,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (error) => {
  console.error('Unexpected idle PostgreSQL client error:', error.message);
});

module.exports = pool;
