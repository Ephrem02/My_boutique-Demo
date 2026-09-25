// Closing snapshots, correction requests and adjustments.
//
// daily_closings and closing_adjustments are append-only history (same
// protection as audit_logs: the runtime role gets SELECT/INSERT only, and a
// trigger blocks UPDATE/DELETE/TRUNCATE for everyone). A recount or reopen
// adds a new closing *version* that supersedes the previous one; a correction
// adds an adjustment row. Nothing that was submitted is ever overwritten.
exports.up = async function (knex) {
  await knex.schema
    .createTable('daily_closings', (t) => {
      t.bigIncrements('id').primary();
      t.integer('business_day_id').notNullable().references('id').inTable('business_days');
      t.integer('version').notNullable();
      t.bigInteger('supersedes_id').references('id').inTable('daily_closings');
      t.integer('submitted_by').notNullable().references('id').inTable('users');
      t.string('submitted_by_name', 200).notNullable();
      t.timestamp('submitted_at').notNullable().defaultTo(knex.fn.now());
      t.decimal('opening_float', 14, 2).notNullable();
      t.decimal('cash_sales', 14, 2).notNullable();
      t.decimal('cash_refunds', 14, 2).notNullable();
      t.decimal('expected_cash', 14, 2).notNullable();
      t.decimal('counted_cash', 14, 2).notNullable();
      t.decimal('variance', 14, 2).notNullable();
      t.enu('variance_band', ['normal', 'attention', 'critical']).notNullable();
      t.text('explanation');
      t.decimal('gross_sales', 14, 2).notNullable();
      t.decimal('refunds_total', 14, 2).notNullable();
      t.decimal('net_sales', 14, 2).notNullable();
      t.integer('transaction_count').notNullable();
      t.integer('void_count').notNullable();
      t.jsonb('snapshot').notNullable();
      t.unique(['business_day_id', 'version']);
    })
    .createTable('closing_correction_requests', (t) => {
      t.increments('id').primary();
      t.integer('business_day_id').notNullable().references('id').inTable('business_days');
      t.bigInteger('closing_id').notNullable().references('id').inTable('daily_closings');
      t.string('field', 32).notNullable();
      t.decimal('original_value', 14, 2).notNullable();
      t.decimal('requested_value', 14, 2).notNullable();
      t.text('reason').notNullable();
      t.text('explanation');
      t.string('related_entity_type', 32);
      t.integer('related_entity_id');
      t.integer('requested_by').notNullable().references('id').inTable('users');
      t.timestamp('requested_at').notNullable().defaultTo(knex.fn.now());
      t.enu('status', ['pending', 'approved', 'rejected']).notNullable().defaultTo('pending');
      t.integer('reviewed_by').references('id').inTable('users');
      t.timestamp('reviewed_at');
      t.text('review_reason');
      t.index(['status', 'requested_at']);
      t.index(['business_day_id']);
      t.index(['requested_by', 'requested_at']);
    })
    .createTable('closing_adjustments', (t) => {
      t.bigIncrements('id').primary();
      t.integer('business_day_id').notNullable().references('id').inTable('business_days');
      t.bigInteger('closing_id').notNullable().references('id').inTable('daily_closings');
      t.integer('correction_request_id').notNullable().unique().references('id').inTable('closing_correction_requests');
      t.string('field', 32).notNullable();
      t.decimal('original_value', 14, 2).notNullable();
      t.decimal('adjusted_value', 14, 2).notNullable();
      t.decimal('delta', 14, 2).notNullable();
      t.text('reason').notNullable();
      t.integer('requested_by').notNullable().references('id').inTable('users');
      t.string('requested_by_name', 200).notNullable();
      t.integer('approved_by').notNullable().references('id').inTable('users');
      t.string('approved_by_name', 200).notNullable();
      t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      t.index(['business_day_id']);
    });

  // No self-review, even for managers - enforced by the database itself.
  await knex.raw(`ALTER TABLE closing_correction_requests
    ADD CONSTRAINT correction_not_self_reviewed CHECK (reviewed_by IS NULL OR reviewed_by <> requested_by)`);
  // One pending request per closing field at a time.
  await knex.raw(`CREATE UNIQUE INDEX correction_one_pending_per_field
    ON closing_correction_requests (closing_id, field) WHERE status = 'pending'`);

  await knex.raw(`
    CREATE FUNCTION closing_history_append_only() RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION '% is append-only history', TG_TABLE_NAME;
    END
    $$ LANGUAGE plpgsql;
  `);
  for (const table of ['daily_closings', 'closing_adjustments']) {
    await knex.raw(`CREATE TRIGGER ${table}_no_update_delete BEFORE UPDATE OR DELETE ON ${table}
      FOR EACH ROW EXECUTE FUNCTION closing_history_append_only()`);
    await knex.raw(`CREATE TRIGGER ${table}_no_truncate BEFORE TRUNCATE ON ${table}
      FOR EACH STATEMENT EXECUTE FUNCTION closing_history_append_only()`);
  }
};

exports.down = async function (knex) {
  await knex.schema
    .dropTableIfExists('closing_adjustments')
    .dropTableIfExists('closing_correction_requests')
    .dropTableIfExists('daily_closings');
  await knex.raw('DROP FUNCTION IF EXISTS closing_history_append_only()');
};
