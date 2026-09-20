exports.up = async function (knex) {
  await knex.schema.createTable('shrinkage_records', (t) => {
    t.increments('id').primary();
    t.integer('product_id').unsigned().notNullable().references('id').inTable('products');
    t.integer('quantity').notNullable();
    t.enu('cause', ['theft', 'miscount', 'spoilage', 'other']).notNullable();
    t.text('notes');
    t.integer('recorded_by').unsigned().notNullable().references('id').inTable('users');
    t.date('recorded_date').notNullable();
    t.timestamp('created_at').defaultTo(knex.fn.now());
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('shrinkage_records');
};
