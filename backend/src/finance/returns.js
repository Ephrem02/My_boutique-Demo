// Goods going back: to suppliers (payable goes down, stock leaves the shop)
// and from customers (receivable goes down, stock comes back or is written
// off, optional refund). Both reference the original invoice line, and a line
// can never be returned more than was received/sold.
const db = require('../config/db');
const { AppError } = require('../utils/AppError');
const { audit } = require('../audit/auditService');
const { emit, actorName } = require('../notifications/notificationService');
const { formatRwf } = require('../utils/sanitize');
const { applyMovement, toPositiveInt } = require('../models/stockService');
const ledger = require('./ledger');

const { n, text } = ledger;

// ---- Finance settings (app_settings key 'finance') --------------------------
const FINANCE_DEFAULTS = {
  customer_return_approval_rwf: 100000, // customer returns worth more than this wait for a manager
};

async function getFinanceSettings(trx = db) {
  const row = await trx('app_settings').where({ key: 'finance' }).first();
  return { ...FINANCE_DEFAULTS, ...(row?.value || {}) };
}

async function updateFinanceSettings({ req, input }) {
  const current = await getFinanceSettings();
  const next = { ...current };
  const unknown = Object.keys(input || {}).filter((k) => !(k in FINANCE_DEFAULTS));
  if (unknown.length) throw new AppError(`unknown settings: ${unknown.join(', ')}`, 422);
  if (input.customer_return_approval_rwf !== undefined) {
    const v = Number(input.customer_return_approval_rwf);
    if (!Number.isFinite(v) || v < 0 || v > 1e12) throw new AppError('customer_return_approval_rwf must be a non-negative amount', 422);
    next.customer_return_approval_rwf = Math.round(v);
  }
  await db.transaction(async (trx) => {
    await trx('app_settings').insert({ key: 'finance', value: JSON.stringify(next) }).onConflict('key').merge();
    await audit(req, { action: 'finance_settings.update', entityType: 'settings', oldValues: current, newValues: next }, { trx, required: true });
  });
  return next;
}

// ---- helpers ------------------------------------------------------------------

function parseReason(s, reason) {
  if (!s.reasons.includes(reason)) throw new AppError(`reason must be one of: ${s.reasons.join(', ')}`, 422);
  return reason;
}

async function locationId(trx, value, fallback = 'store_room') {
  if (value) {
    const loc = await trx('stock_locations').where({ id: Number(value) || 0 }).first('id');
    if (!loc) throw new AppError('Unknown stock location', 422);
    return loc.id;
  }
  const loc = await trx('stock_locations').where({ name: fallback }).first('id');
  if (!loc) throw new AppError(`${fallback} location is not configured`);
  return loc.id;
}

/** Validates requested lines against the invoice: they must belong to it and not exceed what's still returnable. */
async function resolveLines(trx, s, invoice, requested) {
  if (!Array.isArray(requested) || !requested.length) throw new AppError('Choose at least one item to return', 422);
  const ids = requested.map((l) => Number(l.item_id ?? l[s.returnItemRef]) || 0);
  if (new Set(ids).size !== ids.length) throw new AppError('Each invoice line can appear only once', 422);
  // No row lock needed (lines are insert-only): the caller holds the invoice lock,
  // which serializes every return against this invoice.
  const lines = await trx(s.itemsTable).whereIn('id', ids).where(s.itemInvoice, invoice.id);
  if (lines.length !== ids.length) throw new AppError('Some items are not on this invoice', 422);
  const returned = await ledger.returnedPerLine(trx, s, ids);
  return requested.map((l, idx) => {
    const line = lines.find((x) => x.id === ids[idx]);
    const qty = toPositiveInt(l.quantity);
    const remaining = line.quantity - (returned.get(line.id) || 0);
    if (qty > remaining) {
      throw new AppError(remaining > 0 ? `Only ${remaining} of line #${line.id} can still be returned` : `Line #${line.id} has already been fully returned`, 422);
    }
    return { line, qty, input: l };
  });
}

// ---- Supplier returns -----------------------------------------------------------

/**
 * POST /api/finance/supplier/invoices/:id/returns
 * { items: [{ item_id, quantity, location_id? }], reason, notes, return_date }
 * Stock leaves at once (default: store room) and the payable drops by the
 * returned value. If the invoice was already paid it goes into credit, which a
 * manager later settles as a supplier refund or applies to another invoice.
 */
async function createSupplierReturn({ req, s, invoiceId, items, reason, notes, returnDate }) {
  const why = parseReason(s, reason);
  const date = ledger.parseDate(returnDate, 'return_date');
  return db.transaction(async (trx) => {
    const invoice = await ledger.lockInvoice(trx, s, invoiceId);
    const lines = await resolveLines(trx, s, invoice, items);
    const dayId = await businessDayId(trx);
    const value = n(lines.reduce((sum, l) => sum + l.qty * Number(l.line.unit_cost), 0));

    const [ret] = await trx('supplier_returns').insert({
      supplier_id: invoice.supplier_id, delivery_id: invoice.id, return_date: date, reason: why, notes: text(notes, 1000),
      total_value: value, business_day_id: dayId, recorded_by: req.user.id,
    }).returning('*');
    for (const l of lines) {
      const loc = await locationId(trx, l.input.location_id);
      await trx('supplier_return_items').insert({
        return_id: ret.id, delivery_item_id: l.line.id, product_id: l.line.product_id, location_id: loc, quantity: l.qty, unit_cost: l.line.unit_cost,
      });
      await applyMovement({
        productId: l.line.product_id, locationId: loc, type: 'returned_to_supplier', quantity: l.qty,
        referenceType: 'supplier_return', referenceId: ret.id, performedBy: req.user.id, notes: `Returned to supplier: ${why}`,
      }, trx);
    }

    const balance = await ledger.balanceOf(trx, s, invoice.id);
    const supplierName = await ledger.partyName(trx, s, invoice.supplier_id);
    await audit(req, {
      action: 'supplier_return.create', entityType: s.entityType, entityId: invoice.id,
      newValues: { return_id: ret.id, reason: why, value, items: lines.map((l) => ({ item_id: l.line.id, quantity: l.qty })), balance_after: balance.balance },
      metadata: dayId ? { business_day_id: dayId } : {},
    }, { trx, required: true });
    await emit(trx, {
      type: 'SUPPLIER_RETURN_RECORDED', dedupKey: `SUPPLIER_RETURN_RECORDED:${ret.id}`,
      entityType: s.entityType, entityId: invoice.id, actorUserId: req.user.id,
      params: { supplier_name: supplierName, delivery_id: invoice.id, value_rwf: formatRwf(value), reason: why.replace(/_/g, ' '), actor_name: await actorName(trx, req.user.id) },
    });
    return { return: { ...ret, total_value: value }, invoice: balance };
  });
}

/** POST /api/finance/supplier/returns/:id/response { response: accepted|disputed, note } */
async function recordSupplierResponse({ req, returnId, response, note }) {
  if (!['accepted', 'disputed'].includes(response)) throw new AppError("response must be 'accepted' or 'disputed'", 422);
  return db.transaction(async (trx) => {
    const ret = await trx('supplier_returns').where({ id: Number(returnId) || 0 }).forUpdate().first();
    if (!ret) throw new AppError('Return not found', 404);
    const [updated] = await trx('supplier_returns').where({ id: ret.id }).update({
      supplier_response: response, response_note: text(note, 1000), responded_by: req.user.id, responded_at: trx.fn.now(),
    }).returning('*');
    await audit(req, {
      action: 'supplier_return.response', entityType: 'supplier_delivery', entityId: ret.delivery_id,
      oldValues: { return_id: ret.id, supplier_response: ret.supplier_response }, newValues: { supplier_response: response, note: updated.response_note },
    }, { trx, required: true });
    return updated;
  });
}

async function businessDayId(trx) {
  const { ACTIVE } = require('../businessDay/businessDayService');
  const day = await trx('business_days').whereIn('status', ACTIVE).first('id');
  return day ? day.id : null;
}

// ---- Customer returns -----------------------------------------------------------

/**
 * POST /api/finance/customer/invoices/:id/returns
 * { items: [{ item_id, quantity, restock, location_id? }], reason, notes, return_date,
 *   refund: { amount, method, reference_no } }
 * Returns worth more than the approval limit wait for a store manager (unless
 * a manager records them); nothing moves until approved. The return value is
 * pro-rated for any invoice discount.
 */
async function createCustomerReturn({ req, s, invoiceId, items, reason, notes, returnDate, refund }) {
  const why = parseReason(s, reason);
  const date = ledger.parseDate(returnDate, 'return_date');
  const refundAmount = refund && Number(refund.amount) > 0 ? ledger.parseAmount(refund.amount, 'refund amount') : 0;
  const refundMethod = refundAmount ? ledger.parseMethod(refund.method) : null;
  const settings = await getFinanceSettings();

  const result = await db.transaction(async (trx) => {
    const invoice = await ledger.lockInvoice(trx, s, invoiceId);
    const lines = await resolveLines(trx, s, invoice, items);
    const subtotal = n((await trx('institution_order_items').where({ order_id: invoice.id }).select('quantity', 'unit_price'))
      .reduce((sum, i) => sum + i.quantity * Number(i.unit_price), 0));
    const factor = subtotal > 0 ? Number(invoice.total_amount) / subtotal : 0; // spreads the invoice discount
    const value = n(lines.reduce((sum, l) => sum + l.qty * Number(l.line.unit_price) * factor, 0));
    if (value <= 0) throw new AppError('These items have no value to return', 422);
    if (refundAmount > value) throw new AppError('The refund cannot be more than the value of the returned goods', 422);

    const locs = [];
    for (const l of lines) locs.push(l.input.restock === false ? null : await locationId(trx, l.input.location_id));

    const canApprove = req.user.permissions.includes('customer_returns.approve');
    const autoApprove = canApprove || value <= settings.customer_return_approval_rwf;
    const [ret] = await trx('customer_returns').insert({
      institution_id: invoice.institution_id, order_id: invoice.id, return_date: date, reason: why, notes: text(notes, 1000), total_value: value,
      status: 'pending', refund_amount: refundAmount, refund_method: refundMethod, refund_reference: text(refund?.reference_no, 100),
      requested_by: req.user.id,
    }).returning('*');
    await trx('customer_return_items').insert(lines.map((l, i) => ({
      return_id: ret.id, order_item_id: l.line.id, product_id: l.line.product_id, quantity: l.qty, unit_price: l.line.unit_price,
      restock: locs[i] !== null, location_id: locs[i],
    })));
    await audit(req, {
      action: 'customer_return.create', entityType: s.entityType, entityId: invoice.id,
      newValues: { return_id: ret.id, reason: why, value, refund_amount: refundAmount, refund_method: refundMethod, needs_approval: !autoApprove },
    }, { trx, required: true });

    const customerName = await ledger.partyName(trx, s, invoice.institution_id);
    if (autoApprove) {
      return { ret: await applyCustomerReturn(trx, { req, s, ret, invoice, approval: 'auto', decidedBy: null }), approved: true };
    }
    await emit(trx, {
      type: 'CUSTOMER_RETURN_APPROVAL_NEEDED', dedupKey: `CUSTOMER_RETURN_APPROVAL_NEEDED:${ret.id}`,
      entityType: s.entityType, entityId: invoice.id, actorUserId: req.user.id,
      params: { customer_name: customerName, order_id: invoice.id, value_rwf: formatRwf(value), reason: why.replace(/_/g, ' '), actor_name: await actorName(trx, req.user.id) },
    });
    return { ret, approved: false };
  });
  return { return: result.ret, pending_approval: !result.approved, invoice: await ledger.balanceOf(db, s, invoiceId) };
}

/** Moves stock back, credits the invoice and pays any refund - on approval (or at once within the limit). */
async function applyCustomerReturn(trx, { req, s, ret, invoice, approval, decidedBy, note }) {
  const dayId = await businessDayId(trx);
  const [updated] = await trx('customer_returns').where({ id: ret.id }).update({
    status: 'approved', approval, decided_by: decidedBy, decided_at: trx.fn.now(), decision_note: text(note, 1000), business_day_id: dayId,
  }).returning('*');
  const items = await trx('customer_return_items').where({ return_id: ret.id });
  for (const item of items.filter((i) => i.restock)) {
    await applyMovement({
      productId: item.product_id, locationId: item.location_id, type: 'returned', quantity: item.quantity,
      referenceType: 'customer_return', referenceId: ret.id, performedBy: req.user.id, notes: `Customer return: ${ret.reason}`,
    }, trx);
  }
  if (Number(ret.refund_amount) > 0) {
    const credit = n(-(await ledger.balanceOf(trx, s, invoice.id)).balance);
    if (Number(ret.refund_amount) > credit) {
      throw new AppError(
        credit > 0
          ? `Only ${formatRwf(credit)} can be refunded - the customer has not paid more than that for this invoice. Leave the rest as credit.`
          : 'The customer has not paid for these goods yet, so nothing can be refunded - the return reduces what they owe instead.',
        422
      );
    }
    await ledger.insertRefund(trx, {
      req, s, invoice, amount: n(ret.refund_amount), method: ret.refund_method, referenceNo: ret.refund_reference,
      txnDate: new Date().toISOString().slice(0, 10), note: `Refund for return #${ret.id}`,
    });
  }
  await audit(req, {
    action: 'customer_return.approve', entityType: s.entityType, entityId: invoice.id,
    oldValues: { return_id: ret.id, status: ret.status }, newValues: { status: 'approved', approval, note: updated.decision_note },
    metadata: dayId ? { business_day_id: dayId } : {},
  }, { trx, required: true });
  return updated;
}

/** POST /api/finance/customer/returns/:id/decision { decision: approve|reject, note } - managers, never on their own request. */
async function decideCustomerReturn({ req, s, returnId, decision, note }) {
  if (!['approve', 'reject'].includes(decision)) throw new AppError("decision must be 'approve' or 'reject'", 422);
  const why = text(note, 1000);
  if (decision === 'reject' && (!why || why.length < 3)) throw new AppError('A reason is required to reject a return', 422);
  return db.transaction(async (trx) => {
    const ret = await trx('customer_returns').where({ id: Number(returnId) || 0 }).forUpdate().first();
    if (!ret) throw new AppError('Return not found', 404);
    if (ret.status !== 'pending') throw new AppError(`This return has already been ${ret.status}`, 409);
    if (ret.requested_by === req.user.id) throw new AppError('You cannot approve or reject a return you recorded', 403);
    const invoice = await ledger.lockInvoice(trx, s, ret.order_id);

    let updated;
    if (decision === 'approve') {
      updated = await applyCustomerReturn(trx, { req, s, ret, invoice, approval: 'manager', decidedBy: req.user.id, note: why });
    } else {
      [updated] = await trx('customer_returns').where({ id: ret.id }).update({
        status: 'rejected', decided_by: req.user.id, decided_at: trx.fn.now(), decision_note: why,
      }).returning('*');
      await audit(req, {
        action: 'customer_return.reject', entityType: s.entityType, entityId: invoice.id,
        oldValues: { return_id: ret.id, status: 'pending' }, newValues: { status: 'rejected', note: why },
      }, { trx, required: true });
    }
    await emit(trx, {
      type: 'CUSTOMER_RETURN_DECIDED', dedupKey: `CUSTOMER_RETURN_DECIDED:${ret.id}`,
      entityType: s.entityType, entityId: invoice.id, actorUserId: req.user.id, targetUserIds: [ret.requested_by],
      params: {
        customer_name: await ledger.partyName(trx, s, invoice.institution_id), order_id: invoice.id,
        decision: decision === 'approve' ? 'approved' : 'rejected', reviewer_name: req.user.full_name, note: why || '',
      },
    });
    return { return: updated, invoice: await ledger.balanceOf(trx, s, invoice.id) };
  });
}

/** GET /api/finance/customer/returns?status=pending - for the manager's approval queue. */
async function listCustomerReturns({ status }) {
  const q = db('customer_returns as r')
    .join('institutions as p', 'p.id', 'r.institution_id')
    .leftJoin('users as u', 'u.id', 'r.requested_by')
    .select('r.*', 'p.name as customer_name', 'u.full_name as requested_by_name')
    .orderBy('r.id', 'desc')
    .limit(200);
  if (status) q.where('r.status', status);
  return (await q).map((r) => ({ ...r, total_value: n(r.total_value), refund_amount: n(r.refund_amount) }));
}

module.exports = {
  getFinanceSettings, updateFinanceSettings, FINANCE_DEFAULTS,
  createSupplierReturn, recordSupplierResponse, createCustomerReturn, decideCustomerReturn, listCustomerReturns,
};
