// Business day opening requests - opening is a controlled business event.
//
// PENDING -> APPROVED (a manager opens the day with the requested opening
// cash) | REJECTED (reason required, day stays closed) | EXPIRED (the date
// passed, or a manager opened the day directly instead).
//
// Cashiers and store keepers can't open the day (day.open is manager-only);
// they file a request (day.open.request). A manager decides (day.open.review),
// never on their own request - enforced here and by a DB check constraint.
const db = require('../config/db');
const { AppError } = require('../utils/AppError');
const { audit } = require('../audit/auditService');
const { emit, actorName } = require('../notifications/notificationService');
const { getClosingSettings, shopDate } = require('./settings');
const { activeDay, openDayInTrx, lockOpening, parseAmount, dateOnly, dayState } = require('./businessDayService');
const { formatRwf } = require('../utils/sanitize');

const text = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

/** Pending requests for an earlier date can no longer be approved. */
async function expireStale(trx, today) {
  await trx('business_day_opening_requests').where({ status: 'pending' }).where('business_date', '<', today).update({
    status: 'expired', reviewed_at: trx.fn.now(), manager_comment: 'The requested business date has passed',
  });
}

function view(row) {
  return {
    id: row.id,
    business_date: dateOnly(row.business_date),
    opening_float: Number(row.opening_float),
    reason: row.reason,
    note: row.note,
    status: row.status,
    requested_by: row.requested_by,
    requested_by_name: row.requested_by_name,
    requested_at: row.requested_at,
    reviewed_by: row.reviewed_by,
    reviewed_by_name: row.reviewed_by_name,
    reviewed_at: row.reviewed_at,
    manager_comment: row.manager_comment,
    business_day_id: row.business_day_id,
  };
}

function withNames(query) {
  return query
    .leftJoin('users as r', 'r.id', 'q.requested_by')
    .leftJoin('users as v', 'v.id', 'q.reviewed_by')
    .select('q.*', 'r.full_name as requested_by_name', 'v.full_name as reviewed_by_name');
}

/** POST /api/business-days/opening-requests { opening_float, reason, note } */
async function createRequest({ req, openingFloat, reason, note }) {
  const float = parseAmount(openingFloat, 'opening_float');
  const why = text(reason, 500);
  if (why.length < 3) throw new AppError('A reason is required to request the business day opening', 422);
  const businessDate = shopDate(await getClosingSettings());

  return db.transaction(async (trx) => {
    await lockOpening(trx);
    if (await activeDay(trx)) throw new AppError('A business day is already open', 409);
    await expireStale(trx, businessDate);
    const pending = await withNames(trx('business_day_opening_requests as q'))
      .where({ 'q.business_date': businessDate, 'q.status': 'pending' }).first();
    if (pending) {
      throw new AppError(`An opening request for ${businessDate} is already waiting for a manager (requested by ${pending.requested_by_name})`, 409);
    }

    let request;
    try {
      [request] = await trx('business_day_opening_requests').insert({
        business_date: businessDate, opening_float: float, reason: why, note: text(note, 1000) || null, requested_by: req.user.id,
      }).returning('*');
    } catch (err) {
      if (err.code === '23505') throw new AppError(`An opening request for ${businessDate} is already waiting for a manager`, 409);
      throw err;
    }

    const requesterName = await actorName(trx, req.user.id);
    await audit(req, {
      action: 'day.open_request', entityType: 'opening_request', entityId: request.id,
      newValues: { business_date: businessDate, opening_float: float, reason: why, note: request.note, status: 'pending' },
    }, { trx, required: true });
    await emit(trx, {
      type: 'OPENING_REQUESTED', dedupKey: `OPENING_REQUESTED:${request.id}`,
      entityType: 'opening_request', entityId: request.id, actorUserId: req.user.id,
      params: { business_date: businessDate, actor_name: requesterName, reason: why, opening_float_rwf: formatRwf(float) },
    });
    return view({ ...request, requested_by_name: requesterName });
  });
}

/** GET /api/business-days/opening-requests?status= - reviewers see all, requesters their own. */
async function listRequests({ user, canReview, status }) {
  const today = shopDate(await getClosingSettings());
  await expireStale(db, today);
  const query = withNames(db('business_day_opening_requests as q')).orderBy('q.id', 'desc').limit(100);
  if (!canReview) query.where('q.requested_by', user.id);
  if (status) query.where('q.status', status);
  return (await query).map(view);
}

async function lockRequest(trx, id, req) {
  const request = await trx('business_day_opening_requests').where({ id }).forUpdate().first();
  if (!request) throw new AppError('Opening request not found', 404);
  if (request.status !== 'pending') throw new AppError(`This request has already been ${request.status}`, 409);
  if (request.requested_by === req.user.id) throw new AppError('You cannot decide your own opening request', 403);
  return request;
}

async function notifyRequester(trx, { req, request, decision, comment }) {
  await emit(trx, {
    type: 'OPENING_REQUEST_DECIDED', dedupKey: `OPENING_REQUEST_DECIDED:${request.id}`,
    entityType: 'opening_request', entityId: request.id, actorUserId: req.user.id, targetUserIds: [request.requested_by],
    params: { business_date: dateOnly(request.business_date), decision, reviewer_name: req.user.full_name, comment: comment || '' },
  });
}

/** POST /api/business-days/opening-requests/:id/approve { comment } - opens the day. */
async function approveRequest({ req, id, comment }) {
  const note = text(comment, 1000);
  const today = shopDate(await getClosingSettings());

  return db.transaction(async (trx) => {
    await lockOpening(trx);
    const request = await lockRequest(trx, id, req);
    if (dateOnly(request.business_date) !== today) {
      throw new AppError(`This request was for ${dateOnly(request.business_date)} and has expired - it can only be rejected`, 409);
    }
    const day = await openDayInTrx(trx, { req, float: Number(request.opening_float), businessDate: today, openingRequestId: request.id });
    const [updated] = await trx('business_day_opening_requests').where({ id: request.id }).update({
      status: 'approved', reviewed_by: req.user.id, reviewed_at: trx.fn.now(), manager_comment: note || null, business_day_id: day.id,
    }).returning('*');
    await audit(req, {
      action: 'day.open_request_approve', entityType: 'opening_request', entityId: request.id,
      oldValues: { status: 'pending' }, newValues: { status: 'approved', manager_comment: note || null },
      metadata: { business_day_id: day.id, requested_by: request.requested_by },
    }, { trx, required: true });
    await notifyRequester(trx, { req, request, decision: 'approved', comment: note });
    return { request: view(updated), day: dayState(day) };
  });
}

/** POST /api/business-days/opening-requests/:id/reject { comment } - reason required; the day stays closed. */
async function rejectRequest({ req, id, comment }) {
  const why = text(comment, 1000);
  if (why.length < 3) throw new AppError('A reason is required to reject an opening request', 422);

  return db.transaction(async (trx) => {
    const request = await lockRequest(trx, id, req);
    const [updated] = await trx('business_day_opening_requests').where({ id: request.id }).update({
      status: 'rejected', reviewed_by: req.user.id, reviewed_at: trx.fn.now(), manager_comment: why,
    }).returning('*');
    await audit(req, {
      action: 'day.open_request_reject', entityType: 'opening_request', entityId: request.id,
      oldValues: { status: 'pending' }, newValues: { status: 'rejected', manager_comment: why },
      metadata: { requested_by: request.requested_by },
    }, { trx, required: true });
    await notifyRequester(trx, { req, request, decision: 'rejected', comment: why });
    return { request: view(updated) };
  });
}

/**
 * For the dashboard: reviewers get every pending request; requesters get
 * their own request for today (so they can see it is pending or why it was
 * rejected). Nothing for users who can do neither.
 */
async function forDashboard(user, today) {
  const canReview = user.permissions.includes('day.open.review');
  const canRequest = user.permissions.includes('day.open.request');
  if (!canReview && !canRequest) return { pending: [], mine: null };
  await expireStale(db, today);
  const pending = canReview
    ? (await withNames(db('business_day_opening_requests as q')).where('q.status', 'pending').orderBy('q.id')).map(view)
    : [];
  const mine = canRequest
    ? await withNames(db('business_day_opening_requests as q')).where({ 'q.requested_by': user.id, 'q.business_date': today }).orderBy('q.id', 'desc').first()
    : null;
  return { pending, mine: mine ? view(mine) : null };
}

module.exports = { createRequest, listRequests, approveRequest, rejectRequest, forDashboard };
