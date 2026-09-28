// Step 0 foundations.
//
// 1. idempotency_keys: a money request sent twice with the same
//    Idempotency-Key (double click, network retry) returns the first result
//    instead of recording the money twice. See middleware/idempotency.js.
// 2. shop_today(): "today" in the shop's timezone (Admin > Closing), not the
//    database server's. The balance views use it for "overdue", so an invoice
//    doesn't turn overdue a few hours early or late.

const SHOP_TODAY = `
  CREATE OR REPLACE FUNCTION shop_today() RETURNS date LANGUAGE sql STABLE AS $$
    SELECT (now() AT TIME ZONE COALESCE(
      (SELECT value->>'timezone' FROM app_settings WHERE key = 'closing'),
      'Africa/Kigali'))::date
  $$`;

// Same definition as migration 24, with only the "today" expression swapped.
function balanceView({ view, txns, invoiceTable, invoice, source, party, date, due, returnsTable, returnsFilter }, today) {
  return `
    CREATE VIEW ${view} AS
    WITH live AS (
      -- a reversed transaction and its reversal cancel out: leave both out
      -- explicit columns (not *): the view must not pin columns that older
      -- migrations' rollbacks drop (e.g. return_id from migration 25)
      SELECT t.id, t.type, t.amount, t.${invoice}, t.${source} FROM ${txns} t
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
      (due_date IS NOT NULL AND due_date < ${today} AND balance > 0) AS overdue
    FROM totals`;
}

const VIEWS = [
  {
    view: 'supplier_invoice_balances', txns: 'supplier_transactions', invoiceTable: 'supplier_deliveries', invoice: 'delivery_id',
    source: 'source_delivery_id', party: 'supplier_id', date: 'delivery_date', due: 'payment_due_date', returnsTable: 'supplier_returns', returnsFilter: '',
  },
  {
    view: 'customer_invoice_balances', txns: 'customer_transactions', invoiceTable: 'institution_orders', invoice: 'order_id',
    source: 'source_order_id', party: 'institution_id', date: 'order_date', due: 'due_date', returnsTable: 'customer_returns', returnsFilter: "WHERE status = 'approved'",
  },
];

async function rebuildViews(knex, today) {
  for (const v of VIEWS) {
    await knex.raw(`DROP VIEW IF EXISTS ${v.view}`);
    await knex.raw(balanceView(v, today));
  }
}

exports.up = async function (knex) {
  await knex.schema.createTable('idempotency_keys', (t) => {
    t.integer('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.string('key', 100).notNullable();
    t.string('request_hash', 64).notNullable();
    t.string('state', 16).notNullable().defaultTo('in_progress'); // in_progress | done
    t.integer('status_code');
    t.jsonb('response_body');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.primary(['user_id', 'key']);
    t.index(['created_at']);
  });
  await knex.raw("ALTER TABLE idempotency_keys ADD CONSTRAINT idempotency_keys_state_valid CHECK (state IN ('in_progress', 'done'))");

  await knex.raw(SHOP_TODAY);
  await rebuildViews(knex, 'shop_today()');
};

exports.down = async function (knex) {
  await rebuildViews(knex, 'current_date');
  await knex.raw('DROP FUNCTION IF EXISTS shop_today()');
  await knex.schema.dropTableIfExists('idempotency_keys');
};
