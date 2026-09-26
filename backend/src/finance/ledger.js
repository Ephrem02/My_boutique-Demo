// Supplier & customer ledger: money movements against invoices.
//
// Every payment, refund, credit application and reversal is its own
// immutable row (the tables are append-only in the database). Balances are
// never stored - they come from the *_invoice_balances views - so there is no
// "paid" flag that can drift from the history.
//
// Cash transactions go through the till, so they need an OPEN business day
// and count in that day's cash reconciliation. Other methods are stamped with
// the active day when there is one, for reporting.
const db = require('../config/db');
const { AppError } = require('../utils/AppError');
const { audit } = require('../audit/auditService');
const { emit, actorName } = require('../notifications/notificationService');
const { formatRwf } = require('../utils/sanitize');
const { ACCOUNT_METHODS } = require('./sides');

const n = (v) => Math.round(Number(v || 0) * 100) / 100;
const businessDay = () => require('../businessDay/businessDayService');

function parseAmount(value, field = 'amount') {
  const v = Number(value);
  if (value === '' || value === null || value === undefined || !Number.isFinite(v) || v <= 0 || v > 1e12) {
    throw new AppError(`${field} must be a positive amount in RWF`, 422);
  }
  return n(v);
}

function parseMethod(method) {
  if (!ACCOUNT_METHODS.includes(method)) throw new AppError(`method must be one of: ${ACCOUNT_METHODS.join(', ')}`, 422);
  return method;
}

function parseDate(value, field = 'date') {
  if (value === undefined || value === null || value === '') return new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value)) || Number.isNaN(Date.parse(value))) throw new AppError(`${field} must be a date (YYYY-MM-DD)`, 422);
  if (String(value) > new Date(Date.now() + 86400000).toISOString().slice(0, 10)) throw new AppError(`${field} cannot be in the future`, 422);
  return String(value);
}

const text = (value, max) => (typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null);

/** Business day for a transaction: cash needs an OPEN day (it moves the till); others use the active day if any. */
async function dayFor(trx, method) {
  if (method === 'cash') return (await businessDay().requireOpenDay(trx)).id;
  const day = await trx('business_days').whereIn('status', businessDay().ACTIVE).first('id');
  return day ? day.id : null;
}

async function lockInvoice(trx, s, id) {
  const invoice = await trx(s.invoiceTable).where({ id: Number(id) || 0 }).forUpdate().first();
  if (!invoice) throw new AppError(`${s.side === 'supplier' ? 'Delivery' : 'Invoice'} not found`, 404);
  return invoice;
}

async function balanceOf(trx, s, invoiceId) {
  const row = await trx(s.view).where({ invoice_id: invoiceId }).first();
  return row ? normalizeBalance(row) : null;
}

function normalizeBalance(row) {
  return {
    ...row,
    total_amount: n(row.total_amount),
    returns_total: n(row.returns_total),
    amount_paid: n(row.amount_paid),
    refunds_total: n(row.refunds_total),
    credit_applied: n(row.credit_applied),
    credit_given: n(row.credit_given),
    balance: n(row.balance),
  };
}

async function partyName(trx, s, partyId) {
  const row = await trx(s.partyTable).where({ id: partyId }).first('name');
  return row?.name || `#${partyId}`;
}

const auditPrefix = (s) => (s.side === 'supplier' ? 'supplier' : 'customer');

/**
 * Inserts a payment row for an invoice already locked by the caller (used on
 * its own and for "paid on receipt" when an invoice is created).
 */
async function insertPayment(trx, { req, s, invoice, amount, method, referenceNo, txnDate, note }) {
  const businessDayId = await dayFor(trx, method);
  const [txn] = await trx(s.txns).insert({
    [s.party]: invoice[s.party], [s.invoice]: invoice.id, type: 'payment', amount, method,
    reference_no: text(referenceNo, 100), txn_date: txnDate, note: text(note, 1000), business_day_id: businessDayId, recorded_by: req.user.id,
  }).returning('*');
  const balance = await balanceOf(trx, s, invoice.id);
  const name = await partyName(trx, s, invoice[s.party]);
  await audit(req, {
    action: `${auditPrefix(s)}_payment.create`, entityType: s.entityType, entityId: invoice.id,
    newValues: { transaction_id: txn.id, amount, method, reference_no: txn.reference_no, txn_date: txnDate, balance_after: balance.balance },
    metadata: businessDayId ? { business_day_id: businessDayId } : {},
  }, { trx, required: true });

  if (s.side === 'customer') {
    await emit(trx, {
      type: 'INSTITUTION_PAYMENT_RECEIVED', dedupKey: `INSTITUTION_PAYMENT_RECEIVED:txn:${txn.id}`,
      entityType: s.entityType, entityId: invoice.id, actorUserId: req.user.id,
      params: { institution_name: name, order_id: invoice.id, amount_rwf: formatRwf(amount), balance_rwf: formatRwf(Math.max(0, balance.balance)), actor_name: await actorName(trx, req.user.id) },
    });
  }
  if (balance.balance < 0) {
    await emit(trx, {
      type: 'OVERPAYMENT', dedupKey: `OVERPAYMENT:${s.txns}:${txn.id}`,
      entityType: s.entityType, entityId: invoice.id, actorUserId: req.user.id,
      params: {
        party_type: s.side === 'supplier' ? 'supplier delivery' : 'customer invoice', party_name: name, reference_id: invoice.id,
        total_rwf: formatRwf(balance.total_amount - balance.returns_total), paid_rwf: formatRwf(balance.amount_paid),
      },
    });
  }
  return { transaction: txn, invoice: balance };
}

/** POST /api/finance/:side/invoices/:id/payments { amount, method, reference_no, txn_date, note } */
async function recordPayment({ req, s, invoiceId, amount, method, referenceNo, txnDate, note }) {
  const value = parseAmount(amount);
  const how = parseMethod(method);
  const date = parseDate(txnDate, 'txn_date');
  return db.transaction(async (trx) => {
    const invoice = await lockInvoice(trx, s, invoiceId);
    return insertPayment(trx, { req, s, invoice, amount: value, method: how, referenceNo, txnDate: date, note });
  });
}

/**
 * POST /api/finance/:side/invoices/:id/refunds - money back on an invoice in
 * credit: the supplier pays us back, or we pay the customer back. Never more
 * than the credit on that invoice.
 */
async function recordRefund({ req, s, invoiceId, amount, method, referenceNo, txnDate, note }) {
  const value = parseAmount(amount);
  const how = parseMethod(method);
  const date = parseDate(txnDate, 'txn_date');
  return db.transaction(async (trx) => {
    const invoice = await lockInvoice(trx, s, invoiceId);
    const before = await balanceOf(trx, s, invoice.id);
    const credit = n(-before.balance);
    if (credit <= 0) throw new AppError('There is no credit on this invoice to refund', 409);
    if (value > credit) throw new AppError(`At most ${formatRwf(credit)} can be refunded on this invoice`, 422);
    const txn = await insertRefund(trx, { req, s, invoice, amount: value, method: how, referenceNo, txnDate: date, note });
    return { transaction: txn, invoice: await balanceOf(trx, s, invoice.id) };
  });
}

async function insertRefund(trx, { req, s, invoice, amount, method, referenceNo, txnDate, note, recordedBy = req.user.id }) {
  const businessDayId = await dayFor(trx, method);
  const [txn] = await trx(s.txns).insert({
    [s.party]: invoice[s.party], [s.invoice]: invoice.id, type: 'refund', amount, method,
    reference_no: text(referenceNo, 100), txn_date: txnDate, note: text(note, 1000), business_day_id: businessDayId, recorded_by: recordedBy,
  }).returning('*');
  await audit(req, {
    action: `${auditPrefix(s)}_refund.create`, entityType: s.entityType, entityId: invoice.id,
    newValues: { transaction_id: txn.id, amount, method, reference_no: txn.reference_no, txn_date: txnDate },
    metadata: businessDayId ? { business_day_id: businessDayId } : {},
  }, { trx, required: true });
  return txn;
}

/**
 * POST /api/finance/:side/invoices/:id/credits { source_invoice_id, amount }
 * Moves credit from one invoice of the same party (e.g. after a return) onto
 * another invoice that is still owed.
 */
async function applyCredit({ req, s, invoiceId, sourceInvoiceId, amount, note }) {
  const value = parseAmount(amount);
  if (Number(sourceInvoiceId) === Number(invoiceId)) throw new AppError('Choose a different invoice to take the credit from', 422);
  return db.transaction(async (trx) => {
    // Lock both in id order so two applications can't deadlock
    const [first, second] = [Number(invoiceId), Number(sourceInvoiceId)].sort((a, b) => a - b);
    const locked = { [first]: await lockInvoice(trx, s, first), [second]: await lockInvoice(trx, s, second) };
    const target = locked[Number(invoiceId)];
    const source = locked[Number(sourceInvoiceId)];
    if (target[s.party] !== source[s.party]) throw new AppError(`Credit can only move between invoices of the same ${s.label}`, 422);
    const available = n(-(await balanceOf(trx, s, source.id)).balance);
    const owed = n((await balanceOf(trx, s, target.id)).balance);
    if (available <= 0) throw new AppError('The source invoice has no credit', 409);
    if (owed <= 0) throw new AppError('Nothing is owed on this invoice', 409);
    if (value > available || value > owed) throw new AppError(`At most ${formatRwf(Math.min(available, owed))} can be applied`, 422);

    const [txn] = await trx(s.txns).insert({
      [s.party]: target[s.party], [s.invoice]: target.id, [s.source]: source.id, type: 'credit_applied', amount: value,
      txn_date: new Date().toISOString().slice(0, 10), note: text(note, 1000), recorded_by: req.user.id,
    }).returning('*');
    await audit(req, {
      action: `${auditPrefix(s)}_credit.apply`, entityType: s.entityType, entityId: target.id,
      newValues: { transaction_id: txn.id, amount: value, from_invoice: source.id, to_invoice: target.id },
    }, { trx, required: true });
    return { transaction: txn, invoice: await balanceOf(trx, s, target.id), source: await balanceOf(trx, s, source.id) };
  });
}

/**
 * POST /api/finance/:side/transactions/:id/reverse { reason } - the only way
 * to correct a recorded payment/refund/credit. The original stays; a reversal
 * row cancels it (once), with a reason, audited and alerted to managers.
 * For the till, a cash entry reversed on the day it was recorded drops out
 * of that day's expected cash; a later reversal leaves closed days alone.
 */
async function reverseTransaction({ req, s, txnId, reason }) {
  const why = text(reason, 1000);
  if (!why || why.length < 5) throw new AppError('A reason (at least 5 characters) is required to reverse a transaction', 422);
  return db.transaction(async (trx) => {
    const txn = await trx(s.txns).where({ id: Number(txnId) || 0 }).first();
    if (!txn) throw new AppError('Transaction not found', 404);
    if (txn.type === 'reversal') throw new AppError('A reversal cannot itself be reversed', 409);
    await lockInvoice(trx, s, txn[s.invoice]);
    if (await trx(s.txns).where({ reverses_id: txn.id }).first('id')) throw new AppError('This transaction has already been reversed', 409);

    // Stamped with the active day: reversing a cash entry on the same day it
    // was recorded takes it back out of that day's till figures.
    const active = await trx('business_days').whereIn('status', businessDay().ACTIVE).first('id');
    let reversal;
    try {
      [reversal] = await trx(s.txns).insert({
        [s.party]: txn[s.party], [s.invoice]: txn[s.invoice], type: 'reversal', amount: txn.amount, reverses_id: txn.id,
        txn_date: new Date().toISOString().slice(0, 10), note: why, business_day_id: active?.id || null, recorded_by: req.user.id,
      }).returning('*');
    } catch (err) {
      if (err.code === '23505') throw new AppError('This transaction has already been reversed', 409);
      throw err;
    }
    const name = await partyName(trx, s, txn[s.party]);
    await audit(req, {
      action: `${auditPrefix(s)}_transaction.reverse`, entityType: s.entityType, entityId: txn[s.invoice],
      oldValues: { transaction_id: txn.id, type: txn.type, amount: Number(txn.amount), method: txn.method, reference_no: txn.reference_no },
      newValues: { reversal_id: reversal.id, reason: why },
    }, { trx, required: true });
    await emit(trx, {
      type: 'LEDGER_REVERSAL', dedupKey: `LEDGER_REVERSAL:${s.txns}:${reversal.id}`,
      entityType: s.entityType, entityId: txn[s.invoice], actorUserId: req.user.id,
      params: {
        party_type: s.label, party_name: name, txn_type: txn.type, amount_rwf: formatRwf(txn.amount), reason: why,
        actor_name: await actorName(trx, req.user.id),
      },
    });
    return { reversal, invoice: await balanceOf(trx, s, txn[s.invoice]) };
  });
}

// ---------------------------------------------------------------- reads

function invoiceQuery(s, trx = db) {
  return trx(`${s.view} as b`)
    .join(`${s.invoiceTable} as i`, 'i.id', 'b.invoice_id')
    .join(`${s.partyTable} as p`, 'p.id', 'b.party_id')
    .select('i.*', 'p.name as party_name', 'b.returns_total', 'b.amount_paid', 'b.refunds_total', 'b.credit_applied', 'b.credit_given',
      'b.balance', 'b.status', 'b.overdue');
}

function presentInvoice(s, row) {
  return {
    ...row,
    ...normalizeBalance(row),
    invoice_date: row[s.invoiceDate],
    ...(row.discount_amount !== undefined && { discount_amount: n(row.discount_amount) }),
    due_date: row[s.dueDate] ?? null,
    [`${s.side === 'supplier' ? 'supplier' : 'institution'}_name`]: row.party_name,
  };
}

/** GET /api/finance/:side/invoices?party_id=&status=&overdue=1 */
async function listInvoices({ s, partyId, status, overdue }) {
  const query = invoiceQuery(s).orderBy(`i.${s.invoiceDate}`, 'desc').orderBy('i.id', 'desc').limit(500);
  if (partyId) query.where('b.party_id', Number(partyId) || 0);
  if (status) query.where('b.status', status);
  if (overdue) query.where('b.overdue', true);
  return (await query).map((r) => presentInvoice(s, r));
}

async function transactionsFor(s, where, trx = db) {
  const rows = await trx(`${s.txns} as t`)
    .leftJoin('users as u', 'u.id', 't.recorded_by')
    .where(where)
    .select('t.*', 'u.full_name as recorded_by_name')
    .orderBy('t.id');
  const reversed = new Map(rows.filter((r) => r.reverses_id).map((r) => [String(r.reverses_id), r]));
  return rows.map((r) => ({
    ...r,
    amount: n(r.amount),
    invoice_id: r[s.invoice],
    source_invoice_id: r[s.source] ?? null,
    reversed_by: reversed.get(String(r.id))?.id ?? null,
    reversal_reason: reversed.get(String(r.id))?.note ?? null,
  }));
}

async function returnsFor(s, where, trx = db) {
  const rows = await trx(`${s.returns} as r`)
    .leftJoin('users as u', 'u.id', s.side === 'supplier' ? 'r.recorded_by' : 'r.requested_by')
    .where(where)
    .select('r.*', 'u.full_name as recorded_by_name')
    .orderBy('r.id');
  if (!rows.length) return [];
  const items = await trx(`${s.returnItems} as ri`)
    .join('products as p', 'p.id', 'ri.product_id')
    .whereIn('ri.return_id', rows.map((r) => r.id))
    .select('ri.*', 'p.name as product_name', 'p.sku');
  const deciders = s.side === 'customer'
    ? new Map((await trx('users').whereIn('id', rows.map((r) => r.decided_by).filter(Boolean)).select('id', 'full_name')).map((u) => [u.id, u.full_name]))
    : new Map((await trx('users').whereIn('id', rows.map((r) => r.responded_by).filter(Boolean)).select('id', 'full_name')).map((u) => [u.id, u.full_name]));
  return rows.map((r) => ({
    ...r,
    total_value: n(r.total_value),
    refund_amount: r.refund_amount === undefined ? undefined : n(r.refund_amount),
    invoice_id: r[s.invoice],
    decided_by_name: s.side === 'customer' ? deciders.get(r.decided_by) || null : undefined,
    responded_by_name: s.side === 'supplier' ? deciders.get(r.responded_by) || null : undefined,
    items: items.filter((i) => i.return_id === r.id).map((i) => ({ ...i, line_value: n(i.quantity * Number(i[s.price])) })),
  }));
}

/** Quantities already returned per invoice line (customer: pending + approved, so a line can't be over-returned while waiting). */
async function returnedPerLine(trx, s, itemIds) {
  if (!itemIds.length) return new Map();
  const q = trx(`${s.returnItems} as ri`)
    .join(`${s.returns} as r`, 'r.id', 'ri.return_id')
    .whereIn(`ri.${s.returnItemRef}`, itemIds)
    .groupBy(`ri.${s.returnItemRef}`)
    .select(`ri.${s.returnItemRef} as item_id`, trx.raw('SUM(ri.quantity)::int as qty'));
  if (s.side === 'customer') q.whereIn('r.status', ['pending', 'approved']);
  return new Map((await q).map((r) => [r.item_id, r.qty]));
}

/** GET /api/finance/:side/invoices/:id - lines, balance breakdown, every transaction and return. */
async function invoiceDetail({ s, invoiceId }) {
  const row = await invoiceQuery(s).where('i.id', Number(invoiceId) || 0).first();
  if (!row) return null;
  const items = await db(`${s.itemsTable} as it`)
    .join('products as p', 'p.id', 'it.product_id')
    .where(`it.${s.itemInvoice}`, row.id)
    .select('it.*', 'p.name as product_name', 'p.sku')
    .orderBy('it.id');
  const returned = await returnedPerLine(db, s, items.map((i) => i.id));
  const people = await db('users').whereIn('id', [row.recorded_by, row.received_by].filter(Boolean)).select('id', 'full_name');
  const nameOf = (id) => people.find((u) => u.id === id)?.full_name || null;
  const subtotal = n(items.reduce((sum, i) => sum + i.quantity * Number(i[s.price]), 0));
  return {
    ...presentInvoice(s, row),
    subtotal,
    recorded_by_name: nameOf(row.recorded_by),
    received_by_name: row.received_by ? nameOf(row.received_by) : undefined,
    items: items.map((i) => ({
      ...i,
      line_total: n(i.quantity * Number(i[s.price])),
      returned_quantity: returned.get(i.id) || 0,
      returnable_quantity: i.quantity - (returned.get(i.id) || 0),
    })),
    transactions: await transactionsFor(s, (q) => q.where(`t.${s.invoice}`, row.id).orWhere(`t.${s.source}`, row.id)),
    returns: await returnsFor(s, { [`r.${s.invoice}`]: row.id }),
  };
}

/**
 * GET /api/finance/:side/parties/:id/statement - the party's account:
 * summary, invoices, and every entry in date order with a running balance.
 */
async function statement({ s, partyId }) {
  const party = await db(s.partyTable).where({ id: Number(partyId) || 0 }).first();
  if (!party) return null;
  const invoices = (await invoiceQuery(s).where('b.party_id', party.id).orderBy(`i.${s.invoiceDate}`).orderBy('i.id')).map((r) => presentInvoice(s, r));
  const txns = await transactionsFor(s, { [`t.${s.party}`]: party.id });
  const returns = await returnsFor(s, { [`r.${s.party}`]: party.id });

  // Party-level effect of each entry (credit applications move money between
  // the party's own invoices, so they net to zero at this level).
  const reversedIds = new Set(txns.filter((t) => t.type === 'reversal').map((t) => String(t.reverses_id)));
  const effectOf = (t) => (t.type === 'payment' ? -t.amount : t.type === 'refund' ? t.amount : 0);
  const entries = [
    ...invoices.map((i) => ({ kind: 'invoice', id: `i${i.id}`, date: i.invoice_date, at: i.created_at, invoice_id: i.id, amount: i.total_amount, effect: i.total_amount })),
    ...returns.filter((r) => s.side === 'supplier' || r.status === 'approved').map((r) => ({
      kind: 'return', id: `r${r.id}`, date: r.return_date, at: r.decided_at || r.created_at, invoice_id: r.invoice_id, amount: r.total_value, effect: -r.total_value, reason: r.reason,
    })),
    ...txns.map((t) => {
      const original = t.type === 'reversal' ? txns.find((o) => String(o.id) === String(t.reverses_id)) : null;
      return {
        kind: t.type, id: `t${t.id}`, date: t.txn_date, at: t.created_at, invoice_id: t.invoice_id, amount: t.amount,
        method: t.method, reference_no: t.reference_no, recorded_by_name: t.recorded_by_name, note: t.note,
        source_invoice_id: t.source_invoice_id, reversed: reversedIds.has(String(t.id)),
        effect: original ? -effectOf(original) : effectOf(t),
      };
    }),
  ].sort((a, b) => String(a.date).localeCompare(String(b.date)) || new Date(a.at) - new Date(b.at));
  let running = 0;
  for (const e of entries) {
    running = n(running + e.effect);
    e.balance = running;
  }

  const sum = (key) => n(invoices.reduce((acc, i) => acc + i[key], 0));
  const summary = {
    invoiced: sum('total_amount'),
    returns: sum('returns_total'),
    paid: sum('amount_paid'),
    refunds: sum('refunds_total'),
    owed: n(invoices.filter((i) => i.balance > 0).reduce((acc, i) => acc + i.balance, 0)),
    credit: n(invoices.filter((i) => i.balance < 0).reduce((acc, i) => acc - i.balance, 0)),
    balance: sum('balance'),
    overdue: n(invoices.filter((i) => i.overdue).reduce((acc, i) => acc + i.balance, 0)),
    overdue_count: invoices.filter((i) => i.overdue).length,
    pending_returns: returns.filter((r) => r.status === 'pending').length,
  };
  return { party, summary, invoices: invoices.reverse(), entries: entries.reverse(), returns: returns.reverse() };
}

/** Parties with money outstanding (or credit), largest first. */
async function balancesByParty({ s }) {
  const rows = await db(`${s.view} as b`)
    .join(`${s.partyTable} as p`, 'p.id', 'b.party_id')
    .groupBy('p.id', 'p.name')
    .select('p.id as party_id', 'p.name as party_name',
      db.raw('SUM(CASE WHEN b.balance > 0 THEN b.balance ELSE 0 END) as owed'),
      db.raw('SUM(CASE WHEN b.balance < 0 THEN -b.balance ELSE 0 END) as credit'),
      db.raw('SUM(CASE WHEN b.overdue THEN b.balance ELSE 0 END) as overdue'),
      db.raw('COUNT(*) FILTER (WHERE b.balance > 0)::int as open_invoices'))
    .havingRaw('SUM(CASE WHEN b.balance <> 0 THEN 1 ELSE 0 END) > 0')
    .orderBy('owed', 'desc');
  return rows.map((r) => ({ ...r, owed: n(r.owed), credit: n(r.credit), overdue: n(r.overdue), balance_due: n(r.owed) }));
}

module.exports = {
  parseAmount, parseMethod, parseDate, text, dayFor, lockInvoice, balanceOf, insertPayment, insertRefund, partyName,
  recordPayment, recordRefund, applyCredit, reverseTransaction, listInvoices, invoiceDetail, statement, balancesByParty,
  returnedPerLine, normalizeBalance, n,
};
