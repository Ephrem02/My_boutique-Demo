exports.up = async function (knex) {
  await knex.schema.createTable('institution_payments', (t) => {
    t.increments('id').primary();
    t.integer('order_id').unsigned().notNullable().references('id').inTable('institution_orders').onDelete('CASCADE');
    t.decimal('amount', 14, 2).notNullable();
    t.date('paid_date').notNullable();
    t.string('method'); // cash, bank transfer, mobile money
    t.integer('recorded_by').unsigned().notNullable().references('id').inTable('users');
    t.timestamp('created_at').defaultTo(knex.fn.now());
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('institution_payments');
};
