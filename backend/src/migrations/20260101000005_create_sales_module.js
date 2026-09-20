exports.up = async function (knex) {
  await knex.schema
    .createTable('cash_drawer_sessions', (t) => {
      t.increments('id').primary();
      t.integer('cashier_id').unsigned().notNullable().references('id').inTable('users');
      t.decimal('opening_balance', 12, 2).notNullable();
      t.decimal('closing_balance', 12, 2); // filled when session is closed
      t.decimal('expected_balance', 12, 2); // opening + cash sales - cash payouts, computed at close
      t.decimal('variance', 12, 2); // closing - expected
      t.timestamp('opened_at').notNullable().defaultTo(knex.fn.now());
      t.timestamp('closed_at');
      t.enu('status', ['open', 'closed']).notNullable().defaultTo('open');
    })
    .createTable('sales', (t) => {
      t.increments('id').primary();
      t.integer('cashier_id').unsigned().notNullable().references('id').inTable('users');
      t.integer('cash_drawer_session_id').unsigned().references('id').inTable('cash_drawer_sessions');
      t.decimal('total_amount', 14, 2).notNullable();
      t.enu('payment_method', ['cash', 'mobile_money', 'card', 'bank_transfer']).notNullable();
      t.enu('status', ['completed', 'voided']).notNullable().defaultTo('completed');
      t.timestamp('created_at').defaultTo(knex.fn.now());
    })
    .createTable('sale_items', (t) => {
      t.increments('id').primary();
      t.integer('sale_id').unsigned().notNullable().references('id').inTable('sales').onDelete('CASCADE');
      t.integer('product_id').unsigned().notNullable().references('id').inTable('products');
      t.integer('quantity').notNullable();
      t.decimal('unit_price', 12, 2).notNullable();
      t.integer('location_id').unsigned().notNullable().references('id').inTable('stock_locations');
    })
    .createTable('returns', (t) => {
      t.increments('id').primary();
      t.integer('sale_item_id').unsigned().notNullable().references('id').inTable('sale_items');
      t.integer('quantity').notNullable();
      t.text('reason');
      t.boolean('restocked').notNullable().defaultTo(false); // false => treated as damaged, not returned to shelf
      t.integer('processed_by').unsigned().notNullable().references('id').inTable('users');
      t.timestamp('created_at').defaultTo(knex.fn.now());
    });
};

exports.down = async function (knex) {
  await knex.schema
    .dropTableIfExists('returns')
    .dropTableIfExists('sale_items')
    .dropTableIfExists('sales')
    .dropTableIfExists('cash_drawer_sessions');
};
