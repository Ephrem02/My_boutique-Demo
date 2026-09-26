// Correction requests and adjustments for submitted closings.
//
// ORIGINAL (daily_closings, immutable) -> CORRECTION REQUEST -> MANAGER
// DECISION -> ADJUSTMENT (closing_adjustments, immutable). The closing row is
// never edited; "corrected" figures are always original + adjustments.
const db = require('../config/db');
const { AppError } = require('../utils/AppError');
const { audit } = require('../audit/auditService');
const { emit, actorName } = require('../notifications/notificationService');
const { dateOnly, dayLabel, currentClosing } = require('./businessDayService');
const { formatRwf } = require('../utils/sanitize');

// Closing figures a correction may target, and where each lives.
const FIELDS = {
  counted_cash: { label: 'counted cash', read: (c) => c.counted_cash },
  opening_float: { label: 'opening float', read: (c) => c.opening_float },
  cash_sales: { label: 'cash sales', read: (c) => c.cash_sales },
  cash_refunds: { label: 'cash refunds', read: (c) => c.cash_refunds },
  // Older closings predate account cash in the till: treat as zero
  account_cash_in: { label: 'account cash received', read: (c) => c.snapshot.cash?.account_cash_in || 0 },
  account_cash_out: { label: 'account cash paid out', read: (c) => c.snapshot.cash?.account_cash_out || 0 },
  mtn_mobile_money: { label: 'MTN Mobile Money total', read: (c) => c.snapshot.payment_methods.mtn_mobile_money },
  airtel_money: { label: 'Airtel Money total', read: (c) => c.snapshot.payment_methods.airtel_money },
  card: { label: 'card total', read: (c) => c.snapshot.payment_methods.card },
};
const CORRECTABLE_STATUSES = ['closing_submitted', 'closed', 'closed_with_adjustment'];
const n = (v) => Math.round(Number(v || 0) * 100) / 100;

/** Original, adjustments and corrected values for a closing, plus the recomputed cash reconciliation. */
function correctedView(closing, adjustments) {
  const values = {};
  for (const [field, def] of Object.entries(FIELDS)) {
    const original = n(def.read(closing));
    const delta = n(adjustments.filter((a) => a.field === field).reduce((s, a) => s + Number(a.delta), 0));
    values[field] = { original, delta, corrected: n(original + delta) };
  }
  const expected = n(values.opening_float.corrected + values.cash_sales.corrected - values.cash_refunds.corrected
    + values.account_cash_in.corrected - values.account_cash_out.corrected);
  const variance = n(values.counted_cash.corrected - expected);
  return { values, expected_cash: expected, variance, adjusted: adjustments.length > 0 };
}

async function requestCorrection({ req, dayId, field, requestedValue, reason, explanation, relatedEntityType, relatedEntityId }) {
  if (!FIELDS[field]) throw new AppError(`field must be one of: ${Object.keys(FIELDS).join(', ')}`, 422);
  const requested = Number(requestedValue);
  if (requestedValue === '' || !Number.isFinite(requested) || requested < 0 || requested > 1e12) {
    throw new AppError('requested_value must be a non-negative amount in RWF', 422);
  }
  const why = typeof reason === 'string' ? reason.trim() : '';
  if (why.length < 5) throw new AppError('A reason is required', 422);
  if (relatedEntityType && !['sale', 'return'].includes(relatedEntityType)) throw new AppError('related_entity_type must be sale or return', 422);

  return db.transaction(async (trx) => {
    const day = await trx('business_days').where({ id: dayId }).forUpdate().first();
    if (!day) throw new AppError('Business day not found', 404);
    if (!CORRECTABLE_STATUSES.includes(day.status)) throw new AppError('Corrections can only be requested after the closing is submitted', 409);
    const closing = await currentClosing(trx, day.id);
    const adjustments = await trx('closing_adjustments').where({ closing_id: closing.id });
    const current = correctedView(closing, adjustments).values[field].corrected;
    if (n(requested) === current) throw new AppError('The requested value is the same as the current value', 422);

    let request;
    try {
      [request] = await trx('closing_correction_requests').insert({
        business_day_id: day.id,
        closing_id: closing.id,
        field,
        original_value: current,
        requested_value: n(requested),
        reason: why.slice(0, 1000),
        explanation: explanation ? String(explanation).slice(0, 2000) : null,
        related_entity_type: relatedEntityType || null,
        related_entity_id: relatedEntityId ? Number(relatedEntityId) || null : null,
        requested_by: req.user.id,
      }).returning('*');
    } catch (err) {
      if (err.code === '23505') throw new AppError(`A correction to ${FIELDS[field].label} is already pending review`, 409);
      throw err;
    }

    await audit(req, {
      action: 'correction.request', entityType: 'closing_correction', entityId: request.id,
      newValues: { field, original_value: current, requested_value: n(requested), reason: why },
      metadata: { business_day_id: day.id, closing_id: closing.id },
    }, { trx, required: true });
    await emit(trx, {
      type: 'CORRECTION_REQUESTED', dedupKey: `CORRECTION_REQUESTED:${request.id}`,
      entityType: 'business_day', entityId: day.id, actorUserId: req.user.id,
      params: {
        business_date: dayLabel(day), actor_name: await actorName(trx, req.user.id), field: FIELDS[field].label,
        original_value: formatRwf(current), requested_value: formatRwf(requested), reason: why,
      },
    });
    return request;
  });
}

async function decideCorrection({ req, requestId, decision, reason }) {
  if (!['approve', 'reject'].includes(decision)) throw new AppError("decision must be 'approve' or 'reject'", 422);
  const why = typeof reason === 'string' ? reason.trim() : '';
  if (decision === 'reject' && why.length < 5) throw new AppError('A reason is required to reject a correction', 422);

  return db.transaction(async (trx) => {
    const request = await trx('closing_correction_requests').where({ id: requestId }).forUpdate().first();
    if (!request) throw new AppError('Correction request not found', 404);
    if (request.status !== 'pending') throw new AppError(`This request has already been ${request.status}`, 409);
    if (request.requested_by === req.user.id) throw new AppError('You cannot review your own correction request', 403);
    const day = await trx('business_days').where({ id: request.business_day_id }).forUpdate().first();

    const status = decision === 'approve' ? 'approved' : 'rejected';
    const [updated] = await trx('closing_correction_requests').where({ id: request.id }).update({
      status, reviewed_by: req.user.id, reviewed_at: trx.fn.now(), review_reason: why || null,
    }).returning('*');
    const meta = { business_day_id: day.id, closing_id: request.closing_id };
    await audit(req, {
      action: `correction.${decision}`, entityType: 'closing_correction', entityId: request.id,
      oldValues: { status: 'pending' }, newValues: { status, review_reason: why || null },
      metadata: meta,
    }, { trx, required: true });

    let adjustment = null;
    if (decision === 'approve') {
      const requesterName = await actorName(trx, request.requested_by);
      [adjustment] = await trx('closing_adjustments').insert({
        business_day_id: day.id,
        closing_id: request.closing_id,
        correction_request_id: request.id,
        field: request.field,
        original_value: request.original_value,
        adjusted_value: request.requested_value,
        delta: n(Number(request.requested_value) - Number(request.original_value)),
        reason: request.reason,
        requested_by: request.requested_by,
        requested_by_name: requesterName,
        approved_by: req.user.id,
        approved_by_name: req.user.full_name,
      }).returning('*');
      if (['closed', 'closed_with_adjustment'].includes(day.status)) {
        await trx('business_days').where({ id: day.id }).update({ status: 'closed_with_adjustment', updated_at: trx.fn.now() });
      }
      await audit(req, {
        action: 'adjustment.apply', entityType: 'closing_adjustment', entityId: adjustment.id,
        oldValues: { [request.field]: Number(request.original_value) },
        newValues: { [request.field]: Number(request.requested_value), delta: Number(adjustment.delta) },
        metadata: { ...meta, correction_request_id: request.id },
      }, { trx, required: true });
    }

    await emit(trx, {
      type: 'CORRECTION_DECIDED', dedupKey: `CORRECTION_DECIDED:${request.id}`,
      entityType: 'business_day', entityId: day.id, actorUserId: req.user.id, targetUserIds: [request.requested_by],
      params: {
        business_date: dayLabel(day), field: FIELDS[request.field].label, decision: status,
        reviewer_name: req.user.full_name, reason: why || '',
      },
    });
    return { request: updated, adjustment };
  });
}

async function listCorrections({ user, status, canReview }) {
  const query = db('closing_correction_requests as c')
    .join('business_days as d', 'd.id', 'c.business_day_id')
    .join('users as r', 'r.id', 'c.requested_by')
    .leftJoin('users as v', 'v.id', 'c.reviewed_by')
    .select('c.*', 'd.business_date', 'd.session_no', 'r.full_name as requested_by_name', 'v.full_name as reviewed_by_name')
    .orderBy('c.id', 'desc')
    .limit(200);
  if (!canReview) query.where('c.requested_by', user.id); // requesters only see their own
  if (status) query.where('c.status', status);
  const rows = await query;
  return rows.map((r) => ({ ...r, business_date: dateOnly(r.business_date), field_label: FIELDS[r.field]?.label || r.field }));
}

module.exports = { FIELDS, correctedView, requestCorrection, decideCorrection, listCorrections };
