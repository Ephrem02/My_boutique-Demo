// Ledger reports behind the questions a manager asks:
//   "How much did we pay Supplier X this month?"      -> payments(side=supplier, party, from/to)
//   "How much did we receive through MTN?"             -> payments(side=customer, method)
//   "What goods went back to suppliers, and why?"      -> returnLines(side=supplier, from/to)
//   "How much did customer returns cost the business?" -> returnLines(side=customer|till) + overview
// Every row is a real ledger/return row; reversed transactions are flagged,
// not hidden, and left out of the totals. Both reports export as CSV.
const db = require('../config/db');
const { AppError } = require('../utils/AppError');
const { SIDES } = require('./sides');

const n = (v) => Math.round(Number(v || 0) * 100) / 100;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function checkRange({ from, to }) {
  if ((from && !DATE.test(from)) || (to && !DATE.test(to))) throw new AppError('from/to must be dates (YYYY-MM-DD)', 422);
}

function sidesFor(side) {
  if (!side || side === 'all') return [SIDES.supplier, SIDES.customer];
  if (!SIDES[side]) throw new AppError('side must be supplier, customer or all', 422);
  return [SIDES[side]];
}

/** GET /api/finance/reports/payments?side=&party_id=&method=&type=&from=&to= */
async function payments({ side, partyId, method, type, from, to }) {
  checkRange({ from, to });
  const rows = [];
  for (const s of sidesFor(side)) {
    const q = db(`${s.txns} as t`)
      .join(`${s.partyTable} as p`, 'p.id', `t.${s.party}`)
      .leftJoin('users as u', 'u.id', 't.recorded_by')
      .select('t.id', 't.type', 't.amount', 't.method', 't.reference_no', 't.txn_date', 't.note', 't.created_at', `t.${s.invoice} as invoice_id`,
        `t.${s.source} as source_invoice_id`, 't.return_id', 't.reverses_id', `t.${s.party} as party_id`, 'p.name as party_name', 'u.full_name as recorded_by',
        db.raw(`EXISTS (SELECT 1 FROM ${s.txns} r WHERE r.reverses_id = t.id) as reversed`))
      .orderBy('t.txn_date', 'desc').orderBy('t.id', 'desc')
      .limit(2000);
    if (partyId) q.where(`t.${s.party}`, Number(partyId) || 0);
    if (method) q.where('t.method', method);
    if (type) q.where('t.type', type);
    else q.whereIn('t.type', ['payment', 'refund', 'credit_applied', 'reversal']);
    if (from) q.where('t.txn_date', '>=', from);
    if (to) q.where('t.txn_date', '<=', to);
    rows.push(...(await q).map((r) => ({ ...r, side: s.side, amount: n(r.amount), id: `${s.side[0]}${r.id}`, txn_id: r.id })));
  }
  rows.sort((a, b) => String(b.txn_date).localeCompare(String(a.txn_date)) || new Date(b.created_at) - new Date(a.created_at));

  // Totals count only live money (not reversals, not reversed)
  const live = rows.filter((r) => !r.reversed && r.type !== 'reversal');
  const sum = (filter) => n(live.filter(filter).reduce((acc, r) => acc + r.amount, 0));
  return {
    rows,
    totals: {
      supplier_payments: sum((r) => r.side === 'supplier' && r.type === 'payment'),
      supplier_refunds: sum((r) => r.side === 'supplier' && r.type === 'refund'),
      customer_payments: sum((r) => r.side === 'customer' && r.type === 'payment'),
      customer_refunds: sum((r) => r.side === 'customer' && r.type === 'refund'),
      count: live.length,
    },
  };
}

/**
 * GET /api/finance/reports/returns?side=supplier|customer|till|all&reason=&from=&to=
 * One row per returned product line. Value is what the return took off the
 * invoice (or refunded at the till); cost is the goods at cost price, and
 * written_off marks goods that did not go back into stock.
 */
async function returnLines({ side = 'all', reason, from, to }) {
  checkRange({ from, to });
  if (!['all', 'supplier', 'customer', 'till'].includes(side)) throw new AppError('side must be supplier, customer, till or all', 422);
  const rows = [];
  const range = (q, column) => {
    if (from) q.where(column, '>=', from);
    if (to) q.where(column, '<=', to);
    if (reason) q.where(side === 'till' ? 'r.reason_code' : 'r.reason', reason);
    return q;
  };

  if (side === 'all' || side === 'supplier') {
    const q = range(db('supplier_return_items as i')
      .join('supplier_returns as r', 'r.id', 'i.return_id')
      .join('suppliers as p', 'p.id', 'r.supplier_id')
      .join('products as pr', 'pr.id', 'i.product_id')
      .leftJoin('users as u', 'u.id', 'r.recorded_by')
      .select('r.id as return_id', 'r.return_date as date', 'r.delivery_id as invoice_id', 'r.reason', 'r.notes', 'r.supplier_response as status',
        'p.name as party_name', 'pr.name as product_name', 'pr.sku', 'i.quantity', 'i.unit_cost as unit_value', 'pr.cost_price', 'u.full_name as recorded_by'), 'r.return_date');
    rows.push(...(await q).map((r) => ({ ...r, side: 'supplier', written_off: false })));
  }
  if (side === 'all' || side === 'customer') {
    const q = range(db('customer_return_items as i')
      .join('customer_returns as r', 'r.id', 'i.return_id')
      .join('institution_orders as o', 'o.id', 'r.order_id')
      .join('institutions as p', 'p.id', 'r.institution_id')
      .join('products as pr', 'pr.id', 'i.product_id')
      .leftJoin('users as u', 'u.id', 'r.requested_by')
      .select('r.id as return_id', 'r.return_date as date', 'r.order_id as invoice_id', 'r.reason', 'r.notes', 'r.status',
        'p.name as party_name', 'pr.name as product_name', 'pr.sku', 'i.quantity', 'i.restock', 'pr.cost_price', 'u.full_name as recorded_by',
        // the line's share of the (possibly discounted) invoice
        db.raw('i.unit_price * CASE WHEN o.total_amount + o.discount_amount > 0 THEN o.total_amount / (o.total_amount + o.discount_amount) ELSE 1 END as unit_value')), 'r.return_date');
    rows.push(...(await q).map((r) => ({ ...r, side: 'customer', written_off: r.status === 'approved' && !r.restock })));
  }
  if (side === 'all' || side === 'till') {
    const q = db('returns as r')
      .join('sale_items as si', 'si.id', 'r.sale_item_id')
      .join('products as pr', 'pr.id', 'si.product_id')
      .leftJoin('users as u', 'u.id', 'r.processed_by')
      .select('r.id as return_id', db.raw('(r.created_at)::date as date'), 'si.sale_id as invoice_id', 'r.reason_code as reason', 'r.reason as notes',
        'pr.name as product_name', 'pr.sku', 'r.quantity', 'si.unit_price as unit_value', 'pr.cost_price', 'r.restocked', 'r.refund_method', 'u.full_name as recorded_by');
    if (from) q.where('r.created_at', '>=', from);
    if (to) q.where('r.created_at', '<', db.raw("?::date + interval '1 day'", [to]));
    if (reason) q.where('r.reason_code', reason);
    rows.push(...(await q).map((r) => ({ ...r, side: 'till', party_name: null, status: 'refunded', written_off: !r.restocked })));
  }

  const out = rows.map((r) => ({
    ...r,
    id: `${r.side}-${r.return_id}-${r.product_name}`,
    date: r.date instanceof Date ? r.date.toISOString().slice(0, 10) : String(r.date).slice(0, 10),
    unit_value: n(r.unit_value),
    value: n(r.quantity * Number(r.unit_value)),
    cost: n(r.quantity * Number(r.cost_price)),
  })).sort((a, b) => b.date.localeCompare(a.date));

  // Customer returns count once approved (pending/rejected moved nothing)
  const counted = out.filter((r) => r.side !== 'customer' || r.status === 'approved');
  const total = (filter, key) => n(counted.filter(filter).reduce((acc, r) => acc + r[key], 0));
  return {
    rows: out,
    totals: {
      supplier_value: total((r) => r.side === 'supplier', 'value'),
      customer_value: total((r) => r.side === 'customer', 'value'),
      till_value: total((r) => r.side === 'till', 'value'),
      written_off_cost: total((r) => r.written_off, 'cost'),
    },
  };
}

// ---- CSV ------------------------------------------------------------------
function toCsv(rows, columns) {
  const cell = (v) => {
    if (v === null || v === undefined) return '';
    const s = v instanceof Date ? v.toISOString() : String(v);
    // Quote, and neutralize spreadsheet formulas (=, +, -, @ at the start)
    const safe = /^[=+\-@]/.test(s) && Number.isNaN(Number(s)) ? `'${s}` : s;
    return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return [columns.map(([, header]) => header).join(','), ...rows.map((r) => columns.map(([key]) => cell(r[key])).join(','))].join('\r\n');
}

const PAYMENT_COLUMNS = [
  ['txn_date', 'Date'], ['side', 'Ledger'], ['party_name', 'Supplier / customer'], ['invoice_id', 'Invoice'], ['type', 'Type'],
  ['method', 'Method'], ['reference_no', 'Reference'], ['amount', 'Amount (RWF)'], ['reversed', 'Reversed'], ['recorded_by', 'Recorded by'], ['note', 'Note'],
];
const RETURN_COLUMNS = [
  ['date', 'Date'], ['side', 'Ledger'], ['party_name', 'Supplier / customer'], ['invoice_id', 'Invoice / sale'], ['product_name', 'Product'], ['sku', 'SKU'],
  ['quantity', 'Quantity'], ['unit_value', 'Unit value (RWF)'], ['value', 'Value (RWF)'], ['cost', 'Cost (RWF)'], ['reason', 'Reason'],
  ['status', 'Status'], ['written_off', 'Written off'], ['recorded_by', 'Recorded by'], ['notes', 'Notes'],
];

module.exports = { payments, returnLines, toCsv, PAYMENT_COLUMNS, RETURN_COLUMNS };
