// Proforma invoices (price proposals BEFORE a sale).
//
// A proforma records no sale, moves no stock and creates no debt. It can be
// cancelled, or converted once into a real sale (a customer invoice).
// Its lines and amounts never change after it is issued (ledger_row_guard,
// migration 24); only the status/conversion/cancellation columns may.
//
// document_counters: one row per document type and year. The next number is
// taken with a single UPSERT inside the creating transaction, which locks the
// row until commit - so numbers are never duplicated or reused.
exports.up = async function (knex) {
  await knex.schema.createTable('document_counters', (t) => {
    t.string('doc_type', 16).notNullable();
    t.integer('year').notNullable();
    t.integer('last_no').notNullable();
    t.primary(['doc_type', 'year']);
  });

  await knex.schema.createTable('proformas', (t) => {
    t.increments('id').primary();
    t.string('number', 32).notNullable().unique();
    t.integer('institution_id').references('id').inTable('institutions');
    t.string('customer_name', 200).notNullable(); // the client's name, or a walk-in customer's
    t.string('customer_contact', 200);
    t.date('issue_date').notNullable();
    t.date('valid_until').notNullable();
    t.text('payment_terms');
    t.text('notes');
    t.decimal('subtotal', 14, 2).notNullable();
    t.decimal('discount_amount', 14, 2).notNullable().defaultTo(0);
    t.decimal('total_amount', 14, 2).notNullable();
    t.string('status', 16).notNullable().defaultTo('issued');
    t.integer('converted_order_id').references('id').inTable('institution_orders');
    t.integer('converted_by').references('id').inTable('users');
    t.timestamp('converted_at');
    t.integer('cancelled_by').references('id').inTable('users');
    t.timestamp('cancelled_at');
    t.text('cancel_reason');
    t.integer('created_by').notNullable().references('id').inTable('users');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['institution_id']);
    t.index(['status', 'valid_until']);
  });
  await knex.raw(`ALTER TABLE proformas
    ADD CONSTRAINT proformas_status_valid CHECK (status IN ('issued', 'converted', 'cancelled')),
    ADD CONSTRAINT proformas_validity CHECK (valid_until >= issue_date),
    ADD CONSTRAINT proformas_amounts CHECK (subtotal >= 0 AND discount_amount >= 0 AND discount_amount <= subtotal AND total_amount = subtotal - discount_amount),
    ADD CONSTRAINT proformas_converted_has_order CHECK ((status = 'converted') = (converted_order_id IS NOT NULL)),
    ADD CONSTRAINT proformas_cancel_reason CHECK (status <> 'cancelled' OR length(trim(cancel_reason)) >= 3)`);
  await knex.raw('CREATE UNIQUE INDEX proformas_one_per_order ON proformas (converted_order_id) WHERE converted_order_id IS NOT NULL');

  await knex.schema.createTable('proforma_items', (t) => {
    t.increments('id').primary();
    t.integer('proforma_id').notNullable().references('id').inTable('proformas');
    t.integer('product_id').notNullable().references('id').inTable('products');
    t.string('product_name', 255).notNullable(); // as quoted, even if the product is renamed later
    t.string('sku', 100);
    t.integer('quantity').notNullable();
    t.decimal('unit_price', 12, 2).notNullable();
    t.decimal('line_total', 14, 2).notNullable();
    t.index(['proforma_id']);
  });
  await knex.raw(`ALTER TABLE proforma_items
    ADD CONSTRAINT proforma_items_quantity_positive CHECK (quantity > 0),
    ADD CONSTRAINT proforma_items_price_nonnegative CHECK (unit_price >= 0),
    ADD CONSTRAINT proforma_items_line_total CHECK (line_total = quantity * unit_price)`);

  await knex.raw(`CREATE TRIGGER proformas_ledger_guard BEFORE UPDATE OR DELETE ON proformas
    FOR EACH ROW EXECUTE FUNCTION ledger_row_guard('status', 'converted_order_id', 'converted_by', 'converted_at', 'cancelled_by', 'cancelled_at', 'cancel_reason')`);
  await knex.raw(`CREATE TRIGGER proforma_items_ledger_guard BEFORE UPDATE OR DELETE ON proforma_items
    FOR EACH ROW EXECUTE FUNCTION ledger_row_guard('_none_')`); // needs an argument: with none, the guard's comparison is NULL and lets updates through
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('proforma_items');
  await knex.schema.dropTableIfExists('proformas');
  await knex.schema.dropTableIfExists('document_counters');
};
