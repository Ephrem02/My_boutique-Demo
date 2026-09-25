// Foreign-key and filter indexes the original migrations never created
// (Postgres doesn't index FK columns automatically), plus a session version
// so a password reset can invalidate tokens that were issued before it.
const INDEXES = [
  ['users', ['role_id']],
  ['products', ['category_id']],
  ['stock_movements', ['product_id', 'created_at']],
  ['stock_movements', ['location_id']],
  ['stock_movements', ['performed_by']],
  ['stock_movements', ['created_at']],
  ['stock_movements', ['reference_type', 'reference_id']],
  ['supplier_deliveries', ['supplier_id']],
  ['supplier_deliveries', ['status', 'payment_due_date']],
  ['supplier_delivery_items', ['delivery_id']],
  ['supplier_delivery_items', ['product_id']],
  ['supplier_payments', ['delivery_id']],
  ['institution_orders', ['institution_id']],
  ['institution_orders', ['payment_status']],
  ['institution_order_items', ['order_id']],
  ['institution_order_items', ['product_id']],
  ['institution_payments', ['order_id']],
  ['sales', ['cashier_id', 'created_at']],
  ['sales', ['created_at']],
  ['sales', ['status']],
  ['sale_items', ['sale_id']],
  ['sale_items', ['product_id']],
  ['returns', ['sale_item_id']],
  ['returns', ['processed_by']],
  ['shrinkage_records', ['product_id']],
  ['shrinkage_records', ['recorded_date']],
];

exports.up = async function (knex) {
  await knex.schema.alterTable('users', (t) => {
    t.integer('session_version').notNullable().defaultTo(0);
  });
  for (const [table, columns] of INDEXES) {
    await knex.schema.alterTable(table, (t) => t.index(columns));
  }
};

exports.down = async function (knex) {
  for (const [table, columns] of [...INDEXES].reverse()) {
    await knex.schema.alterTable(table, (t) => t.dropIndex(columns));
  }
  await knex.schema.alterTable('users', (t) => {
    t.dropColumn('session_version');
  });
};
