exports.up = async function (knex) {
  await knex.schema
    .createTable('institutions', (t) => {
      t.increments('id').primary();
      t.string('name').notNullable();
      t.string('contact_person');
      t.string('contact_phone');
      t.string('address');
      t.text('payment_terms');
      t.timestamps(true, true);
    })
    .createTable('institution_orders', (t) => {
      t.increments('id').primary();
      t.integer('institution_id').unsigned().notNullable().references('id').inTable('institutions');
      t.date('order_date').notNullable();
      t.date('delivery_date');
      t.enu('delivery_status', ['pending', 'delivered']).notNullable().defaultTo('pending');
      t.enu('payment_status', ['unpaid', 'partial', 'paid']).notNullable().defaultTo('unpaid');
      t.decimal('total_amount', 14, 2).notNullable().defaultTo(0);
      t.decimal('amount_paid', 14, 2).notNullable().defaultTo(0);
      t.integer('recorded_by').unsigned().notNullable().references('id').inTable('users');
      t.timestamps(true, true);
    })
    .createTable('institution_order_items', (t) => {
      t.increments('id').primary();
      t.integer('order_id').unsigned().notNullable().references('id').inTable('institution_orders').onDelete('CASCADE');
      t.integer('product_id').unsigned().notNullable().references('id').inTable('products');
      t.integer('quantity').notNullable();
      t.decimal('unit_price', 12, 2).notNullable(); // may differ from regular selling_price
    });
};

exports.down = async function (knex) {
  await knex.schema
    .dropTableIfExists('institution_order_items')
    .dropTableIfExists('institution_orders')
    .dropTableIfExists('institutions');
};
