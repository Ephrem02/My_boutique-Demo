// Employee 360°: who the employee is and what they did in a period - sales,
// voids, refunds, sales on account, payments collected, stock handled,
// business days opened and closed (with the cash variance of each closing
// they submitted), credit requests, and their audit trail.
//
// Everything is read from existing records (sales, returns, ledger, stock
// movements, closings, audit log); nothing is stored for this page.
// Periods are shop calendar dates (Admin > Closing timezone).
const db = require('../config/db');
const { AppError } = require('../utils/AppError');
const { getClosingSettings, shopDate } = require('../businessDay/settings');
const { dateOnly } = require('../businessDay/businessDayService');
const { n } = require('../finance/ledger');
const { getBusiness } = require('./business');
const { METHOD_LABEL } = require('./dailyReport');
const pdf = require('./pdf');

const isDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));

function period(from, to, settings) {
  const today = shopDate(settings);
  const end = isDate(to) ? to : today;
  const start = isDate(from) ? from : shopDate(settings, new Date(Date.parse(`${end}T12:00:00Z`) - 29 * 86400000));
  if (start > end) throw new AppError('from must be on or before to', 422);
  return { from: start, to: end };
}

/** WHERE <column> falls on a shop date in [from, to]. */
const inShopDates = (column, tz, p) => (q) => q.whereRaw(`(${column} AT TIME ZONE ?)::date BETWEEN ? AND ?`, [tz, p.from, p.to]);

async function buildEmployeeProfile({ userId, from, to, canSeeAudit }) {
  const user = await db('users as u').join('roles as r', 'r.id', 'u.role_id')
    .where('u.id', Number(userId) || 0)
    .first('u.id', 'u.full_name', 'u.email', 'u.phone', 'u.status', 'u.created_at', 'u.last_login_at', 'r.name as role');
  if (!user) throw new AppError('Employee not found', 404);
  const settings = await getClosingSettings();
  const tz = settings.timezone;
  const p = period(from, to, settings);
  const id = user.id;

  // Till sales
  const salesRows = await db('sales').where({ cashier_id: id }).modify(inShopDates('created_at', tz, p))
    .groupBy('status', 'payment_method').select('status', 'payment_method', db.raw('COUNT(*)::int AS count'), db.raw('SUM(total_amount) AS total'));
  const sales = { count: 0, total: 0, by_method: {}, voids: { count: 0, total: 0 } };
  for (const r of salesRows) {
    if (r.status === 'completed') {
      sales.count += r.count;
      sales.total = n(sales.total + n(r.total));
      sales.by_method[r.payment_method] = n((sales.by_method[r.payment_method] || 0) + n(r.total));
    } else {
      sales.voids.count += r.count;
      sales.voids.total = n(sales.voids.total + n(r.total));
    }
  }
  const byDay = await db('sales').where({ cashier_id: id, status: 'completed' }).modify(inShopDates('created_at', tz, p))
    .groupByRaw('1').orderByRaw('1')
    .select(db.raw('(created_at AT TIME ZONE ?)::date AS date', [tz]), db.raw('COUNT(*)::int AS count'), db.raw('SUM(total_amount) AS total'));

  // Till refunds / returns processed
  const refunds = await db('returns').where({ processed_by: id }).modify(inShopDates('created_at', tz, p))
    .select(db.raw('COUNT(*)::int AS count'), db.raw('COALESCE(SUM(refund_amount), 0) AS total')).first();

  // Sold on account, and client payments collected (not reversed)
  const onAccount = await db('institution_orders').where({ recorded_by: id }).modify(inShopDates('created_at', tz, p))
    .select(db.raw('COUNT(*)::int AS count'), db.raw('COALESCE(SUM(total_amount), 0) AS total')).first();
  const notReversed = (table) => (q) => q.whereNotExists(db(`${table} as r`).whereRaw('r.reverses_id = t.id').select(db.raw('1')));
  const collected = await db('customer_transactions as t').where({ 't.recorded_by': id, 't.type': 'payment' })
    .modify(inShopDates('t.created_at', tz, p)).modify(notReversed('customer_transactions'))
    .groupBy('t.method').select('t.method', db.raw('COUNT(*)::int AS count'), db.raw('SUM(t.amount) AS total'));
  const supplierPaid = await db('supplier_transactions as t').where({ 't.recorded_by': id, 't.type': 'payment' })
    .modify(inShopDates('t.created_at', tz, p)).modify(notReversed('supplier_transactions'))
    .select(db.raw('COUNT(*)::int AS count'), db.raw('COALESCE(SUM(t.amount), 0) AS total')).first();
  const reversalsMade = await db('customer_transactions').where({ recorded_by: id, type: 'reversal' }).modify(inShopDates('created_at', tz, p)).count('* as n').first();
  const supplierReversals = await db('supplier_transactions').where({ recorded_by: id, type: 'reversal' }).modify(inShopDates('created_at', tz, p)).count('* as n').first();

  // Stock handled
  const deliveries = await db('supplier_deliveries').where({ received_by: id }).modify(inShopDates('created_at', tz, p))
    .select(db.raw('COUNT(*)::int AS count'), db.raw('COALESCE(SUM(total_amount), 0) AS total')).first();
  const movements = await db('stock_movements').where({ performed_by: id }).modify(inShopDates('created_at', tz, p))
    .groupBy('type').select('type', db.raw('COUNT(*)::int AS count'), db.raw('SUM(quantity)::int AS quantity'));

  // Business days: opened, and closings they submitted (latest version of each day)
  const opened = await db('business_days').where({ opened_by: id }).whereBetween('business_date', [p.from, p.to]).count('* as n').first();
  const closings = await db('daily_closings as c')
    .join('business_days as d', 'd.id', 'c.business_day_id')
    .where('c.submitted_by', id)
    .whereBetween('d.business_date', [p.from, p.to])
    .whereRaw('c.version = (SELECT MAX(version) FROM daily_closings x WHERE x.business_day_id = c.business_day_id)')
    .orderBy('d.business_date', 'desc')
    .select('d.id as day_id', 'd.business_date', 'd.session_no', 'd.status', 'c.version', 'c.expected_cash', 'c.counted_cash', 'c.variance', 'c.variance_band', 'c.explanation', 'c.submitted_at');
  const variances = closings.map((c) => n(c.variance));

  // Credit-limit exceptions
  const creditAsked = await db('credit_exceptions').where({ requested_by: id }).whereBetween('business_date', [p.from, p.to])
    .groupBy('status', 'approval').select('status', 'approval', db.raw('COUNT(*)::int AS count'));

  // Audit trail (managers with audit.view)
  let activity;
  if (canSeeAudit) {
    activity = await db('audit_logs').where({ actor_user_id: id }).modify(inShopDates('created_at', tz, p))
      .orderBy('id', 'desc').limit(200).select('id', 'created_at', 'action', 'entity_type', 'entity_id', 'result');
  }
  const denied = await db('audit_logs').where({ actor_user_id: id, result: 'denied' }).modify(inShopDates('created_at', tz, p)).count('* as n').first();

  return {
    type: 'employee_report',
    timezone: tz,
    period: p,
    employee: user,
    sales: { ...sales, by_day: byDay.map((d) => ({ date: dateOnly(d.date), count: d.count, total: n(d.total) })) },
    refunds: { count: refunds.count, total: n(refunds.total) },
    on_account: { count: onAccount.count, total: n(onAccount.total) },
    collections: {
      count: collected.reduce((s, r) => s + r.count, 0),
      total: n(collected.reduce((s, r) => s + n(r.total), 0)),
      by_method: Object.fromEntries(collected.map((r) => [r.method, n(r.total)])),
    },
    supplier_payments: { count: supplierPaid.count, total: n(supplierPaid.total) },
    reversals_made: Number(reversalsMade.n) + Number(supplierReversals.n),
    deliveries_received: { count: deliveries.count, total: n(deliveries.total) },
    stock_movements: movements.map((m) => ({ type: m.type, count: m.count, quantity: m.quantity })),
    days: {
      opened: Number(opened.n),
      closings_submitted: closings.length,
      total_variance: n(variances.reduce((s, v) => s + v, 0)),
      shortages: n(variances.filter((v) => v < 0).reduce((s, v) => s + v, 0)),
      overages: n(variances.filter((v) => v > 0).reduce((s, v) => s + v, 0)),
      attention: closings.filter((c) => c.variance_band === 'attention').length,
      critical: closings.filter((c) => c.variance_band === 'critical').length,
      closings: closings.map((c) => ({
        ...c, business_date: dateOnly(c.business_date), expected_cash: n(c.expected_cash), counted_cash: n(c.counted_cash), variance: n(c.variance),
      })),
    },
    credit_requests: creditAsked,
    access_denied: Number(denied.n),
    activity,
  };
}

const MOVEMENT_LABEL = {
  stock_in: 'Received', sold: 'Sold', transfer_in: 'Transferred in', transfer_out: 'Transferred out', damaged: 'Damaged',
  returned: 'Returned', adjustment: 'Adjusted', returned_to_supplier: 'Returned to supplier',
};

function employeeReportPdf(m, { business, generatedBy }) {
  const { rwf, signedRwf, num, when, table, pairs, heading, note, columns } = pdf;
  const tz = m.timezone;
  const e = m.employee;
  const content = [
    heading('Employee'),
    columns(
      pairs([
        ['Name', e.full_name],
        ['Role', e.role.replace(/_/g, ' ')],
        ['Status', e.status],
      ]),
      pairs([
        ['Email / phone', [e.email, e.phone].filter(Boolean).join(' · ') || '—'],
        ['Account created', when(e.created_at, tz, { time: false })],
        ['Last sign-in', when(e.last_login_at, tz)],
      ]),
    ),
    heading('Sales and money handled'),
    columns(
      pairs([
        ['Till sales', `${num(m.sales.count)} · ${rwf(m.sales.total)}`, { bold: true }],
        ['Voided sales', `${num(m.sales.voids.count)} · ${rwf(m.sales.voids.total)}`],
        ['Refunds / returns processed', `${num(m.refunds.count)} · ${rwf(m.refunds.total)}`],
        ['Sold on account', `${num(m.on_account.count)} · ${rwf(m.on_account.total)}`],
      ]),
      pairs([
        ['Client payments collected', `${num(m.collections.count)} · ${rwf(m.collections.total)}`, { bold: true }],
        ['Supplier payments recorded', `${num(m.supplier_payments.count)} · ${rwf(m.supplier_payments.total)}`],
        ['Ledger entries reversed', num(m.reversals_made)],
        ['Refused access attempts', num(m.access_denied)],
      ]),
    ),
    table(
      [{ text: 'Payment method' }, { text: 'Till sales', align: 'right' }, { text: 'Client payments collected', align: 'right' }],
      Object.keys(METHOD_LABEL)
        .filter((k) => m.sales.by_method[k] || m.collections.by_method[k])
        .map((k) => [METHOD_LABEL[k], rwf(m.sales.by_method[k] || 0), rwf(m.collections.by_method[k] || 0)]),
    ),
    heading('Cash accountability'),
    pairs([
      ['Business days opened', num(m.days.opened)],
      ['Closings submitted', num(m.days.closings_submitted)],
      ['Total variance', signedRwf(m.days.total_variance), { bold: true }],
      ['Shortages / overages', `${signedRwf(m.days.shortages)} / ${signedRwf(m.days.overages)}`],
      ['Closings needing attention / critical', `${num(m.days.attention)} / ${num(m.days.critical)}`],
    ]),
    table(
      [{ text: 'Day' }, { text: 'Expected', align: 'right' }, { text: 'Counted', align: 'right' }, { text: 'Variance', align: 'right' }, { text: 'Band' }, { text: 'Explanation', width: '*' }],
      m.days.closings.map((c) => [
        `${when(c.business_date, tz, { time: false })}${c.session_no > 1 ? ` (${c.session_no})` : ''}`,
        rwf(c.expected_cash), rwf(c.counted_cash), signedRwf(c.variance), c.variance_band, c.explanation || '—',
      ]),
    ),
    heading('Stock handled'),
    pairs([['Deliveries received', `${num(m.deliveries_received.count)} · ${rwf(m.deliveries_received.total)}`]]),
    table(
      [{ text: 'Movement' }, { text: 'Entries', align: 'right' }, { text: 'Units', align: 'right' }],
      m.stock_movements.map((s) => [MOVEMENT_LABEL[s.type] || s.type, num(s.count), num(s.quantity)]),
    ),
    heading('Sales by day'),
    table(
      [{ text: 'Date' }, { text: 'Sales', align: 'right' }, { text: 'Value', align: 'right' }],
      m.sales.by_day.map((d) => [when(d.date, tz, { time: false }), num(d.count), rwf(d.total)]),
    ),
  ];
  if (m.activity) {
    content.push(heading('Activity (audit log, latest 200)'), table(
      [{ text: 'When', width: 95 }, { text: 'Action' }, { text: 'Record' }, { text: 'Result', width: 50 }],
      m.activity.map((a) => [when(a.created_at, tz), a.action, a.entity_type ? `${a.entity_type} #${a.entity_id || '—'}` : '—', a.result]),
    ));
  }
  content.push(note('Figures are read from the recorded sales, returns, ledger, stock movements and closings of the period. Variances are from the latest version of each closing the employee submitted.'));

  return pdf.layout({
    business,
    title: 'Employee report',
    subtitle: `${e.full_name} · ${when(m.period.from, tz, { time: false })} – ${when(m.period.to, tz, { time: false })}`,
    meta: [['Employee', `#${e.id}`], ['Period', `${m.period.from} – ${m.period.to}`]],
    content,
    generatedBy,
    timezone: tz,
  });
}

async function employeeReport({ userId, from, to, canSeeAudit, format, generatedBy }) {
  const model = await buildEmployeeProfile({ userId, from, to, canSeeAudit });
  if (format !== 'pdf') return { model };
  const business = await getBusiness();
  const slug = model.employee.full_name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return { model, pdf: await pdf.render(employeeReportPdf(model, { business, generatedBy })), filename: `employee-${slug}-${model.period.from}-${model.period.to}.pdf` };
}

module.exports = { employeeReport, buildEmployeeProfile };
