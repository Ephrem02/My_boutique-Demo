exports.up = async function (knex) {
  await knex.schema.alterTable('sales', (t) => {
    t.dropColumn('cash_drawer_session_id');
  });
  await knex.schema.dropTableIfExists('cash_drawer_sessions');
};

exports.down = async function (knex) {
  await knex.schema.createTable('cash_drawer_sessions', (t) => {
    t.increments('id').primary();
    t.integer('cashier_id').unsigned().notNullable().references('id').inTable('users');
    t.decimal('opening_balance', 12, 2).notNullable();
    t.decimal('closing_balance', 12, 2);
    t.decimal('expected_balance', 12, 2);
    t.decimal('variance', 12, 2);
    t.timestamp('opened_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('closed_at');
    t.enu('status', ['open', 'closed']).notNullable().defaultTo('open');
  });
  await knex.schema.alterTable('sales', (t) => {
    t.integer('cash_drawer_session_id').unsigned().references('id').inTable('cash_drawer_sessions');
  });
};
