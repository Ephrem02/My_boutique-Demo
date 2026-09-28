// Customer credit limits and manager-approved exceptions.
//
// credit_enabled = false: the client may not buy on account at all.
// credit_limit NULL: no limit (how every client behaved before this).
// Exposure is never stored - it is worked out from the ledger view at sale
// time (see finance/credit.js).
//
// credit_exceptions: one row per "let this sale go over the limit":
//   request -> pending -> approved | rejected; approved -> used | expired.
//   'inline' = a manager at the till approved it on the spot for their own sale.
// A request is never decided by the person who made it (CHECK below).
const GRANTS = { 'credit.manage': ['store_manager'] };

exports.up = async function (knex) {
  await knex.schema.alterTable('institutions', (t) => {
    t.boolean('credit_enabled').notNullable().defaultTo(true);
    t.decimal('credit_limit', 14, 2);
  });
  await knex.raw('ALTER TABLE institutions ADD CONSTRAINT institutions_credit_limit_nonnegative CHECK (credit_limit IS NULL OR credit_limit >= 0)');

  await knex.schema.createTable('credit_exceptions', (t) => {
    t.increments('id').primary();
    t.integer('institution_id').notNullable().references('id').inTable('institutions');
    t.decimal('amount', 14, 2).notNullable(); // how far over the limit this allows
    t.text('reason').notNullable();
    t.string('status', 16).notNullable();
    t.string('approval', 16).notNullable(); // request | inline
    t.date('business_date').notNullable(); // valid on this shop date only
    t.integer('requested_by').notNullable().references('id').inTable('users');
    t.integer('decided_by').references('id').inTable('users');
    t.timestamp('decided_at');
    t.text('decision_note');
    t.integer('order_id').references('id').inTable('institution_orders');
    t.timestamp('used_at');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['institution_id', 'status']);
    t.index(['status', 'business_date']);
  });
  await knex.raw(`ALTER TABLE credit_exceptions
    ADD CONSTRAINT credit_exceptions_amount_positive CHECK (amount > 0),
    ADD CONSTRAINT credit_exceptions_status_valid CHECK (status IN ('pending', 'approved', 'rejected', 'used', 'expired')),
    ADD CONSTRAINT credit_exceptions_approval_valid CHECK (approval IN ('request', 'inline')),
    ADD CONSTRAINT credit_exceptions_not_self_approved CHECK (approval = 'inline' OR decided_by IS NULL OR decided_by <> requested_by),
    ADD CONSTRAINT credit_exceptions_used_has_order CHECK ((status = 'used') = (order_id IS NOT NULL)),
    ADD CONSTRAINT credit_exceptions_reason_present CHECK (length(trim(reason)) >= 3)`);
  await knex.raw('CREATE UNIQUE INDEX credit_exceptions_one_per_order ON credit_exceptions (order_id) WHERE order_id IS NOT NULL');
  // Never deleted; only the decision/usage columns may change (ledger_row_guard, migration 24)
  await knex.raw(`CREATE TRIGGER credit_exceptions_ledger_guard BEFORE UPDATE OR DELETE ON credit_exceptions
    FOR EACH ROW EXECUTE FUNCTION ledger_row_guard('status', 'decided_by', 'decided_at', 'decision_note', 'order_id', 'used_at')`);

  for (const [code, roleNames] of Object.entries(GRANTS)) {
    await knex('permissions').insert({ code }).onConflict('code').ignore();
    const permission = await knex('permissions').where({ code }).first();
    const roles = await knex('roles').whereIn('name', roleNames);
    if (roles.length) {
      await knex('role_permissions')
        .insert(roles.map((r) => ({ role_id: r.id, permission_id: permission.id })))
        .onConflict(['role_id', 'permission_id'])
        .ignore();
    }
  }
};

exports.down = async function (knex) {
  await knex('permissions').whereIn('code', Object.keys(GRANTS)).del();
  await knex.schema.dropTableIfExists('credit_exceptions');
  await knex.raw('ALTER TABLE institutions DROP CONSTRAINT IF EXISTS institutions_credit_limit_nonnegative');
  await knex.schema.alterTable('institutions', (t) => {
    t.dropColumns('credit_enabled', 'credit_limit');
  });
};
