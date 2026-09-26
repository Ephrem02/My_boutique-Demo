// Manager's financial overview: payables, receivables, returns and money by
// payment method. Period figures (purchases, payments, returns...) respect
// ?from=&to=; outstanding balances, credit and overdue are always "as of now".
const db = require('../config/db');
const { AppError } = require('../utils/AppError');
const { ACCOUNT_METHODS, SIDES } = require('./sides');

const n = (v) => Math.round(Number(v || 0) * 100) / 100;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Transactions that count: not reversals, and not reversed. */
function live(table) {
  return db(`${table} as t`)
    .whereNot('t.type', 'reversal')
    .whereNotExists(db(`${table} as r`).whereRaw('r.reverses_id = t.id').select(db.raw('1')));
}

function inRange(query, column, { from, to }) {
  if (from) query.where(column, '>=', from);
  if (to) query.where(column, '<=', to);
  return query;
}

async function sumOf(query, column) {
  const row = await query.sum({ total: column }).first();
  return n(row?.total);
}

async function balances(s) {
  const row = await db(s.view)
    .select(
      db.raw('COALESCE(SUM(CASE WHEN balance > 0 THEN balance END), 0) as outstanding'),
      db.raw('COALESCE(SUM(CASE WHEN balance < 0 THEN -balance END), 0) as credit'),
      db.raw('COALESCE(SUM(CASE WHEN overdue THEN balance END), 0) as overdue'),
      db.raw('COUNT(*) FILTER (WHERE overdue)::int as overdue_count'),
      db.raw('COUNT(*) FILTER (WHERE balance > 0)::int as open_invoices'))
    .first();
  return { outstanding: n(row.outstanding), credit: n(row.credit), overdue: n(row.overdue), overdue_count: row.overdue_count, open_invoices: row.open_invoices };
}

async function byMethod(table, type, range) {
  const rows = await inRange(live(table).where('t.type', type), 't.txn_date', range)
    .groupBy('t.method').select('t.method').sum({ total: 't.amount' });
  const out = Object.fromEntries(ACCOUNT_METHODS.map((m) => [m, 0]));
  for (const r of rows) out[r.method] = n((out[r.method] || 0) + n(r.total));
  return out;
}

async function overdueInvoices(s) {
  return (await db(`${s.view} as b`)
    .join(`${s.partyTable} as p`, 'p.id', 'b.party_id')
    .where('b.overdue', true)
    .orderBy('b.due_date')
    .limit(20)
    .select('b.invoice_id', 'b.party_id', 'p.name as party_name', 'b.invoice_date', 'b.due_date', 'b.total_amount', 'b.balance',
      db.raw('(current_date - b.due_date)::int as days_overdue')))
    .map((r) => ({ ...r, total_amount: n(r.total_amount), balance: n(r.balance) }));
}

async function topBalances(s, direction) {
  const expr = direction === 'owed' ? 'CASE WHEN b.balance > 0 THEN b.balance ELSE 0 END' : 'CASE WHEN b.balance < 0 THEN -b.balance ELSE 0 END';
  return (await db(`${s.view} as b`)
    .join(`${s.partyTable} as p`, 'p.id', 'b.party_id')
    .groupBy('p.id', 'p.name')
    .select('p.id as party_id', 'p.name as party_name', db.raw(`SUM(${expr}) as amount`))
    .havingRaw(`SUM(${expr}) > 0`)
    .orderBy('amount', 'desc')
    .limit(8))
    .map((r) => ({ ...r, amount: n(r.amount) }));
}

async function returnsByReason(table, dateColumn, range, filter) {
  const q = inRange(db(table), dateColumn, range).groupBy('reason').select('reason')
    .count({ count: '*' }).sum({ value: 'total_value' }).orderBy('value', 'desc');
  if (filter) q.where(filter);
  return (await q).map((r) => ({ reason: r.reason, count: Number(r.count), value: n(r.value) }));
}

/** GET /api/finance/overview?from=&to= (managers) */
async function overview({ from, to } = {}) {
  if ((from && !DATE.test(from)) || (to && !DATE.test(to))) throw new AppError('from/to must be dates (YYYY-MM-DD)', 422);
  const range = { from, to };
  const sup = SIDES.supplier;
  const cus = SIDES.customer;

  const payables = {
    purchases: await sumOf(inRange(db('supplier_deliveries'), 'delivery_date', range), 'total_amount'),
    paid: await sumOf(inRange(live('supplier_transactions').where('t.type', 'payment'), 't.txn_date', range), 't.amount'),
    returns: await sumOf(inRange(db('supplier_returns'), 'return_date', range), 'total_value'),
    refunds_received: await sumOf(inRange(live('supplier_transactions').where('t.type', 'refund'), 't.txn_date', range), 't.amount'),
    ...(await balances(sup)),
    disputed_returns: Number((await db('supplier_returns').where({ supplier_response: 'disputed' }).count({ c: '*' }).first()).c),
  };
  const receivables = {
    credit_sales: await sumOf(inRange(db('institution_orders'), 'order_date', range), 'total_amount'),
    discounts: await sumOf(inRange(db('institution_orders'), 'order_date', range), 'discount_amount'),
    payments: await sumOf(inRange(live('customer_transactions').where('t.type', 'payment'), 't.txn_date', range), 't.amount'),
    returns: await sumOf(inRange(db('customer_returns').where({ status: 'approved' }), 'return_date', range), 'total_value'),
    refunds_paid: await sumOf(inRange(live('customer_transactions').where('t.type', 'refund'), 't.txn_date', range), 't.amount'),
    ...(await balances(cus)),
    pending_returns: Number((await db('customer_returns').where({ status: 'pending' }).count({ c: '*' }).first()).c),
  };

  const posSales = await (() => {
    const q = db('sales').where({ status: 'completed' }).groupBy('payment_method').select('payment_method').sum({ total: 'total_amount' });
    if (from) q.where('created_at', '>=', from);
    if (to) q.where('created_at', '<', db.raw("?::date + interval '1 day'", [to]));
    return q;
  })();
  const pos = Object.fromEntries(ACCOUNT_METHODS.map((m) => [m, 0]));
  for (const r of posSales) pos[r.payment_method] = n((pos[r.payment_method] || 0) + n(r.total));

  return {
    period: { from: from || null, to: to || null },
    payables,
    receivables,
    by_method: {
      methods: ACCOUNT_METHODS,
      pos_sales: pos,
      customer_payments: await byMethod('customer_transactions', 'payment', range),
      customer_refunds: await byMethod('customer_transactions', 'refund', range),
      supplier_payments: await byMethod('supplier_transactions', 'payment', range),
      supplier_refunds: await byMethod('supplier_transactions', 'refund', range),
    },
    overdue: { supplier: await overdueInvoices(sup), customer: await overdueInvoices(cus) },
    top: {
      suppliers_owed: await topBalances(sup, 'owed'),
      customers_owing: await topBalances(cus, 'owed'),
      customers_with_credit: await topBalances(cus, 'credit'),
      credit_customers: (await inRange(db('institution_orders as o'), 'o.order_date', range)
        .join('institutions as p', 'p.id', 'o.institution_id')
        .groupBy('p.id', 'p.name')
        .select('p.id as party_id', 'p.name as party_name', db.raw('SUM(o.total_amount) as amount'), db.raw('COUNT(*)::int as invoices'))
        .orderBy('amount', 'desc')
        .limit(8))
        .map((r) => ({ ...r, amount: n(r.amount) })),
    },
    returns_by_reason: {
      supplier: await returnsByReason('supplier_returns', 'return_date', range),
      customer: await returnsByReason('customer_returns', 'return_date', range, { status: 'approved' }),
    },
    recent_reversals: [
      ...(await db('supplier_transactions as t').join('users as u', 'u.id', 't.recorded_by').where('t.type', 'reversal')
        .orderBy('t.id', 'desc').limit(10).select('t.id', 't.delivery_id as invoice_id', 't.amount', 't.note', 't.created_at', 'u.full_name as by'))
        .map((r) => ({ ...r, side: 'supplier', amount: n(r.amount) })),
      ...(await db('customer_transactions as t').join('users as u', 'u.id', 't.recorded_by').where('t.type', 'reversal')
        .orderBy('t.id', 'desc').limit(10).select('t.id', 't.order_id as invoice_id', 't.amount', 't.note', 't.created_at', 'u.full_name as by'))
        .map((r) => ({ ...r, side: 'customer', amount: n(r.amount) })),
    ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 10),
  };
}

module.exports = { overview };
