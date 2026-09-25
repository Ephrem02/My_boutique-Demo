// Test fixtures. The owner connection is used only for resetting and
// seeding; the app under test uses its normal (restricted) connection.
const knex = require('knex');
const bcrypt = require('bcrypt');
const request = require('supertest');
const { PERMISSIONS, ROLE_PERMISSIONS } = require('../src/seeds/01_roles_permissions');

let owner = null;
function ownerDb() {
  if (!owner) owner = knex(require('../knexfile').test);
  return owner;
}
async function closeOwner() {
  if (owner) await owner.destroy();
  owner = null;
}

const PASSWORD = 'correct-horse-battery';

/**
 * Waits until the app's own connections are idle, so fire-and-forget work
 * from the previous test (e.g. access-denied audits) can't collide with the
 * TRUNCATE below.
 */
async function waitForAppIdle(timeoutMs = 5000) {
  const db = ownerDb();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { rows } = await db.raw(
      "SELECT count(*)::int AS busy FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid() AND state NOT IN ('idle') AND query NOT ILIKE 'LISTEN%'"
    );
    if (rows[0].busy === 0) return;
    await new Promise((r) => setTimeout(r, 50));
  }
}

/** Wipes every table (audit_logs included - triggers are bypassed in replica mode) and reseeds roles. */
async function resetDb({ openDay = true } = {}, attempt = 1) {
  await waitForAppIdle();
  try {
    await wipeAndSeed();
  } catch (err) {
    if (err.code === '40P01' && attempt < 4) return resetDb({ openDay }, attempt + 1); // deadlock with straggling work
    throw err;
  }
  // Selling needs an OPEN business day; most suites just want one to exist.
  if (openDay) await openBusinessDay();
}

/** Inserts an OPEN business day directly (bypasses the API/audit - fixture only). */
async function openBusinessDay({ date, openingFloat = 0, openedBy = null } = {}) {
  const businessDate = date || new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Kigali' }).format(new Date());
  const [day] = await ownerDb()('business_days')
    .insert({ business_date: businessDate, status: 'open', opening_float: openingFloat, opened_by: openedBy })
    .returning('*');
  return day;
}

async function wipeAndSeed() {
  const db = ownerDb();
  const tables = (await db.raw(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT LIKE 'knex_migrations%'"
  )).rows.map((r) => `"${r.tablename}"`);
  await db.transaction(async (trx) => {
    await trx.raw('SET LOCAL session_replication_role = replica');
    await trx.raw(`TRUNCATE ${tables.join(', ')} RESTART IDENTITY CASCADE`);
  });

  const roles = await db('roles').insert(Object.keys(ROLE_PERMISSIONS).map((name) => ({ name }))).returning(['id', 'name']);
  const perms = await db('permissions').insert(PERMISSIONS.map((code) => ({ code }))).returning(['id', 'code']);
  const permId = Object.fromEntries(perms.map((p) => [p.code, p.id]));
  const rows = [];
  for (const role of roles) for (const code of ROLE_PERMISSIONS[role.name]) rows.push({ role_id: role.id, permission_id: permId[code] });
  await db('role_permissions').insert(rows);
  await db('stock_locations').insert([{ name: 'front_shelf' }, { name: 'store_room' }]);
}

let counter = 0;
async function createUser(role, overrides = {}) {
  counter += 1;
  const db = ownerDb();
  const roleRow = await db('roles').where({ name: role }).first();
  const [user] = await db('users').insert({
    full_name: overrides.full_name || `${role} ${counter}`,
    email: overrides.email === undefined ? `${role}${counter}@test.local` : overrides.email,
    phone: overrides.phone || null,
    password_hash: await bcrypt.hash(overrides.password || PASSWORD, 4),
    role_id: roleRow.id,
    status: overrides.status || 'active',
  }).returning('*');
  return user;
}

/** A supertest agent (keeps the session cookie) signed in as `user`. */
async function loginAs(app, user, password = PASSWORD) {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ email: user.email, password });
  if (res.status !== 200) throw new Error(`login failed for ${user.email}: ${res.status} ${JSON.stringify(res.body)}`);
  return agent;
}

async function locations() {
  const rows = await ownerDb()('stock_locations');
  return Object.fromEntries(rows.map((r) => [r.name, r.id]));
}

/** Product with stock set directly (bypasses movements - no alerts fire). */
async function createProduct({ name, sku, price = 1000, cost = 600, reorder = 0, shelf = 0, storeRoom = 0 } = {}) {
  counter += 1;
  const db = ownerDb();
  const [product] = await db('products').insert({
    sku: sku || `SKU-${counter}`,
    name: name || `Product ${counter}`,
    selling_price: price,
    cost_price: cost,
    reorder_level: reorder,
  }).returning('*');
  const loc = await locations();
  await db('stock_levels').insert([
    { product_id: product.id, location_id: loc.front_shelf, quantity: shelf },
    { product_id: product.id, location_id: loc.store_room, quantity: storeRoom },
  ]);
  return product;
}

async function stockOf(productId) {
  const rows = await ownerDb()('stock_levels').join('stock_locations', 'stock_locations.id', 'stock_levels.location_id')
    .where({ product_id: productId }).select('stock_locations.name', 'quantity');
  return Object.fromEntries(rows.map((r) => [r.name, r.quantity]));
}

async function inbox(userId) {
  return ownerDb()('notifications').join('notification_events', 'notification_events.id', 'notifications.event_id')
    .where({ recipient_user_id: userId }).select('notifications.*', 'notification_events.type').orderBy('notifications.id');
}

async function eventsOfType(type) {
  return ownerDb()('notification_events').where({ type }).orderBy('id');
}

module.exports = { openBusinessDay, ownerDb, closeOwner, resetDb, createUser, loginAs, locations, createProduct, stockOf, inbox, eventsOfType, PASSWORD };
