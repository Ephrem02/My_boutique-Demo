exports.up = async function (knex) {
  await knex.schema
    .createTable('suppliers', (t) => {
      t.increments('id').primary();
      t.string('name').notNullable();
      t.string('contact_phone');
      t.string('contact_email');
      t.string('address');
      t.text('payment_terms'); // e.g. "Net 30", "Cash on delivery"
      t.timestamps(true, true);
    })
    .createTable('supplier_deliveries', (t) => {
      t.increments('id').primary();
      t.integer('supplier_id').unsigned().notNullable().references('id').inTable('suppliers');
      t.date('delivery_date').notNullable();
      t.date('payment_due_date');
      t.decimal('total_amount', 14, 2).notNullable().defaultTo(0);
      t.decimal('amount_paid', 14, 2).notNullable().defaultTo(0);
      t.enu('status', ['unpaid', 'partial', 'paid']).notNullable().defaultTo('unpaid');
      t.integer('recorded_by').unsigned().notNullable().references('id').inTable('users');
      t.timestamps(true, true);
    })
    .createTable('supplier_delivery_items', (t) => {
      t.increments('id').primary();
      t.integer('delivery_id').unsigned().notNullable().references('id').inTable('supplier_deliveries').onDelete('CASCADE');
      t.integer('product_id').unsigned().notNullable().references('id').inTable('products');
      t.integer('quantity').notNullable();
      t.decimal('unit_cost', 12, 2).notNullable();
    })
    .createTable('supplier_payments', (t) => {
      t.increments('id').primary();
      t.integer('delivery_id').unsigned().notNullable().references('id').inTable('supplier_deliveries').onDelete('CASCADE');
      t.decimal('amount', 14, 2).notNullable();
      t.date('paid_date').notNullable();
      t.string('method'); // cash, bank transfer, mobile money
      t.integer('recorded_by').unsigned().notNullable().references('id').inTable('users');
      t.timestamp('created_at').defaultTo(knex.fn.now());
    });
};

exports.down = async function (knex) {
  await knex.schema
    .dropTableIfExists('supplier_payments')
    .dropTableIfExists('supplier_delivery_items')
    .dropTableIfExists('supplier_deliveries')
    .dropTableIfExists('suppliers');
};
