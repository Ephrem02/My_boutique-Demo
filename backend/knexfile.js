require('dotenv').config();

const base = {
  client: 'pg',
  connection: {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 5432,
    database: process.env.DB_NAME || 'shop_management',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
  },
  migrations: {
    directory: './src/migrations',
    tableName: 'knex_migrations',
  },
  seeds: {
    directory: './src/seeds',
  },
  pool: { min: 2, max: 10 },
};

// Verifies the DB server's TLS certificate by default (protects against MITM
// on the DB connection). If the provider uses a CA not in the default trust
// store, pass its cert via DB_SSL_CA rather than disabling verification.
const productionSsl = process.env.DB_SSL_CA
  ? { ca: process.env.DB_SSL_CA, rejectUnauthorized: true }
  : { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false' };

// Tests truncate tables between runs, so the test environment refuses to point
// at anything that isn't clearly a throwaway test database.
const testDatabase = process.env.DB_NAME_TEST || 'shop_management_test';
if (process.env.NODE_ENV === 'test' && !testDatabase.endsWith('_test')) {
  throw new Error(`Refusing to run tests against "${testDatabase}" - DB_NAME_TEST must end in _test`);
}

module.exports = {
  development: base,
  test: {
    ...base,
    connection: { ...base.connection, database: testDatabase },
    pool: { min: 1, max: 10 },
  },
  production: {
    ...base,
    connection: {
      ...base.connection,
      ssl: productionSsl,
    },
  },
};
