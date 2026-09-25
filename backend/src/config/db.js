const knex = require('knex');
const environment = process.env.NODE_ENV || 'development';
const config = require('../../knexfile')[environment];

// knexfile's credentials belong to the schema owner (used for migrations).
// At runtime the API connects as a restricted role instead when one is
// configured - see scripts/setup-db-roles.js. That role can't UPDATE, DELETE
// or TRUNCATE audit_logs, so a compromised or buggy API can't rewrite history.
const appUser = process.env.DB_APP_USER;
const runtimeConfig = appUser
  ? {
      ...config,
      connection: { ...config.connection, user: appUser, password: process.env.DB_APP_PASSWORD },
    }
  : config;

if (!appUser && environment === 'production') {
  console.warn('DB_APP_USER is not set - the API is connecting as the schema owner, so audit logs are not tamper-protected.');
}

const db = knex(runtimeConfig);

module.exports = db;
