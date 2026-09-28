// Customer and supplier 360° profiles: identity, insights, activity, notes.
//
// Nothing here stores money. Every figure is derived from the ledger (the
// *_invoice_balances views and the append-only transaction tables), invoice
// lines, till sales and returns - the same records the rest of the app uses -
// and each insight says what it was calculated from.
const db = require('../config/db');
const { AppError } = require('../utils/AppError');
const { audit } = require('../audit/auditService');
const { diffValues } = require('../utils/sanitize');
const ledger = require('./ledger');
const { getFinanceSettings } = require('./returns');

const { n, text } = ledger;

// ---- identity ----------------------------------------------------------------

const COMMON_FIELDS = ['name', 'status', 'contact_person', 'contact_phone', 'alt_phone', 'contact_email', 'address', 'district', 'sector', 'city', 'country', 'payment_terms', 'notes'];
const PROFILE = {
  customer: {
    table: 'institutions',
    entity: 'institution',
    noun: 'Client',
    statuses: ['active', 'inactive', 'blocked'],
    fields: [...COMMON_FIELDS, 'type', 'id_number', 'assigned_user_id'],
    types: ['shop', 'school', 'individual', 'company', 'other'],
  },
  supplier: {
    table: 'suppliers',
    entity: 'supplier',
    noun: 'Supplier',
    statuses: ['active', 'inactive', 'under_review'],
    fields: [...COMMON_FIELDS, 'category', 'registration_no', 'tin'],
  },
};
const LIMITS = { notes: 2000, payment_terms: 500, address: 255, category: 100, id_number: 64, registration_no: 64, tin: 64 };
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Validates a create/update body: only known fields, trimmed, typed. */
async function cleanInput(side, body = {}, { partial = false } = {}) {
  const p = PROFILE[side];
  const out = {};
  for (const key of p.fields) {
    if (!(key in body)) continue;
    const raw = body[key];
    if (key === 'assigned_user_id') {
      if (raw === null || raw === '' || raw === undefined) { out[key] = null; continue; }
      const user = await db('users').where({ id: Number(raw) || 0 }).first('id');
      if (!user) throw new AppError('assigned_user_id is not a user', 422);
      out[key] = user.id;
      continue;
    }
    const value = raw === null || raw === undefined ? null : String(raw).trim().slice(0, LIMITS[key] || 255) || null;
    out[key] = value;
  }
  if (!partial || 'name' in out) {
    if (!out.name) throw new AppError('name is required', 422);
  }
  if (out.status === null) delete out.status;
  if (out.status && !p.statuses.includes(out.status)) throw new AppError(`status must be one of: ${p.statuses.join(', ')}`, 422);
  if (side === 'customer' && 'type' in out) {
    if (!out.type) out.type = 'other';
    if (!p.types.includes(out.type)) throw new AppError(`type must be one of: ${p.types.join(', ')}`, 422);
  }
  if (out.contact_email && !EMAIL.test(out.contact_email)) throw new AppError('contact_email is not a valid email address', 422);
  return out;
}

async function createParty({ req, side, body }) {
  const p = PROFILE[side];
  const values = await cleanInput(side, body);
  return db.transaction(async (trx) => {
    const [row] = await trx(p.table).insert(values).returning('*');
    await audit(req, { action: `${p.entity}.create`, entityType: p.entity, entityId: row.id, newValues: values }, { trx, required: true });
    return row;
  });
}

/** Edits identity fields; the audit row keeps exactly what changed (before and after). */
async function updateParty({ req, side, id, body }) {
  const p = PROFILE[side];
  const values = await cleanInput(side, body, { partial: true });
  return db.transaction(async (trx) => {
    const before = await trx(p.table).where({ id: Number(id) || 0 }).forUpdate().first();
    if (!before) throw new AppError(`${p.noun} not found`, 404);
    const { oldValues, newValues, changed } = diffValues(before, values);
    if (!changed) return before;
    const [row] = await trx(p.table).where({ id: before.id }).update({ ...newValues, updated_at: trx.fn.now() }).returning('*');
    await audit(req, {
      action: `${p.entity}.update`, entityType: p.entity, entityId: row.id, oldValues, newValues,
      metadata: newValues.status ? { status_change: `${oldValues.status} -> ${newValues.status}` } : undefined,
    }, { trx, required: true });
    return row;
  });
}

async function withAssignee(row) {
  if (!row?.assigned_user_id) return row;
  const user = await db('users').where({ id: row.assigned_user_id }).first('full_name');
  return { ...row, assigned_user_name: user?.full_name || null };
}

// ---- insights ------------------------------------------------------------------

const DAY = 86400000;
// Postgres DATEs arrive as local-midnight Date objects: format in local time, never UTC
const pad = (v) => String(v).padStart(2, '0');
const iso = (d) => {
  if (!d) return null;
  if (d instanceof Date) return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return String(d).slice(0, 10);
};
const daysBetween = (a, b) => Math.round((Date.parse(iso(b)) - Date.parse(iso(a))) / DAY);
const inPeriod = (date, from, to) => (!from || iso(date) >= from) && (!to || iso(date) <= to);
const avg = (list) => (list.length ? n(list.reduce((s, v) => s + v, 0) / list.length) : null);

function parsePeriod(from, to) {
  const ok = (v) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) ? v : null);
  return { from: ok(from), to: ok(to) };
}

/**
 * When each invoice was settled, from its own history: the date of the entry
 * after which the balance stayed at or below zero. Uses the same event order
 * as the invoice's "balance after" column.
 */
async function settlementDates(s, invoices, txns, returns) {
  const out = new Map();
  for (const inv of invoices) {
    const own = txns.filter((t) => t.invoice_id === inv.id || t.source_invoice_id === inv.id).map((t) => ({ ...t }));
    const rets = returns.filter((r) => r.invoice_id === inv.id).map((r) => ({ ...r }));
    ledger.withRunningBalance(s, inv, own, rets);
    const events = [
      ...own.map((t) => ({ date: t.txn_date, at: t.created_at, balance: t.balance_after })),
      ...rets.filter((r) => r.balance_after !== undefined).map((r) => ({ date: r.return_date, at: r.decided_at || r.created_at, balance: r.balance_after })),
    ].sort((a, b) => new Date(a.at) - new Date(b.at));
    const payments = own.filter((t) => t.type === 'payment' && !t.reversed_by).length;
    let settled = null;
    for (const e of events) settled = e.balance <= 0 ? (settled || e.date) : null;
    out.set(inv.id, { settled_on: inv.balance <= 0 ? iso(settled || inv.invoice_date) : null, payments });
  }
  return out;
}

/** Facts about how an account pays: on time vs late, days to pay, instalments, what is overdue now. */
function paymentBehaviour(invoices, settled) {
  const today = iso(new Date());
  const closed = invoices.filter((i) => settled.get(i.id)?.settled_on);
  const withDue = closed.filter((i) => i.due_date);
  const onTime = withDue.filter((i) => settled.get(i.id).settled_on <= iso(i.due_date));
  const late = withDue.filter((i) => settled.get(i.id).settled_on > iso(i.due_date));
  const open = invoices.filter((i) => i.balance > 0);
  const overdue = open.filter((i) => i.due_date && iso(i.due_date) < today)
    .map((i) => ({ id: i.id, invoice_date: iso(i.invoice_date), due_date: iso(i.due_date), balance: i.balance, days_overdue: daysBetween(i.due_date, today) }))
    .sort((a, b) => b.days_overdue - a.days_overdue);
  const largest = open.reduce((m, i) => (!m || i.balance > m.balance ? i : m), null);
  const nextDue = open.filter((i) => i.due_date && iso(i.due_date) >= today).sort((a, b) => iso(a.due_date).localeCompare(iso(b.due_date)))[0];
  return {
    settled_invoices: closed.length,
    settled_with_due_date: withDue.length,
    paid_on_time: { count: onTime.length, amount: n(onTime.reduce((s, i) => s + i.total_amount, 0)) },
    paid_late: { count: late.length, amount: n(late.reduce((s, i) => s + i.total_amount, 0)) },
    avg_days_to_pay: avg(closed.map((i) => Math.max(0, daysBetween(i.invoice_date, settled.get(i.id).settled_on)))),
    avg_days_late: avg(late.map((i) => daysBetween(i.due_date, settled.get(i.id).settled_on))),
    paid_in_instalments: invoices.filter((i) => (settled.get(i.id)?.payments || 0) > 1).length,
    instalments: invoices.reduce((s, i) => s + (settled.get(i.id)?.payments || 0), 0),
    open_invoices: open.length,
    overdue_invoices: overdue,
    largest_outstanding: largest ? { id: largest.id, balance: largest.balance, invoice_date: iso(largest.invoice_date) } : null,
    next_due: nextDue ? { id: nextDue.id, due_date: iso(nextDue.due_date), balance: nextDue.balance } : null,
  };
}

function productTotals(lines) {
  const map = new Map();
  for (const l of lines) {
    const row = map.get(l.product_id) || { product_id: l.product_id, product_name: l.product_name, sku: l.sku, category: l.category, quantity: 0, value: 0, times: 0, last_date: null };
    row.quantity += l.quantity;
    row.value = n(row.value + l.value);
    row.times += 1;
    if (!row.last_date || iso(l.date) > row.last_date) row.last_date = iso(l.date);
    map.set(l.product_id, row);
  }
  return [...map.values()];
}

function monthly(entries, months = 12) {
  const now = new Date();
  const keys = [];
  for (let i = months - 1; i >= 0; i -= 1) {
    keys.push(iso(new Date(now.getFullYear(), now.getMonth() - i, 1)).slice(0, 7));
  }
  const totals = Object.fromEntries(keys.map((k) => [k, 0]));
  for (const e of entries) {
    const k = iso(e.date).slice(0, 7);
    if (k in totals) totals[k] = n(totals[k] + e.value);
  }
  return keys.map((month) => ({ month, value: totals[month] }));
}

async function customerInsights({ s, party, from, to }) {
  const statement = await ledger.statement({ s, partyId: party.id });
  const invoices = statement.invoices;
  const txns = await ledger.transactionsFor(s, { [`t.${s.party}`]: party.id });
  const returns = await ledger.returnsFor(s, { [`r.${s.party}`]: party.id });
  const settled = await settlementDates(s, invoices, txns, returns);

  const orderLines = invoices.length ? await db('institution_order_items as it')
    .join('institution_orders as o', 'o.id', 'it.order_id')
    .join('products as p', 'p.id', 'it.product_id')
    .leftJoin('categories as c', 'c.id', 'p.category_id')
    .where('o.institution_id', party.id)
    .select('it.product_id', 'it.quantity', 'it.unit_price', 'o.order_date as date', 'o.id as invoice_id', 'p.name as product_name', 'p.sku', 'c.name as category') : [];
  const tillSales = await db('sales').where({ institution_id: party.id }).whereNot({ status: 'voided' }).select('id', 'created_at', 'total_amount');
  const tillLines = tillSales.length ? await db('sale_items as si')
    .join('sales as sa', 'sa.id', 'si.sale_id')
    .join('products as p', 'p.id', 'si.product_id')
    .leftJoin('categories as c', 'c.id', 'p.category_id')
    .whereIn('si.sale_id', tillSales.map((x) => x.id))
    .select('si.product_id', 'si.quantity', 'si.unit_price', 'sa.created_at as date', 'p.name as product_name', 'p.sku', 'c.name as category') : [];

  // Each invoice's discount is spread over its lines, as for returns
  const factor = new Map(invoices.map((i) => {
    const sub = orderLines.filter((l) => l.invoice_id === i.id).reduce((acc, l) => acc + l.quantity * Number(l.unit_price), 0);
    return [i.id, sub > 0 ? i.total_amount / sub : 1];
  }));
  const lines = [
    ...orderLines.map((l) => ({ ...l, value: n(l.quantity * Number(l.unit_price) * factor.get(l.invoice_id)) })),
    ...tillLines.map((l) => ({ ...l, value: n(l.quantity * Number(l.unit_price)) })),
  ].filter((l) => inPeriod(l.date, from, to));

  const purchases = [
    ...invoices.map((i) => ({ kind: 'invoice', id: i.id, date: iso(i.invoice_date), value: i.total_amount })),
    ...tillSales.map((x) => ({ kind: 'till', id: x.id, date: iso(x.created_at), value: n(x.total_amount) })),
  ].sort((a, b) => a.date.localeCompare(b.date));
  const inRange = purchases.filter((p) => inPeriod(p.date, from, to));
  const dates = [...new Set(inRange.map((p) => p.date))];
  const gaps = dates.slice(1).map((d, i) => daysBetween(dates[i], d));
  const products = productTotals(lines);
  const categories = new Map();
  for (const p of products) {
    const key = p.category || null;
    const c = categories.get(key) || { category: key, quantity: 0, value: 0 };
    c.quantity += p.quantity;
    c.value = n(c.value + p.value);
    categories.set(key, c);
  }
  const approvedReturns = returns.filter((r) => r.status === 'approved' && inPeriod(r.return_date, from, to));
  const returned = productTotals(approvedReturns.flatMap((r) => r.items.map((i) => ({ ...i, date: r.return_date, value: i.line_value }))));
  const settings = await getFinanceSettings();
  const lastPurchase = purchases.length ? purchases[purchases.length - 1].date : null;
  const lifetime = n(purchases.reduce((acc, p) => acc + p.value, 0));

  const summary = statement.summary;
  const discounts = n(invoices.reduce((acc, i) => acc + (i.discount_amount || 0), 0));
  return {
    period: { from, to, first_activity: purchases[0]?.date || null },
    financial: {
      ...summary,
      lifetime_purchases: lifetime,
      invoice_count: invoices.length,
      till_purchase_count: tillSales.length,
      till_purchases: n(tillSales.reduce((acc, x) => acc + Number(x.total_amount), 0)),
      discounts,
      avg_purchase: purchases.length ? n(lifetime / purchases.length) : null,
      last_payment_date: iso(txns.filter((t) => t.type === 'payment' && !t.reversed_by).map((t) => iso(t.txn_date)).sort().pop()),
      // share of what was owed on invoices (after returns) that has been paid or credited
      completion_rate: summary.invoiced - summary.returns > 0 ? n(Math.min(1, (summary.invoiced - summary.returns - summary.owed) / (summary.invoiced - summary.returns))) : null,
    },
    behaviour: paymentBehaviour(invoices, settled),
    purchasing: {
      purchases: inRange.length,
      value: n(inRange.reduce((acc, p) => acc + p.value, 0)),
      last_purchase_date: lastPurchase,
      days_since_last_purchase: lastPurchase ? daysBetween(lastPurchase, new Date()) : null,
      inactive_after_days: settings.inactive_customer_days,
      inactive: lastPurchase ? daysBetween(lastPurchase, new Date()) > settings.inactive_customer_days : false,
      avg_days_between_purchases: avg(gaps),
      highest_purchase: inRange.reduce((m, p) => (!m || p.value > m.value ? p : m), null),
      top_products: [...products].sort((a, b) => b.quantity - a.quantity || b.value - a.value).slice(0, 10),
      top_categories: [...categories.values()].sort((a, b) => b.value - a.value).slice(0, 6),
      recent_products: [...products].sort((a, b) => b.last_date.localeCompare(a.last_date)).slice(0, 6),
      most_returned: [...returned].sort((a, b) => b.quantity - a.quantity).slice(0, 5),
      monthly: monthly(purchases),
      yearly: Object.entries(purchases.reduce((acc, p) => ({ ...acc, [p.date.slice(0, 4)]: n((acc[p.date.slice(0, 4)] || 0) + p.value) }), {}))
        .map(([year, value]) => ({ year, value })).sort((a, b) => b.year.localeCompare(a.year)),
    },
  };
}

async function supplierInsights({ s, party, from, to }) {
  const statement = await ledger.statement({ s, partyId: party.id });
  const invoices = statement.invoices;
  const txns = await ledger.transactionsFor(s, { [`t.${s.party}`]: party.id });
  const returns = await ledger.returnsFor(s, { [`r.${s.party}`]: party.id });
  const settled = await settlementDates(s, invoices, txns, returns);

  const lines = (invoices.length ? await db('supplier_delivery_items as it')
    .join('supplier_deliveries as d', 'd.id', 'it.delivery_id')
    .join('products as p', 'p.id', 'it.product_id')
    .leftJoin('categories as c', 'c.id', 'p.category_id')
    .where('d.supplier_id', party.id)
    .select('it.product_id', 'it.quantity', 'it.unit_cost', 'd.delivery_date as date', 'd.id as invoice_id', 'p.name as product_name', 'p.sku', 'c.name as category')
    .orderBy('d.delivery_date').orderBy('d.id') : [])
    .map((l) => ({ ...l, unit_cost: n(l.unit_cost), value: n(l.quantity * Number(l.unit_cost)) }));
  const periodLines = lines.filter((l) => inPeriod(l.date, from, to));
  const periodInvoices = invoices.filter((i) => inPeriod(i.invoice_date, from, to));
  const periodReturns = returns.filter((r) => inPeriod(r.return_date, from, to));

  // Cost history per product over ALL deliveries (price changes need the full series)
  const priceHistory = new Map();
  for (const l of lines) {
    const list = priceHistory.get(l.product_id) || [];
    list.push({ date: iso(l.date), invoice_id: l.invoice_id, unit_cost: l.unit_cost, quantity: l.quantity });
    priceHistory.set(l.product_id, list);
  }
  const products = productTotals(periodLines).map((p) => {
    const history = priceHistory.get(p.product_id) || [];
    const costs = history.map((h) => h.unit_cost);
    const first = history[0]?.unit_cost;
    const last = history[history.length - 1]?.unit_cost;
    return {
      ...p,
      first_cost: first, last_cost: last, min_cost: Math.min(...costs), max_cost: Math.max(...costs),
      change_pct: first > 0 ? n(((last - first) / first) * 100) : null,
      history,
    };
  }).sort((a, b) => b.value - a.value);

  const receivedQty = periodLines.reduce((acc, l) => acc + l.quantity, 0);
  const receivedValue = n(periodLines.reduce((acc, l) => acc + l.value, 0));
  const returnedQty = periodReturns.reduce((acc, r) => acc + r.items.reduce((q, i) => q + i.quantity, 0), 0);
  const returnedValue = n(periodReturns.reduce((acc, r) => acc + r.total_value, 0));
  const reasons = new Map();
  for (const r of periodReturns) {
    const row = reasons.get(r.reason) || { reason: r.reason, returns: 0, quantity: 0, value: 0 };
    row.returns += 1;
    row.quantity += r.items.reduce((q, i) => q + i.quantity, 0);
    row.value = n(row.value + r.total_value);
    reasons.set(r.reason, row);
  }
  const quality = ['damaged', 'defective', 'expired', 'poor_quality'];
  const discrepancy = ['wrong_item', 'wrong_quantity', 'duplicate_delivery'];
  const qtyFor = (list) => [...reasons.values()].filter((r) => list.includes(r.reason)).reduce((acc, r) => acc + r.quantity, 0);
  const responses = periodReturns.reduce((acc, r) => ({ ...acc, [r.supplier_response]: (acc[r.supplier_response] || 0) + 1 }), {});
  const lastDelivery = invoices[0]?.invoice_date || null; // statement lists newest first

  return {
    period: { from, to, first_activity: iso(invoices[invoices.length - 1]?.invoice_date) },
    financial: {
      ...statement.summary,
      invoice_count: invoices.length,
      fully_paid: invoices.filter((i) => i.status === 'paid').length,
      partially_paid: invoices.filter((i) => i.status === 'partial').length,
      unpaid: invoices.filter((i) => i.status === 'unpaid').length,
      refunds_received: statement.summary.refunds,
      credit_applied: n(invoices.reduce((acc, i) => acc + i.credit_applied, 0)),
      last_payment_date: iso(txns.filter((t) => t.type === 'payment' && !t.reversed_by).map((t) => iso(t.txn_date)).sort().pop()),
    },
    behaviour: paymentBehaviour(invoices, settled),
    performance: {
      deliveries: periodInvoices.length,
      purchase_value: n(periodInvoices.reduce((acc, i) => acc + i.total_amount, 0)),
      last_delivery_date: iso(lastDelivery),
      days_since_last_delivery: lastDelivery ? daysBetween(lastDelivery, new Date()) : null,
      units_received: receivedQty,
      units_returned: returnedQty,
      return_rate_units: receivedQty ? n(returnedQty / receivedQty) : null,
      return_rate_value: receivedValue ? n(returnedValue / receivedValue) : null,
      quality_issue_units: qtyFor(quality),
      quality_issue_rate: receivedQty ? n(qtyFor(quality) / receivedQty) : null,
      discrepancy_units: qtyFor(discrepancy),
      returns_by_reason: [...reasons.values()].sort((a, b) => b.value - a.value),
      supplier_responses: responses,
      monthly: monthly(invoices.map((i) => ({ date: i.invoice_date, value: i.total_amount }))),
    },
    products,
  };
}

async function loadParty(side, id) {
  const party = await db(PROFILE[side].table).where({ id: Number(id) || 0 }).first();
  if (!party) throw new AppError(`${PROFILE[side].noun} not found`, 404);
  return party;
}

/** GET /api/finance/:side/parties/:id/insights?from=&to= */
async function insights({ s, partyId, from, to }) {
  const party = await loadParty(s.side, partyId);
  const period = parsePeriod(from, to);
  return s.side === 'customer' ? customerInsights({ s, party, ...period }) : supplierInsights({ s, party, ...period });
}

// ---- activity & notes ------------------------------------------------------------

/**
 * GET /api/finance/:side/parties/:id/activity - the audit trail for the party
 * and everything recorded against its invoices (sales, payments, returns,
 * approvals, reversals), newest first.
 */
async function activity({ s, partyId, limit = 200 }) {
  const party = await loadParty(s.side, partyId);
  const p = PROFILE[s.side];
  const invoiceIds = (await db(s.invoiceTable).where({ [s.party]: party.id }).select('id')).map((r) => String(r.id));
  const rows = await db('audit_logs as a')
    .leftJoin('users as u', 'u.id', 'a.actor_user_id')
    .where((q) => {
      q.where({ 'a.entity_type': p.entity, 'a.entity_id': String(party.id) });
      if (invoiceIds.length) q.orWhere((w) => w.where('a.entity_type', s.entityType).whereIn('a.entity_id', invoiceIds));
    })
    .where('a.result', 'success')
    .select('a.id', 'a.created_at', 'a.action', 'a.entity_type', 'a.entity_id', 'a.actor_role', 'u.full_name as actor_name', 'a.old_values', 'a.new_values', 'a.metadata')
    .orderBy('a.id', 'desc')
    .limit(Math.min(Number(limit) || 200, 500));
  return rows.map((r) => ({ ...r, invoice_id: r.entity_type === s.entityType ? Number(r.entity_id) : null }));
}

/** GET /api/finance/:side/parties/:id/notes */
async function listNotes({ s, partyId }) {
  await loadParty(s.side, partyId);
  return db('party_notes as n')
    .leftJoin('users as u', 'u.id', 'n.created_by')
    .where({ 'n.side': s.side, 'n.party_id': Number(partyId) })
    .select('n.*', 'u.full_name as created_by_name')
    .orderBy('n.id', 'desc');
}

/** POST /api/finance/:side/parties/:id/notes { body, follow_up_date } - append-only */
async function addNote({ req, s, partyId, body, followUpDate }) {
  const party = await loadParty(s.side, partyId);
  const content = text(body, 2000);
  if (!content) throw new AppError('A note cannot be empty', 422);
  let followUp = null;
  if (followUpDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(followUpDate)) || Number.isNaN(Date.parse(followUpDate))) throw new AppError('follow_up_date must be a date (YYYY-MM-DD)', 422);
    followUp = String(followUpDate);
  }
  return db.transaction(async (trx) => {
    const [note] = await trx('party_notes').insert({ side: s.side, party_id: party.id, body: content, follow_up_date: followUp, created_by: req.user.id }).returning('*');
    await audit(req, {
      action: `${PROFILE[s.side].entity}.note`, entityType: PROFILE[s.side].entity, entityId: party.id,
      newValues: { note_id: note.id, body: content, follow_up_date: followUp },
    }, { trx, required: true });
    return note;
  });
}

module.exports = {
  PROFILE, cleanInput, createParty, updateParty, withAssignee, insights, activity, listNotes, addNote,
};
