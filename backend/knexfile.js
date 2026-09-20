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

module.exports = {
  development: base,
  production: {
    ...base,
    connection: {
      ...base.connection,
      ssl: { rejectUnauthorized: false },
    },
  },
};
