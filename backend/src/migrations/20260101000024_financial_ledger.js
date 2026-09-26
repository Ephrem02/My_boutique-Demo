// Supplier & customer financial ledger.
//
// Invoices: supplier_deliveries (purchase invoices, what we owe) and
// institution_orders (sales invoices, what customers owe us).
// Money: supplier_transactions / customer_transactions - one immutable row
// per payment, refund, credit application or reversal. Nothing is ever
// overwritten: a mistake is corrected by a reversal row.
// Goods back: supplier_returns / customer_returns (+ items).
// Balances are never stored - the *_invoice_balances views derive them:
//
//   balance = total - returns - payments + refunds - credit in + credit out
//
// (positive = still owed; negative = credit in the other party's favour).
//
// Guards (database-enforced, like the audit log): invoices can't be deleted
// and their financial columns can't change; invoice lines, transactions and
// return lines are append-only; return headers only accept status/response
// updates.
const ACCOUNT_METHODS = ['cash', 'mtn_mobile_money', 'airtel_money', 'card', 'bank_transfer'];
const LEGACY_METHODS = ['mobile_money', 'other']; // only for rows copied from the old payment tables
const TXN_TYPES = ['payment', 'refund', 'credit_applied', 'reversal'];
const SUPPLIER_RETURN_REASONS = ['damaged', 'wrong_item', 'wrong_quantity', 'expired', 'defective', 'poor_quality', 'duplicate_delivery', 'other'];
const CUSTOMER_RETURN_REASONS = ['defective', 'damaged', 'wrong_item', 'expired', 'poor_quality', 'changed_mind', 'other'];
const MOVEMENT_TYPES_OLD = ['stock_in', 'sold', 'damaged', 'returned', 'transfer_in', 'transfer_out', 'adjustment'];

const q = (list) => list.map((v) => `'${v}'`).join(', ');

const GRANTS = {
  'supplier_returns.manage': ['store_keeper'],
  'customer_returns.manage': ['cashier'],
  'customer_returns.approve': [],
  'ledger.manage': [],
  // Cashiers record customer sales/payments and see customer balances
  'institutions.view': ['cashier'],
  'institution_orders.view': ['cashier'],
  'institution_orders.manage': ['cashier'],
  'institution_payments.view': ['cashier'],
  'institution_payments.manage': ['cashier'],
};
const NEW_CODES = ['supplier_returns.manage', 'customer_returns.manage', 'customer_returns.approve', 'ledger.manage'];

async function grant(knex, code, roleNames) {
  await knex('permissions').insert({ code }).onConflict('code').ignore();
  const permission = await knex('permissions').where({ code }).first();
  const roles = await knex('roles').whereIn('name', [...roleNames, 'store_manager']);
  if (roles.length) {
    await knex('role_permissions').insert(roles.map((r) => ({ role_id: r.id, permission_id: permission.id })))
      .onConflict(['role_id', 'permission_id']).ignore();
  }
}

function txnTable(knex, name, { party, partyTable, invoice, invoiceTable, source }) {
  return knex.schema.createTable(name, (t) => {
    t.bigIncrements('id').primary();
    t.integer(party).notNullable().references('id').inTable(partyTable);
    t.integer(invoice).notNullable().references('id').inTable(invoiceTable);
    t.string('type', 20).notNullable();
    t.decimal('amount', 14, 2).notNullable();
    t.string('method', 32);
    t.string('reference_no', 100);
    t.date('txn_date').notNullable();
    t.integer(source).references('id').inTable(invoiceTable);
    t.bigInteger('reverses_id').unique().references('id').inTable(name);
    t.text('note');
    t.integer('business_day_id').references('id').inTable('business_days');
    t.integer('recorded_by').notNullable().references('id').inTable('users');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index([party, 'txn_date']);
    t.index([invoice]);
    t.index([source]);
    t.index(['business_day_id']);
  });
}

async function txnChecks(knex, name, invoice, source) {
  await knex.raw(`ALTER TABLE ${name}
    ADD CONSTRAINT ${name}_amount_positive CHECK (amount > 0),
    ADD CONSTRAINT ${name}_type_valid CHECK (type IN (${q(TXN_TYPES)})),
    ADD CONSTRAINT ${name}_method_valid CHECK (method IS NULL OR method IN (${q([...ACCOUNT_METHODS, ...LEGACY_METHODS])})),
    ADD CONSTRAINT ${name}_method_rules CHECK ((type IN ('payment', 'refund')) = (method IS NOT NULL)),
    ADD CONSTRAINT ${name}_credit_rules CHECK ((type = 'credit_applied') = (${source} IS NOT NULL) AND (${source} IS NULL OR ${source} <> ${invoice})),
    ADD CONSTRAINT ${name}_reversal_rules CHECK ((type = 'reversal') = (reverses_id IS NOT NULL))`);
}

/** balances view for one side; returnsFilter limits which returns count (customer returns need approval). */
function balanceView({ view, txns, invoiceTable, invoice, source, party, date, due, returnsTable, returnsFilter }) {
  return `
    CREATE VIEW ${view} AS
    WITH live AS (
      -- a reversed transaction and its reversal cancel out: leave both out
      SELECT * FROM ${txns} t
      WHERE t.type <> 'reversal'
        AND NOT EXISTS (SELECT 1 FROM ${txns} r WHERE r.reverses_id = t.id)
    ), effects AS (
      SELECT ${invoice} AS invoice_id, type AS kind,
             CASE type WHEN 'refund' THEN amount ELSE -amount END AS effect
        FROM live
      UNION ALL
      SELECT ${source}, 'credit_given', amount FROM live WHERE type = 'credit_applied'
    ), sums AS (
      SELECT invoice_id,
             SUM(effect) AS net,
             SUM(CASE WHEN kind = 'payment' THEN -effect ELSE 0 END) AS paid,
             SUM(CASE WHEN kind = 'refund' THEN effect ELSE 0 END) AS refunded,
             SUM(CASE WHEN kind = 'credit_applied' THEN -effect ELSE 0 END) AS credit_in,
             SUM(CASE WHEN kind = 'credit_given' THEN effect ELSE 0 END) AS credit_out
        FROM effects GROUP BY invoice_id
    ), rets AS (
      SELECT ${invoice} AS invoice_id, SUM(total_value) AS value FROM ${returnsTable} ${returnsFilter} GROUP BY ${invoice}
    ), totals AS (
      SELECT i.id AS invoice_id, i.${party} AS party_id, i.${date} AS invoice_date, i.${due} AS due_date,
             i.total_amount,
             COALESCE(r.value, 0) AS returns_total,
             COALESCE(s.paid, 0) AS amount_paid,
             COALESCE(s.refunded, 0) AS refunds_total,
             COALESCE(s.credit_in, 0) AS credit_applied,
             COALESCE(s.credit_out, 0) AS credit_given,
             i.total_amount - COALESCE(r.value, 0) + COALESCE(s.net, 0) AS balance
        FROM ${invoiceTable} i
        LEFT JOIN sums s ON s.invoice_id = i.id
        LEFT JOIN rets r ON r.invoice_id = i.id
    )
    SELECT totals.*,
      CASE
        WHEN balance < 0 THEN 'credit'
        WHEN balance = 0 THEN 'paid'
        WHEN amount_paid = 0 AND credit_applied = 0 AND returns_total = 0 THEN 'unpaid'
        ELSE 'partial'
      END AS status,
      (due_date IS NOT NULL AND due_date < current_date AND balance > 0) AS overdue
    FROM totals`;
}

exports.up = async function (knex) {
  // ---- Guards --------------------------------------------------------------
  // Invoices / return headers: no DELETE; UPDATE only of the columns passed as
  // trigger arguments (e.g. delivery status, due date, supplier response).
  await knex.raw(`
    CREATE FUNCTION ledger_row_guard() RETURNS trigger AS $$
    BEGIN
      IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'ledger_protected: % rows cannot be deleted', TG_TABLE_NAME;
      END IF;
      IF (to_jsonb(NEW) - TG_ARGV) IS DISTINCT FROM (to_jsonb(OLD) - TG_ARGV) THEN
        RAISE EXCEPTION 'ledger_protected: financial fields of % cannot be changed', TG_TABLE_NAME;
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);
  const guard = (table, allowed) => knex.raw(
    `CREATE TRIGGER ${table}_ledger_guard BEFORE UPDATE OR DELETE ON ${table}
     FOR EACH ROW EXECUTE FUNCTION ledger_row_guard(${allowed.map((c) => `'${c}'`).join(', ')})`
  );
  const appendOnly = async (table) => {
    await knex.raw(`CREATE TRIGGER ${table}_no_update_delete BEFORE UPDATE OR DELETE ON ${table}
      FOR EACH ROW EXECUTE FUNCTION closing_history_append_only()`);
    await knex.raw(`CREATE TRIGGER ${table}_no_truncate BEFORE TRUNCATE ON ${table}
      FOR EACH STATEMENT EXECUTE FUNCTION closing_history_append_only()`);
  };

  // ---- Purchase invoices (supplier deliveries) -----------------------------
  await knex.schema.alterTable('supplier_deliveries', (t) => {
    t.string('reference_no', 100); // supplier's invoice / delivery note number
    t.integer('received_by').references('id').inTable('users');
    t.text('notes');
  });
  await knex.raw('UPDATE supplier_deliveries SET received_by = recorded_by');
  await knex.schema.alterTable('supplier_delivery_items', (t) => {
    t.string('batch_no', 100); // batch / serial number, where applicable
    t.date('expiry_date');
  });
  await knex.raw(`ALTER TABLE supplier_deliveries ADD CONSTRAINT supplier_deliveries_total_nonnegative CHECK (total_amount >= 0)`);
  await knex.raw(`ALTER TABLE supplier_delivery_items
    ADD CONSTRAINT supplier_delivery_items_quantity_positive CHECK (quantity > 0),
    ADD CONSTRAINT supplier_delivery_items_cost_nonnegative CHECK (unit_cost >= 0)`);

  // ---- Sales invoices (customer / institution orders) ----------------------
  await knex.schema.alterTable('institution_orders', (t) => {
    t.decimal('discount_amount', 14, 2).notNullable().defaultTo(0);
    t.date('due_date');
    t.text('notes');
  });
  await knex.raw(`ALTER TABLE institution_orders
    ADD CONSTRAINT institution_orders_total_nonnegative CHECK (total_amount >= 0),
    ADD CONSTRAINT institution_orders_discount_nonnegative CHECK (discount_amount >= 0)`);
  await knex.raw(`ALTER TABLE institution_order_items
    ADD CONSTRAINT institution_order_items_quantity_positive CHECK (quantity > 0),
    ADD CONSTRAINT institution_order_items_price_nonnegative CHECK (unit_price >= 0)`);

  // ---- Transactions (payments, refunds, credits, reversals) ----------------
  await txnTable(knex, 'supplier_transactions', {
    party: 'supplier_id', partyTable: 'suppliers', invoice: 'delivery_id', invoiceTable: 'supplier_deliveries', source: 'source_delivery_id',
  });
  await txnChecks(knex, 'supplier_transactions', 'delivery_id', 'source_delivery_id');
  await txnTable(knex, 'customer_transactions', {
    party: 'institution_id', partyTable: 'institutions', invoice: 'order_id', invoiceTable: 'institution_orders', source: 'source_order_id',
  });
  await txnChecks(knex, 'customer_transactions', 'order_id', 'source_order_id');

  // Carry existing payments over as ledger rows, then retire the old tables
  // and the stored paid/status columns.
  const methodSql = `CASE WHEN p.method IN (${q(ACCOUNT_METHODS)}) THEN p.method WHEN p.method = 'mobile_money' THEN 'mobile_money' ELSE 'other' END`;
  await knex.raw(`
    INSERT INTO supplier_transactions (supplier_id, delivery_id, type, amount, method, txn_date, note, recorded_by, created_at)
    SELECT d.supplier_id, p.delivery_id, 'payment', p.amount, ${methodSql}, p.paid_date, 'Migrated from supplier_payments', p.recorded_by, COALESCE(p.created_at, now())
      FROM supplier_payments p JOIN supplier_deliveries d ON d.id = p.delivery_id WHERE p.amount > 0 ORDER BY p.id`);
  await knex.raw(`
    INSERT INTO customer_transactions (institution_id, order_id, type, amount, method, txn_date, note, recorded_by, created_at)
    SELECT o.institution_id, p.order_id, 'payment', p.amount, ${methodSql}, p.paid_date, 'Migrated from institution_payments', p.recorded_by, COALESCE(p.created_at, now())
      FROM institution_payments p JOIN institution_orders o ON o.id = p.order_id WHERE p.amount > 0 ORDER BY p.id`);
  await knex.schema.dropTable('supplier_payments');
  await knex.schema.dropTable('institution_payments');
  await knex.schema.alterTable('supplier_deliveries', (t) => {
    t.dropColumn('amount_paid');
    t.dropColumn('status');
  });
  await knex.schema.alterTable('institution_orders', (t) => {
    t.dropColumn('amount_paid');
    t.dropColumn('payment_status');
  });

  // ---- Returns --------------------------------------------------------------
  await knex.schema.createTable('supplier_returns', (t) => {
    t.increments('id').primary();
    t.integer('supplier_id').notNullable().references('id').inTable('suppliers');
    t.integer('delivery_id').notNullable().references('id').inTable('supplier_deliveries');
    t.date('return_date').notNullable();
    t.string('reason', 32).notNullable();
    t.text('notes');
    t.decimal('total_value', 14, 2).notNullable();
    // What the supplier said: the return value reduces the payable at once;
    // a dispute is tracked here and settled with a manager's credit/refund.
    t.string('supplier_response', 16).notNullable().defaultTo('pending');
    t.text('response_note');
    t.integer('responded_by').references('id').inTable('users');
    t.timestamp('responded_at');
    t.integer('business_day_id').references('id').inTable('business_days');
    t.integer('recorded_by').notNullable().references('id').inTable('users');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['supplier_id', 'return_date']);
    t.index(['delivery_id']);
  });
  await knex.raw(`ALTER TABLE supplier_returns
    ADD CONSTRAINT supplier_returns_reason_valid CHECK (reason IN (${q(SUPPLIER_RETURN_REASONS)})),
    ADD CONSTRAINT supplier_returns_response_valid CHECK (supplier_response IN ('pending', 'accepted', 'disputed')),
    ADD CONSTRAINT supplier_returns_value_positive CHECK (total_value > 0)`);
  await knex.schema.createTable('supplier_return_items', (t) => {
    t.increments('id').primary();
    t.integer('return_id').notNullable().references('id').inTable('supplier_returns');
    t.integer('delivery_item_id').notNullable().references('id').inTable('supplier_delivery_items');
    t.integer('product_id').notNullable().references('id').inTable('products');
    t.integer('location_id').notNullable().references('id').inTable('stock_locations');
    t.integer('quantity').notNullable();
    t.decimal('unit_cost', 12, 2).notNullable();
    t.index(['return_id']);
    t.index(['delivery_item_id']);
  });
  await knex.raw('ALTER TABLE supplier_return_items ADD CONSTRAINT supplier_return_items_quantity_positive CHECK (quantity > 0)');

  await knex.schema.createTable('customer_returns', (t) => {
    t.increments('id').primary();
    t.integer('institution_id').notNullable().references('id').inTable('institutions');
    t.integer('order_id').notNullable().references('id').inTable('institution_orders');
    t.date('return_date').notNullable();
    t.string('reason', 32).notNullable();
    t.text('notes');
    t.decimal('total_value', 14, 2).notNullable();
    // pending -> approved | rejected. Stock and money move only when approved.
    t.string('status', 16).notNullable();
    t.string('approval', 16); // auto (within the cashier limit / by a manager) | manager
    t.decimal('refund_amount', 14, 2).notNullable().defaultTo(0); // paid back now; the rest stays as customer credit
    t.string('refund_method', 32);
    t.string('refund_reference', 100);
    t.integer('requested_by').notNullable().references('id').inTable('users');
    t.integer('decided_by').references('id').inTable('users');
    t.timestamp('decided_at');
    t.text('decision_note');
    t.integer('business_day_id').references('id').inTable('business_days');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['institution_id', 'return_date']);
    t.index(['order_id']);
    t.index(['status']);
  });
  await knex.raw(`ALTER TABLE customer_returns
    ADD CONSTRAINT customer_returns_reason_valid CHECK (reason IN (${q(CUSTOMER_RETURN_REASONS)})),
    ADD CONSTRAINT customer_returns_status_valid CHECK (status IN ('pending', 'approved', 'rejected')),
    ADD CONSTRAINT customer_returns_approval_valid CHECK (approval IS NULL OR approval IN ('auto', 'manager')),
    ADD CONSTRAINT customer_returns_value_positive CHECK (total_value > 0),
    ADD CONSTRAINT customer_returns_refund_rules CHECK (refund_amount >= 0 AND refund_amount <= total_value AND (refund_amount = 0) = (refund_method IS NULL)),
    ADD CONSTRAINT customer_returns_refund_method_valid CHECK (refund_method IS NULL OR refund_method IN (${q(ACCOUNT_METHODS)})),
    ADD CONSTRAINT customer_return_not_self_approved CHECK (decided_by IS NULL OR decided_by <> requested_by)`);
  await knex.schema.createTable('customer_return_items', (t) => {
    t.increments('id').primary();
    t.integer('return_id').notNullable().references('id').inTable('customer_returns');
    t.integer('order_item_id').notNullable().references('id').inTable('institution_order_items');
    t.integer('product_id').notNullable().references('id').inTable('products');
    t.integer('quantity').notNullable();
    t.decimal('unit_price', 12, 2).notNullable();
    t.boolean('restock').notNullable(); // false: damaged/opened, written off
    t.integer('location_id').references('id').inTable('stock_locations');
    t.index(['return_id']);
    t.index(['order_item_id']);
  });
  await knex.raw(`ALTER TABLE customer_return_items
    ADD CONSTRAINT customer_return_items_quantity_positive CHECK (quantity > 0),
    ADD CONSTRAINT customer_return_items_restock_location CHECK (restock = (location_id IS NOT NULL))`);

  // Walk-in (POS) returns get the same reason codes
  await knex.schema.alterTable('returns', (t) => {
    t.string('reason_code', 32);
  });
  await knex.raw(`ALTER TABLE returns ADD CONSTRAINT returns_reason_code_valid CHECK (reason_code IS NULL OR reason_code IN (${q(CUSTOMER_RETURN_REASONS)}))`);

  // Stock leaves the shop when goods go back to a supplier
  await knex.raw('ALTER TABLE stock_movements DROP CONSTRAINT IF EXISTS stock_movements_type_check');
  await knex.raw(`ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_type_check CHECK (type IN (${q([...MOVEMENT_TYPES_OLD, 'returned_to_supplier'])}))`);

  // ---- Balance views --------------------------------------------------------
  await knex.raw(balanceView({
    view: 'supplier_invoice_balances', txns: 'supplier_transactions', invoiceTable: 'supplier_deliveries', invoice: 'delivery_id',
    source: 'source_delivery_id', party: 'supplier_id', date: 'delivery_date', due: 'payment_due_date', returnsTable: 'supplier_returns', returnsFilter: '',
  }));
  await knex.raw(balanceView({
    view: 'customer_invoice_balances', txns: 'customer_transactions', invoiceTable: 'institution_orders', invoice: 'order_id',
    source: 'source_order_id', party: 'institution_id', date: 'order_date', due: 'due_date', returnsTable: 'customer_returns', returnsFilter: "WHERE status = 'approved'",
  }));

  // ---- Guards on everything financial --------------------------------------
  await guard('supplier_deliveries', ['payment_due_date', 'notes', 'updated_at']);
  await guard('institution_orders', ['delivery_status', 'delivery_date', 'due_date', 'notes', 'updated_at']);
  await guard('supplier_returns', ['supplier_response', 'response_note', 'responded_by', 'responded_at']);
  await guard('customer_returns', ['status', 'approval', 'decided_by', 'decided_at', 'decision_note', 'business_day_id']);
  for (const table of ['supplier_delivery_items', 'institution_order_items', 'supplier_transactions', 'customer_transactions',
    'supplier_return_items', 'customer_return_items']) {
    await appendOnly(table);
  }

  // ---- Permissions ----------------------------------------------------------
  for (const [code, roles] of Object.entries(GRANTS)) await grant(knex, code, roles);
};

exports.down = async function (knex) {
  await knex('permissions').whereIn('code', NEW_CODES).del();
  const cashier = await knex('roles').where({ name: 'cashier' }).first();
  if (cashier) {
    const codes = Object.keys(GRANTS).filter((c) => !NEW_CODES.includes(c));
    const ids = await knex('permissions').whereIn('code', codes).pluck('id');
    await knex('role_permissions').where({ role_id: cashier.id }).whereIn('permission_id', ids).del();
  }

  for (const table of ['supplier_deliveries', 'institution_orders', 'supplier_returns', 'customer_returns']) {
    await knex.raw(`DROP TRIGGER IF EXISTS ${table}_ledger_guard ON ${table}`);
  }
  for (const table of ['supplier_delivery_items', 'institution_order_items']) {
    await knex.raw(`DROP TRIGGER IF EXISTS ${table}_no_update_delete ON ${table}`);
    await knex.raw(`DROP TRIGGER IF EXISTS ${table}_no_truncate ON ${table}`);
  }
  await knex.raw('DROP VIEW IF EXISTS supplier_invoice_balances');
  await knex.raw('DROP VIEW IF EXISTS customer_invoice_balances');

  await knex.raw('ALTER TABLE stock_movements DROP CONSTRAINT IF EXISTS stock_movements_type_check');
  await knex.raw(`ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_type_check CHECK (type IN (${q(MOVEMENT_TYPES_OLD)})) NOT VALID`);
  await knex.raw('ALTER TABLE returns DROP CONSTRAINT IF EXISTS returns_reason_code_valid');
  await knex.schema.alterTable('returns', (t) => t.dropColumn('reason_code'));

  await knex.schema.dropTableIfExists('customer_return_items');
  await knex.schema.dropTableIfExists('customer_returns');
  await knex.schema.dropTableIfExists('supplier_return_items');
  await knex.schema.dropTableIfExists('supplier_returns');

  await knex.schema.alterTable('supplier_deliveries', (t) => {
    t.decimal('amount_paid', 14, 2).notNullable().defaultTo(0);
    t.enu('status', ['unpaid', 'partial', 'paid']).notNullable().defaultTo('unpaid');
    t.index(['status', 'payment_due_date']); // as created by migration 11
  });
  await knex.schema.alterTable('institution_orders', (t) => {
    t.enu('payment_status', ['unpaid', 'partial', 'paid']).notNullable().defaultTo('unpaid');
    t.decimal('amount_paid', 14, 2).notNullable().defaultTo(0);
    t.index(['payment_status']);
  });
  await knex.schema.createTable('supplier_payments', (t) => {
    t.increments('id').primary();
    t.integer('delivery_id').unsigned().notNullable().references('id').inTable('supplier_deliveries').onDelete('CASCADE');
    t.decimal('amount', 14, 2).notNullable();
    t.date('paid_date').notNullable();
    t.string('method');
    t.integer('recorded_by').unsigned().notNullable().references('id').inTable('users');
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.index(['delivery_id']);
  });
  await knex.schema.createTable('institution_payments', (t) => {
    t.increments('id').primary();
    t.integer('order_id').unsigned().notNullable().references('id').inTable('institution_orders').onDelete('CASCADE');
    t.decimal('amount', 14, 2).notNullable();
    t.date('paid_date').notNullable();
    t.string('method');
    t.integer('recorded_by').unsigned().notNullable().references('id').inTable('users');
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.index(['order_id']);
  });
  await knex.raw(`INSERT INTO supplier_payments (delivery_id, amount, paid_date, method, recorded_by, created_at)
    SELECT delivery_id, amount, txn_date, method, recorded_by, created_at FROM supplier_transactions WHERE type = 'payment'`);
  await knex.raw(`INSERT INTO institution_payments (order_id, amount, paid_date, method, recorded_by, created_at)
    SELECT order_id, amount, txn_date, method, recorded_by, created_at FROM customer_transactions WHERE type = 'payment'`);
  await knex.schema.dropTableIfExists('supplier_transactions');
  await knex.schema.dropTableIfExists('customer_transactions');

  await knex.raw('ALTER TABLE institution_order_items DROP CONSTRAINT IF EXISTS institution_order_items_quantity_positive, DROP CONSTRAINT IF EXISTS institution_order_items_price_nonnegative');
  await knex.raw('ALTER TABLE institution_orders DROP CONSTRAINT IF EXISTS institution_orders_total_nonnegative, DROP CONSTRAINT IF EXISTS institution_orders_discount_nonnegative');
  await knex.schema.alterTable('institution_orders', (t) => {
    t.dropColumn('discount_amount');
    t.dropColumn('due_date');
    t.dropColumn('notes');
  });
  await knex.raw('ALTER TABLE supplier_delivery_items DROP CONSTRAINT IF EXISTS supplier_delivery_items_quantity_positive, DROP CONSTRAINT IF EXISTS supplier_delivery_items_cost_nonnegative');
  await knex.raw('ALTER TABLE supplier_deliveries DROP CONSTRAINT IF EXISTS supplier_deliveries_total_nonnegative');
  await knex.schema.alterTable('supplier_delivery_items', (t) => {
    t.dropColumn('batch_no');
    t.dropColumn('expiry_date');
  });
  await knex.schema.alterTable('supplier_deliveries', (t) => {
    t.dropColumn('reference_no');
    t.dropColumn('received_by');
    t.dropColumn('notes');
  });
  await knex.raw('DROP FUNCTION IF EXISTS ledger_row_guard()');
};
