// Customer credit limits.
//
// Exposure = the client's net account balance from the ledger view
// (customer_invoice_balances): invoices - payments - APPROVED returns - credit.
// So approved returns and credit balances lower it; pending returns do not;
// and once payment verification exists, a pending (unverified) payment will
// not either, because the view will only count settled payments.
//
// The check runs inside the sale's own transaction with the client's row
// locked (FOR UPDATE), so two sales at the same moment can't both slip under
// the limit. Going over needs a manager: an approved request for today, or a
// manager approving it inline with a reason. Everything is audited.
const db = require('../config/db');
const { AppError } = require('../utils/AppError');
const { audit } = require('../audit/auditService');
const { emit, actorName } = require('../notifications/notificationService');
const { can } = require('../middleware/rbac');
const { formatRwf } = require('../utils/sanitize');
const { getClosingSettings, shopDate } = require('../businessDay/settings');
const ledger = require('./ledger');

const { n, text, parseAmount } = ledger;
const today = async (trx = db) => shopDate(await getClosingSettings(trx));
const money = (v) => (v === null || v === undefined ? null : n(v));

async function exposureOf(trx, institutionId) {
  const row = await trx('customer_invoice_balances').where({ party_id: institutionId })
    .select(
      trx.raw('COALESCE(SUM(balance), 0) AS net'),
      trx.raw('COALESCE(SUM(CASE WHEN balance > 0 THEN balance ELSE 0 END), 0) AS owed'),
      trx.raw('COALESCE(SUM(CASE WHEN overdue THEN balance ELSE 0 END), 0) AS overdue'),
    ).first();
  return { exposure: Math.max(0, n(row.net)), owed: n(row.owed), overdue: n(row.overdue) };
}

const limitOf = (institution) => (institution.credit_enabled ? money(institution.credit_limit) : 0);

/** GET /api/finance/customer/parties/:id/credit - limit, exposure, available, exceptions. */
async function creditStatus({ institutionId }) {
  const institution = await db('institutions').where({ id: Number(institutionId) || 0 }).first();
  if (!institution) throw new AppError('Client not found', 404);
  const { exposure, owed, overdue } = await exposureOf(db, institution.id);
  const limit = limitOf(institution);
  const date = await today();
  const exceptions = await listExceptions({ institutionId: institution.id, limit: 20 });
  return {
    credit_enabled: institution.credit_enabled,
    credit_limit: money(institution.credit_limit),
    effective_limit: limit, // null = no limit
    exposure,
    owed,
    overdue,
    available: limit === null ? null : n(Math.max(0, limit - exposure)),
    over_limit: limit !== null && exposure > limit,
    pending_requests: exceptions.filter((e) => e.status === 'pending' && e.business_date === date),
    approved_today: exceptions.filter((e) => e.status === 'approved' && e.business_date === date),
    recent_exceptions: exceptions,
  };
}

/**
 * Called by createOrder inside its transaction, with the institution row
 * already locked. creditAmount = the part of the sale not paid now.
 * Returns the exception to mark as used once the invoice exists (or null).
 */
async function checkSale(trx, { req, institution, creditAmount, exceptionId, overrideReason }) {
  if (creditAmount <= 0) return null;
  const limit = limitOf(institution);
  if (limit === null) return null;
  const { exposure } = await exposureOf(trx, institution.id);
  const excess = n(exposure + creditAmount - limit);
  if (excess <= 0) return null;

  const details = {
    code: institution.credit_enabled ? 'CREDIT_LIMIT_EXCEEDED' : 'CREDIT_NOT_ALLOWED',
    credit_enabled: institution.credit_enabled, limit, exposure, requested: n(creditAmount), available: n(Math.max(0, limit - exposure)), excess,
  };
  const date = await today(trx);

  if (exceptionId !== undefined && exceptionId !== null && exceptionId !== '') {
    const ex = await trx('credit_exceptions').where({ id: Number(exceptionId) || 0 }).forUpdate().first();
    if (!ex || ex.institution_id !== institution.id) throw new AppError('That credit approval is not for this client', 422, details);
    if (ex.status !== 'approved') throw new AppError(`That credit approval is ${ex.status}, not approved`, 409, details);
    if (dateOnly(ex.business_date) !== date) throw new AppError('That credit approval has expired - approvals are valid on the day they are given', 409, details);
    if (n(ex.amount) < excess) {
      throw new AppError(`That approval allows ${formatRwf(ex.amount)} over the limit, but this sale needs ${formatRwf(excess)}`, 409, details);
    }
    return ex;
  }

  if (overrideReason !== undefined && overrideReason !== null) {
    if (!can(req, 'credit.manage')) throw new AppError('Only a manager can approve going over a credit limit', 403, details);
    const why = text(overrideReason, 1000);
    if (!why || why.length < 5) throw new AppError('Give a reason (at least 5 characters) for going over the credit limit', 422, details);
    const [ex] = await trx('credit_exceptions').insert({
      institution_id: institution.id, amount: excess, reason: why, status: 'approved', approval: 'inline', business_date: date,
      requested_by: req.user.id, decided_by: req.user.id, decided_at: trx.fn.now(),
    }).returning('*');
    return ex;
  }

  const message = institution.credit_enabled
    ? `This sale would put ${institution.name} ${formatRwf(excess)} over their credit limit of ${formatRwf(limit)} (they owe ${formatRwf(exposure)} now). A manager must approve it.`
    : `${institution.name} is not allowed to buy on account. A manager must approve it.`;
  throw new AppError(message, 409, details);
}

const dateOnly = (v) => {
  if (!v) return null;
  if (v instanceof Date) return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
  return String(v).slice(0, 10);
};

/** Marks the exception used by this invoice; alerts managers when it was approved inline. */
async function useException(trx, { req, exception, order, institution, creditAmount }) {
  await trx('credit_exceptions').where({ id: exception.id }).update({ status: 'used', order_id: order.id, used_at: trx.fn.now() });
  await audit(req, {
    action: exception.approval === 'inline' ? 'credit_exception.override' : 'credit_exception.use',
    entityType: 'institution', entityId: institution.id,
    newValues: { exception_id: exception.id, order_id: order.id, over_limit_by: n(exception.amount), on_credit: n(creditAmount), reason: exception.reason },
  }, { trx, required: true });
  if (exception.approval === 'inline') {
    await emit(trx, {
      type: 'CREDIT_LIMIT_OVERRIDDEN', dedupKey: `CREDIT_LIMIT_OVERRIDDEN:${exception.id}`,
      entityType: 'institution', entityId: institution.id, actorUserId: req.user.id,
      params: { customer_name: institution.name, order_id: order.id, over_rwf: formatRwf(exception.amount), reason: exception.reason, actor_name: await actorName(trx, req.user.id) },
    });
  }
}

/** PUT /api/institutions/:id/credit { credit_enabled, credit_limit } - credit.manage only. */
async function setCredit({ req, institutionId, body = {} }) {
  const next = {};
  if ('credit_enabled' in body) {
    if (typeof body.credit_enabled !== 'boolean') throw new AppError('credit_enabled must be true or false', 422);
    next.credit_enabled = body.credit_enabled;
  }
  if ('credit_limit' in body) {
    const raw = body.credit_limit;
    if (raw === null || raw === '') next.credit_limit = null;
    else {
      const v = Number(raw);
      if (!Number.isFinite(v) || v < 0 || v > 1e12) throw new AppError('credit_limit must be a non-negative amount in RWF, or empty for no limit', 422);
      next.credit_limit = n(v);
    }
  }
  if (!Object.keys(next).length) throw new AppError('Nothing to change', 422);
  return db.transaction(async (trx) => {
    const before = await trx('institutions').where({ id: Number(institutionId) || 0 }).forUpdate().first();
    if (!before) throw new AppError('Client not found', 404);
    const oldValues = { credit_enabled: before.credit_enabled, credit_limit: money(before.credit_limit) };
    const [row] = await trx('institutions').where({ id: before.id }).update({ ...next, updated_at: trx.fn.now() }).returning('*');
    const newValues = { credit_enabled: row.credit_enabled, credit_limit: money(row.credit_limit) };
    await audit(req, {
      action: 'institution.credit_update', entityType: 'institution', entityId: row.id,
      oldValues, newValues, metadata: body.reason ? { reason: text(body.reason, 500) } : undefined,
    }, { trx, required: true });
    return { ...row, credit_limit: money(row.credit_limit) };
  });
}

/** POST /api/credit-exceptions { institution_id, amount, reason } - someone at the till asks a manager. */
async function requestException({ req, institutionId, amount, reason }) {
  const value = parseAmount(amount);
  const why = text(reason, 1000);
  if (!why || why.length < 5) throw new AppError('Give a reason (at least 5 characters)', 422);
  return db.transaction(async (trx) => {
    const institution = await trx('institutions').where({ id: Number(institutionId) || 0 }).first();
    if (!institution) throw new AppError('Client not found', 404);
    if (institution.status === 'blocked') throw new AppError(`${institution.name} is blocked: new sales on account are not allowed`, 409);
    const [ex] = await trx('credit_exceptions').insert({
      institution_id: institution.id, amount: value, reason: why, status: 'pending', approval: 'request', business_date: await today(trx), requested_by: req.user.id,
    }).returning('*');
    await audit(req, {
      action: 'credit_exception.request', entityType: 'institution', entityId: institution.id,
      newValues: { exception_id: ex.id, amount: value, reason: why },
    }, { trx, required: true });
    await emit(trx, {
      type: 'CREDIT_EXCEPTION_REQUESTED', dedupKey: `CREDIT_EXCEPTION_REQUESTED:${ex.id}`,
      entityType: 'institution', entityId: institution.id, actorUserId: req.user.id,
      params: { customer_name: institution.name, amount_rwf: formatRwf(value), reason: why, actor_name: await actorName(trx, req.user.id) },
    });
    return present(ex);
  });
}

/** POST /api/credit-exceptions/:id/decision { decision: approve|reject, note } - a manager, never the requester. */
async function decideException({ req, id, decision, note }) {
  if (!['approve', 'reject'].includes(decision)) throw new AppError('decision must be approve or reject', 422);
  const why = text(note, 1000);
  if (decision === 'reject' && (!why || why.length < 3)) throw new AppError('Give a reason for rejecting', 422);
  return db.transaction(async (trx) => {
    const ex = await trx('credit_exceptions').where({ id: Number(id) || 0 }).forUpdate().first();
    if (!ex) throw new AppError('Request not found', 404);
    if (ex.status !== 'pending') throw new AppError(`This request is already ${ex.status}`, 409);
    if (ex.requested_by === req.user.id) throw new AppError('You cannot decide your own request - another manager must', 403);
    if (dateOnly(ex.business_date) !== await today(trx)) {
      await trx('credit_exceptions').where({ id: ex.id }).update({ status: 'expired' });
      throw new AppError('This request has expired - requests are valid on the day they are made', 409);
    }
    const [row] = await trx('credit_exceptions').where({ id: ex.id }).update({
      status: decision === 'approve' ? 'approved' : 'rejected', decided_by: req.user.id, decided_at: trx.fn.now(), decision_note: why,
    }).returning('*');
    const institution = await trx('institutions').where({ id: ex.institution_id }).first();
    await audit(req, {
      action: `credit_exception.${decision}`, entityType: 'institution', entityId: ex.institution_id,
      oldValues: { status: 'pending' }, newValues: { exception_id: ex.id, status: row.status, amount: n(ex.amount), note: why },
    }, { trx, required: true });
    await emit(trx, {
      type: 'CREDIT_EXCEPTION_DECIDED', dedupKey: `CREDIT_EXCEPTION_DECIDED:${ex.id}`,
      entityType: 'institution', entityId: ex.institution_id, actorUserId: req.user.id, targetUserIds: [ex.requested_by],
      params: {
        customer_name: institution.name, amount_rwf: formatRwf(ex.amount), decision: decision === 'approve' ? 'approved' : 'rejected',
        reviewer_name: await actorName(trx, req.user.id), note: why || '',
      },
    });
    return present(row);
  });
}

function present(row) {
  return { ...row, amount: n(row.amount), business_date: dateOnly(row.business_date) };
}

/** GET /api/credit-exceptions?status=&institution_id= */
async function listExceptions({ status, institutionId, limit = 200 } = {}) {
  const q = db('credit_exceptions as e')
    .join('institutions as i', 'i.id', 'e.institution_id')
    .leftJoin('users as r', 'r.id', 'e.requested_by')
    .leftJoin('users as d', 'd.id', 'e.decided_by')
    .select('e.*', 'i.name as customer_name', 'r.full_name as requested_by_name', 'd.full_name as decided_by_name')
    .orderBy('e.id', 'desc')
    .limit(Math.min(Number(limit) || 200, 500));
  if (status) q.where('e.status', status);
  if (institutionId) q.where('e.institution_id', Number(institutionId) || 0);
  return (await q).map(present);
}

/** Worker: requests and approvals from earlier shop days lapse. */
async function expireOld() {
  return db('credit_exceptions').whereIn('status', ['pending', 'approved']).where('business_date', '<', db.raw('shop_today()')).update({ status: 'expired' });
}

module.exports = { exposureOf, creditStatus, checkSale, useException, setCredit, requestException, decideException, listExceptions, expireOld };
