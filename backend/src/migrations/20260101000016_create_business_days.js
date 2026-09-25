// Daily business cycle. One business day per calendar date (shop timezone),
// and at most one day OPEN or CLOSING_IN_PROGRESS at a time. Sales, returns
// and stock movements are stamped with the day they happened in; existing
// rows keep business_day_id NULL ("before daily closing").
exports.up = async function (knex) {
  await knex.schema.createTable('business_days', (t) => {
    t.increments('id').primary();
    t.date('business_date').notNullable().unique();
    t.enu('status', ['open', 'closing_in_progress', 'closing_submitted', 'closed', 'closed_with_adjustment']).notNullable();
    t.decimal('opening_float', 14, 2).notNullable().defaultTo(0);
    t.integer('opened_by').references('id').inTable('users');
    t.timestamp('opened_at').notNullable().defaultTo(knex.fn.now());
    t.integer('closing_started_by').references('id').inTable('users');
    t.timestamp('closing_started_at');
    t.integer('submitted_by').references('id').inTable('users');
    t.timestamp('submitted_at');
    t.enu('acceptance', ['auto', 'manager']);
    t.integer('accepted_by').references('id').inTable('users');
    t.timestamp('accepted_at');
    t.text('acceptance_note');
    t.integer('recount_requested_by').references('id').inTable('users');
    t.timestamp('recount_requested_at');
    t.text('recount_reason');
    t.integer('reopened_count').notNullable().defaultTo(0);
    t.timestamp('closed_at');
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    t.index(['status']);
  });
  await knex.raw(
    "CREATE UNIQUE INDEX business_days_single_active ON business_days ((true)) WHERE status IN ('open', 'closing_in_progress')"
  );

  for (const table of ['sales', 'returns', 'stock_movements']) {
    await knex.schema.alterTable(table, (t) => {
      t.integer('business_day_id').references('id').inTable('business_days');
      t.index(['business_day_id']);
    });
  }
};

exports.down = async function (knex) {
  for (const table of ['stock_movements', 'returns', 'sales']) {
    await knex.schema.alterTable(table, (t) => {
      t.dropColumn('business_day_id');
    });
  }
  await knex.schema.dropTableIfExists('business_days');
};
