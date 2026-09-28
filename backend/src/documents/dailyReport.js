// Daily report: opening, sales, collections, cash drawer, closing.
//
// Integrity rules:
//  - A closed day prints from its immutable closing snapshot (the latest
//    version in daily_closings), exactly as submitted - never recalculated.
//    Approved corrections are listed separately with the corrected cash.
//  - An open day prints live figures, labelled "as at" the print time.
//  - Sales revenue (till sales, sold on account) is kept apart from money
//    collected (payments on invoices, by method) - a payment is not a sale.
//    Collections come from the append-only ledger rows stamped with the day.
const db = require('../config/db');
const { AppError } = require('../utils/AppError');
const boards = require('../businessDay/boards');
const { getClosingSettings } = require('../businessDay/settings');
const { n } = require('../finance/ledger');
const { getBusiness } = require('./business');
const pdf = require('./pdf');

const METHODS = ['cash', 'mtn_mobile_money', 'airtel_money', 'card', 'bank_transfer'];
const METHOD_LABEL = { cash: 'Cash', mtn_mobile_money: 'MTN Mobile Money', airtel_money: 'Airtel Money', card: 'Card', bank_transfer: 'Bank transfer' };
const STATUS_LABEL = {
  open: 'Open', closing_in_progress: 'Closing in progress', closing_submitted: 'Closing submitted, awaiting review',
  closed: 'Closed', closed_with_adjustment: 'Closed with corrections',
};
const MOVEMENT_LABEL = {
  stock_in: 'Received', sold: 'Sold', transfer_in: 'Transferred in', transfer_out: 'Transferred out', damaged: 'Damaged',
  returned: 'Returned by customers', returned_to_supplier: 'Returned to suppliers', adjustment: 'Adjusted',
};

/** Money received and paid on accounts this day, by method (live ledger rows stamped with the day). */
async function collections(dayId) {
  const notReversed = (table) => (q) => q.whereNotExists(db(`${table} as r`).whereRaw('r.reverses_id = t.id').select(db.raw('1')));
  const customer = await db('customer_transactions as t')
    .join('institution_orders as o', 'o.id', 't.order_id')
    .where('t.business_day_id', dayId).whereIn('t.type', ['payment', 'refund'])
    .modify(notReversed('customer_transactions'))
    // at_sale: paid on an invoice made the same day (t is already that day)
    .select('t.type', 't.method', db.raw('(o.business_day_id IS NOT DISTINCT FROM t.business_day_id) AS at_sale'), db.raw('SUM(t.amount) AS total'), db.raw('COUNT(*)::int AS count'))
    .groupByRaw('1, 2, 3');
  const supplier = await db('supplier_transactions as t')
    .where('t.business_day_id', dayId).whereIn('t.type', ['payment', 'refund'])
    .modify(notReversed('supplier_transactions'))
    .groupBy('t.type', 't.method')
    .select('t.type', 't.method', db.raw('SUM(t.amount) AS total'), db.raw('COUNT(*)::int AS count'));
  const reversed = await db('customer_transactions').where({ type: 'reversal', business_day_id: dayId }).count('* as n').first();

  const byMethod = Object.fromEntries(METHODS.map((m) => [m, { client_payments: 0, client_refunds: 0, supplier_payments: 0, supplier_refunds: 0 }]));
  let atSale = 0;
  let previous = 0;
  for (const r of customer) {
    const v = n(r.total);
    const m = byMethod[r.method] || (byMethod[r.method] = { client_payments: 0, client_refunds: 0, supplier_payments: 0, supplier_refunds: 0 });
    if (r.type === 'payment') {
      m.client_payments = n(m.client_payments + v);
      if (r.at_sale) atSale = n(atSale + v);
      else previous = n(previous + v);
    } else m.client_refunds = n(m.client_refunds + v);
  }
  for (const r of supplier) {
    const m = byMethod[r.method] || (byMethod[r.method] = { client_payments: 0, client_refunds: 0, supplier_payments: 0, supplier_refunds: 0 });
    if (r.type === 'payment') m.supplier_payments = n(m.supplier_payments + n(r.total));
    else m.supplier_refunds = n(m.supplier_refunds + n(r.total));
  }
  return { by_method: byMethod, client_payments_at_sale: atSale, client_payments_previous: previous, client_payments: n(atSale + previous), reversals_recorded: Number(reversed.n) };
}

/** The report's data model (also returned as JSON). canSeeStaff: per-cashier figures are for managers. */
async function buildDailyReport({ dayId, canSeeStaff }) {
  const board = await boards.detail(Number(dayId) || 0);
  if (!board) throw new AppError('Business day not found', 404);
  const settings = await getClosingSettings();
  const f = board.figures;
  return {
    type: 'daily_report',
    kind: board.kind, // live | closed
    timezone: settings.timezone,
    day: board.day,
    people: board.people,
    opening_float: board.kind === 'live' ? board.day.opening_float : f.cash.opening_float,
    sales: f.sales,
    payment_methods: f.payment_methods,
    refunds_by_method: f.refunds_by_method,
    cash: f.cash,
    collections: await collections(board.day.id),
    closing: board.closing || null,
    corrected: board.corrected || null,
    adjustments: board.adjustments || [],
    versions: board.versions || [],
    per_cashier: canSeeStaff ? f.per_cashier || [] : undefined,
    inventory: f.inventory ? { movements: f.inventory.movements, low_stock_count: f.inventory.low_stock_count, out_of_stock_count: f.inventory.out_of_stock_count } : null,
  };
}

function dailyReportPdf(model, { business, generatedBy }) {
  const tz = model.timezone;
  const { rwf, signedRwf, num, when, table, pairs, heading, note, columns } = pdf;
  const s = model.sales;
  const c = model.cash;
  const col = model.collections;
  const onAccount = s.on_account;
  const people = model.people || {};
  const who = (p) => (p ? `${p.name || '—'} · ${when(p.at, tz)}` : '—');
  const closed = model.kind === 'closed';
  const dayLabel = `${when(model.day.business_date, tz, { time: false })}${model.day.session_no > 1 ? ` · session ${model.day.session_no}` : ''}`;

  const content = [
    heading('Sales and money received'),
    columns(
      pairs([
        ['Till sales (gross)', rwf(s.gross)],
        ['Refunds at the till', rwf(-s.refunds)],
        ['Net till sales', rwf(s.net), { bold: true }],
        ['Till transactions', num(s.transactions)],
        ['Voided sales', `${num(s.void_count)} (${rwf(s.void_total)})`],
      ]),
      pairs([
        onAccount ? ['Sold on account (invoices)', `${num(onAccount.count)} · ${rwf(onAccount.total)}`] : ['Sold on account (invoices)', 'Not recorded for this day'],
        onAccount && ['  of which paid at the sale', rwf(onAccount.paid_now)],
        onAccount && ['  of which put on credit', rwf(onAccount.on_credit)],
        ['Collected on earlier invoices', rwf(col.client_payments_previous)],
        ['Client payments received (all)', rwf(col.client_payments), { bold: true }],
      ]),
    ),
    note('A payment on an earlier invoice is money collected, not a new sale. Sold on account is revenue, not money in the till.'),

    heading('By payment method'),
    table(
      [{ text: 'Method' }, { text: 'Till sales', align: 'right' }, { text: 'Till refunds', align: 'right' }, { text: 'Client payments', align: 'right' },
        { text: 'Client refunds', align: 'right' }, { text: 'Paid to suppliers', align: 'right' }],
      METHODS.map((m) => {
        const b = col.by_method[m] || {};
        return [METHOD_LABEL[m], rwf(model.payment_methods?.[m] || 0), rwf(model.refunds_by_method?.[m] || 0), rwf(b.client_payments || 0), rwf(b.client_refunds || 0), rwf(b.supplier_payments || 0)];
      }),
    ),

    heading('Cash drawer'),
    columns(
      pairs([
        ['Opening float', rwf(c.opening_float)],
        ['+ Cash sales', rwf(c.cash_sales)],
        ['− Cash refunds', rwf(c.cash_refunds)],
        ['+ Cash received on accounts', rwf(c.account_cash_in)],
        ['− Cash paid out on accounts', rwf(c.account_cash_out)],
        ['= Expected cash', rwf(closed ? model.closing.expected_cash : c.expected_cash), { bold: true }],
      ]),
      closed ? pairs([
        ['Counted cash', rwf(model.closing.counted_cash)],
        ['Variance', `${signedRwf(model.closing.variance)} (${model.closing.variance_band})`, { bold: true }],
        model.corrected?.adjusted && ['Expected after corrections', rwf(model.corrected.expected_cash)],
        model.corrected?.adjusted && ['Variance after corrections', signedRwf(model.corrected.variance), { bold: true }],
      ]) : note('The day is still open: the cash count is recorded at closing.'),
    ),
    closed && model.closing.explanation ? { text: [{ text: 'Explanation: ', bold: true }, `“${model.closing.explanation}”`], margin: [0, 0, 0, 8] } : null,

    heading('Opening and closing'),
    pairs([
      ['Status', STATUS_LABEL[model.day.status] || model.day.status],
      people.opening_requested_by && ['Opening requested by', who(people.opening_requested_by)],
      ['Opened by', who(people.opened_by)],
      ['Closing started by', who(people.closing_requested_by)],
      ['Closing submitted by', who(people.submitted_by)],
      closed && ['Reviewed', model.day.acceptance === 'manager' ? `Accepted by ${who(people.accepted_by)}` : model.day.acceptance === 'auto' ? 'Accepted automatically (within the variance limits)' : 'Awaiting review'],
      people.recount_requested_by && ['Recount requested by', who(people.recount_requested_by)],
      model.day.reopened_count > 0 && ['Times reopened', num(model.day.reopened_count)],
      closed && ['Closing record', `#${model.closing.id}, version ${model.closing.version} (${model.versions.length || 1} submitted)`],
    ]),
  ];

  if (model.adjustments.length) {
    content.push(heading('Approved corrections'), table(
      [{ text: 'Field' }, { text: 'Recorded', align: 'right' }, { text: 'Corrected', align: 'right' }, { text: 'Change', align: 'right' }, { text: 'Reason' }, { text: 'Approved by' }],
      model.adjustments.map((a) => [a.field.replace(/_/g, ' '), rwf(a.original_value), rwf(a.adjusted_value), signedRwf(a.delta), a.reason, a.approved_by_name]),
    ));
  }
  if (model.per_cashier?.length) {
    content.push(heading('By cashier'), table(
      [{ text: 'Cashier' }, { text: 'Sales', align: 'right' }, { text: 'Transactions', align: 'right' }, { text: 'Voids', align: 'right' }, { text: 'Refunds', align: 'right' }],
      model.per_cashier.map((p) => [p.name, rwf(p.sales), num(p.transactions), num(p.voids), rwf(p.refunds)]),
    ));
  }
  if (model.inventory?.movements && Object.keys(model.inventory.movements).length) {
    content.push(heading('Stock movements'), table(
      [{ text: 'Movement' }, { text: 'Entries', align: 'right' }, { text: 'Units', align: 'right' }],
      Object.entries(model.inventory.movements).map(([type, m]) => [MOVEMENT_LABEL[type] || type.replace(/_/g, ' '), num(m.count), num(m.quantity)]),
    ));
  }
  content.push(note(closed
    ? 'Till figures are printed from the closing snapshot as submitted. Account payments are listed from the ledger; entries reversed since are left out.'
    : 'Live figures as at the print time; they will change until the day is closed.'));

  return pdf.layout({
    business,
    title: closed ? 'Daily closing report' : 'Daily report (day still open)',
    subtitle: dayLabel,
    meta: [['Business day', `#${model.day.id}`], ['Status', STATUS_LABEL[model.day.status] || model.day.status]],
    content: content.filter(Boolean),
    generatedBy,
    timezone: tz,
  });
}

async function dailyReport({ dayId, canSeeStaff, format, generatedBy }) {
  const model = await buildDailyReport({ dayId, canSeeStaff });
  if (format !== 'pdf') return { model };
  const business = await getBusiness();
  return { model, pdf: await pdf.render(dailyReportPdf(model, { business, generatedBy })), filename: `daily-report-${model.day.business_date}-s${model.day.session_no}.pdf` };
}

/** Who may print which day: managers any day; staff with day.view only the day in progress. */
async function canPrintDay(req, dayId) {
  if (req.user.permissions.includes('day.history.view')) return true;
  if (!req.user.permissions.includes('day.view')) return false;
  const day = await db('business_days').where({ id: Number(dayId) || 0 }).first('status');
  return !!day && ['open', 'closing_in_progress'].includes(day.status);
}

module.exports = { dailyReport, buildDailyReport, canPrintDay, METHOD_LABEL };
