// Creates the test database if needed and rebuilds its schema from scratch
// with the real migrations, then applies the runtime role grants - so tests
// run as the same restricted role the API uses in production.
const path = require('path');
const knex = require('knex');

module.exports = async () => {
  process.env.NODE_ENV = 'test';
  require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
  const config = require('../knexfile').test;
  const database = config.connection.database;

  const admin = knex({ ...config, connection: { ...config.connection, database: 'postgres' } });
  try {
    const exists = await admin('pg_database').where({ datname: database }).first();
    if (!exists) await admin.raw(`CREATE DATABASE ${database}`);
  } finally {
    await admin.destroy();
  }

  const owner = knex(config);
  try {
    await owner.migrate.rollback({}, true);
    await owner.migrate.latest();
  } finally {
    await owner.destroy();
  }
  await require('../scripts/setup-db-roles').setupDbRoles({ environment: 'test', log: () => {} });
};
