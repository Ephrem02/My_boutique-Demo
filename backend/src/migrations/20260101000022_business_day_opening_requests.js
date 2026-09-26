// Opening the business day becomes approval-controlled: only store managers
// open directly (day.open); cashiers and store keepers ask for it
// (day.open.request) and a manager approves or rejects (day.open.review).
// Keep in sync with src/seeds/01_roles_permissions.js and verify with
// `npm run check:permissions`.
const GRANTS = {
  'day.open.request': ['cashier', 'store_keeper'],
  'day.open.review': ['store_manager'],
};
const REVOKE = { 'day.open': ['cashier'] };

async function setGrants(knex, grants, { remove = false } = {}) {
  for (const [code, roleNames] of Object.entries(grants)) {
    await knex('permissions').insert({ code }).onConflict('code').ignore();
    const permission = await knex('permissions').where({ code }).first();
    const roles = await knex('roles').whereIn('name', roleNames);
    if (!roles.length) continue;
    if (remove) {
      await knex('role_permissions').where({ permission_id: permission.id }).whereIn('role_id', roles.map((r) => r.id)).del();
    } else {
      await knex('role_permissions')
        .insert(roles.map((r) => ({ role_id: r.id, permission_id: permission.id })))
        .onConflict(['role_id', 'permission_id'])
        .ignore();
    }
  }
}

exports.up = async function (knex) {
  await knex.schema.createTable('business_day_opening_requests', (t) => {
    t.increments('id').primary();
    t.date('business_date').notNullable();
    t.decimal('opening_float', 14, 2).notNullable();
    t.text('reason').notNullable();
    t.text('note');
    t.integer('requested_by').notNullable().references('id').inTable('users');
    t.timestamp('requested_at').notNullable().defaultTo(knex.fn.now());
    // expired: the date passed, or a manager opened the day directly instead
    t.enu('status', ['pending', 'approved', 'rejected', 'expired']).notNullable().defaultTo('pending');
    t.integer('reviewed_by').references('id').inTable('users');
    t.timestamp('reviewed_at');
    t.text('manager_comment');
    t.integer('business_day_id').references('id').inTable('business_days');
    t.index(['status', 'requested_at']);
    t.index(['requested_by', 'requested_at']);
  });
  // Four-eyes: nobody decides their own request, even with both permissions.
  await knex.raw(`ALTER TABLE business_day_opening_requests
    ADD CONSTRAINT opening_request_not_self_reviewed CHECK (reviewed_by IS NULL OR reviewed_by <> requested_by)`);
  // No duplicate requests: one pending request per business date.
  await knex.raw(`CREATE UNIQUE INDEX opening_request_one_pending_per_date
    ON business_day_opening_requests (business_date) WHERE status = 'pending'`);

  await knex.schema.alterTable('business_days', (t) => {
    t.integer('opening_request_id').references('id').inTable('business_day_opening_requests');
  });

  await setGrants(knex, GRANTS);
  await setGrants(knex, REVOKE, { remove: true });
};

exports.down = async function (knex) {
  await setGrants(knex, REVOKE);
  await knex('permissions').whereIn('code', Object.keys(GRANTS)).del();
  await knex.schema.alterTable('business_days', (t) => {
    t.dropColumn('opening_request_id');
  });
  await knex.schema.dropTableIfExists('business_day_opening_requests');
};
