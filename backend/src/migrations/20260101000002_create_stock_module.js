exports.up = async function (knex) {
  await knex.schema
    .createTable('categories', (t) => {
      t.increments('id').primary();
      t.string('name').notNullable().unique();
    })
    .createTable('products', (t) => {
      t.increments('id').primary();
      t.string('sku').notNullable().unique();
      t.string('name').notNullable();
      t.integer('category_id').unsigned().references('id').inTable('categories');
      t.string('unit').notNullable().defaultTo('pcs'); // pcs, kg, litre, etc.
      t.decimal('cost_price', 12, 2).notNullable().defaultTo(0);
      t.decimal('selling_price', 12, 2).notNullable().defaultTo(0);
      t.integer('reorder_level').notNullable().defaultTo(0);
      t.boolean('is_active').notNullable().defaultTo(true);
      t.timestamps(true, true);
    })
    .createTable('stock_locations', (t) => {
      t.increments('id').primary();
      t.string('name').notNullable().unique(); // 'front_shelf', 'store_room'
    })
    .createTable('stock_levels', (t) => {
      t.increments('id').primary();
      t.integer('product_id').unsigned().notNullable().references('id').inTable('products').onDelete('CASCADE');
      t.integer('location_id').unsigned().notNullable().references('id').inTable('stock_locations').onDelete('CASCADE');
      t.integer('quantity').notNullable().defaultTo(0);
      t.unique(['product_id', 'location_id']);
    })
    .createTable('stock_movements', (t) => {
      t.increments('id').primary();
      t.integer('product_id').unsigned().notNullable().references('id').inTable('products');
      t.integer('location_id').unsigned().notNullable().references('id').inTable('stock_locations');
      t.enu('type', ['stock_in', 'sold', 'damaged', 'returned', 'transfer_in', 'transfer_out', 'adjustment'])
        .notNullable();
      t.integer('quantity').notNullable(); // always positive; type + location tell direction
      t.string('reference_type'); // 'supplier_delivery', 'sale', 'institution_order', 'manual'
      t.integer('reference_id'); // id in the relevant table, nullable for manual adjustments
      t.text('notes');
      t.integer('performed_by').unsigned().notNullable().references('id').inTable('users');
      t.timestamp('created_at').defaultTo(knex.fn.now());
    });

  await knex('stock_locations').insert([{ name: 'front_shelf' }, { name: 'store_room' }]);
};

exports.down = async function (knex) {
  await knex.schema
    .dropTableIfExists('stock_movements')
    .dropTableIfExists('stock_levels')
    .dropTableIfExists('stock_locations')
    .dropTableIfExists('products')
    .dropTableIfExists('categories');
};
