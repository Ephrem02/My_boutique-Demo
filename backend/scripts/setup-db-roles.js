// Creates/updates the restricted PostgreSQL role the API runs as at runtime
// (DB_APP_USER), and (re)applies its grants. Run as the schema owner after
// every migration - `npm run migrate` does this automatically.
//
// The runtime role gets SELECT/INSERT/UPDATE/DELETE on application tables,
// but only SELECT/INSERT on the append-only history tables (audit_logs,
// daily_closings, closing_adjustments) and nothing on the migration tables,
// so the API itself can never rewrite history or the schema.
//
// Usage: node scripts/setup-db-roles.js   (NODE_ENV picks the database)
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
const knex = require('knex');

const IDENTIFIER = /^[a-z_][a-z0-9_]{0,62}$/;

async function setupDbRoles({ environment = process.env.NODE_ENV || 'development', log = console.log } = {}) {
  const appUser = process.env.DB_APP_USER;
  const appPassword = process.env.DB_APP_PASSWORD;
  if (!appUser) {
    log('DB_APP_USER not set - skipping runtime role setup (API will connect as the schema owner).');
    return false;
  }
  if (!IDENTIFIER.test(appUser)) throw new Error('DB_APP_USER must be a plain lowercase identifier');
  if (!appPassword || appPassword.length < 16) throw new Error('DB_APP_PASSWORD must be set (16+ chars)');

  const config = require('../knexfile')[environment];
  const database = config.connection.database;
  if (!IDENTIFIER.test(database)) throw new Error(`Unexpected database name: ${database}`);

  // Owner connection - deliberately not src/config/db.js, which uses the app role.
  const owner = knex(config);
  const literal = (s) => `'${String(s).replace(/'/g, "''")}'`;
  try {
    const exists = await owner('pg_roles').where({ rolname: appUser }).first();
    const verb = exists ? 'ALTER' : 'CREATE';
    await owner.raw(
      `${verb} ROLE ${appUser} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD ${literal(appPassword)}`
    );

    await owner.raw(`GRANT CONNECT ON DATABASE ${database} TO ${appUser}`);
    await owner.raw(`GRANT USAGE ON SCHEMA public TO ${appUser}`);
    await owner.raw(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${appUser}`);
    await owner.raw(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${appUser}`);

    await owner.raw(`REVOKE ALL ON knex_migrations, knex_migrations_lock FROM ${appUser}`);
    // Append-only history tables: read and add, never change or remove.
    for (const table of ['audit_logs', 'daily_closings', 'closing_adjustments']) {
      if (await owner.schema.hasTable(table)) {
        await owner.raw(`REVOKE ALL ON ${table} FROM ${appUser}`);
        await owner.raw(`GRANT SELECT, INSERT ON ${table} TO ${appUser}`);
      }
    }
    log(`Runtime role "${appUser}" ${exists ? 'updated' : 'created'} on database "${database}".`);
    return true;
  } finally {
    await owner.destroy();
  }
}

module.exports = { setupDbRoles };

if (require.main === module) {
  setupDbRoles().catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  });
}
