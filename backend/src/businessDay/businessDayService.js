// Daily business cycle: NO OPEN DAY -> OPEN -> CLOSING_IN_PROGRESS ->
// CLOSING_SUBMITTED -> CLOSED (-> CLOSED_WITH_ADJUSTMENT via corrections).
//
// Principles:
//  - One shop-wide day; one OPEN/CLOSING_IN_PROGRESS day at a time. A date
//    may have several sessions (session_no). Only store managers open a
//    session - directly, or by approving an opening request (openingRequests.js).
//  - Every state change locks the business_days row, re-checks the state and
//    is audited in the same transaction (required), so concurrent requests
//    can't produce two closings or skip a step.
//  - Submitting writes an immutable daily_closings snapshot. Recounts and
//    reopenings add new versions; nothing submitted is ever overwritten.
const db = require('../config/db');
const { AppError } = require('../utils/AppError');
const { audit } = require('../audit/auditService');
const { emit, actorName } = require('../notifications/notificationService');
const { buildFigures } = require('./figures');
const { getClosingSettings, varianceBand, shopDate } = require('./settings');
const { formatRwf } = require('../utils/sanitize');

const ACTIVE = ['open', 'closing_in_progress'];
const n = (v) => Math.round(Number(v || 0) * 100) / 100;

function signedRwf(value) {
  const v = n(value);
  return `${v > 0 ? '+' : v < 0 ? '-' : ''}${formatRwf(Math.abs(v))}`;
}

function dayState(day) {
  if (!day) return null;
  const { id, business_date: date, session_no, status, opened_by, opened_at, closing_started_by, closing_started_at, submitted_by, submitted_at,
    acceptance, accepted_by, accepted_at, recount_requested_at, reopened_count, closed_at } = day;
  return { id, business_date: date, session_no, status, opened_by, opened_at, closing_started_by, closing_started_at, submitted_by, submitted_at,
    acceptance, accepted_by, accepted_at, recount_requested_at, reopened_count, closed_at };
}

function dateOnly(value) {
  if (!value) return value;
  if (typeof value === 'string') return value.slice(0, 10);
  // pg returns DATE as a local-midnight Date; format it back without a timezone shift
  const d = new Date(value);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Date for notifications and messages, with the session when there is more than one. */
function dayLabel(day) {
  const date = dateOnly(day.business_date);
  return day.session_no > 1 ? `${date} (session ${day.session_no})` : date;
}

const isManager = (req) => req.user.permissions.includes('day.review');

/** Newest session first: by date, then session number. */
const newestFirst = (qb) => qb.orderBy('business_date', 'desc').orderBy('session_no', 'desc');

async function lockDay(trx, id) {
  const day = await trx('business_days').where({ id }).forUpdate().first();
  if (!day) throw new AppError('Business day not found', 404);
  return day;
}

async function activeDay(trx = db) {
  return trx('business_days').whereIn('status', ACTIVE).first();
}

/**
 * For sales/refunds/voids: the OPEN day, share-locked for the rest of the
 * transaction. Starting the closing needs an exclusive lock on the same row,
 * so a sale either finishes first (and is in the closing) or waits and is
 * then refused - it can never slip in after the figures are taken.
 */
async function requireOpenDay(trx) {
  const day = await trx('business_days').where({ status: 'open' }).forShare().first();
  if (day) return day;
  const closing = await trx('business_days').where({ status: 'closing_in_progress' }).first();
  if (closing) throw new AppError('Closing is in progress - sales and refunds are paused until the next business day is opened', 409);
  throw new AppError(NOT_OPEN_MESSAGE, 409);
}

const NOT_OPEN_MESSAGE = 'Business day is not open. Request opening access from the Store Manager.';

/**
 * For stock movements: the active day's id. Stock work needs a business day
 * (it isn't paused while the closing is in progress, only when no day is open).
 */
async function activeDayId(trx) {
  const day = await trx('business_days').whereIn('status', ACTIVE).first('id');
  if (!day) throw new AppError(NOT_OPEN_MESSAGE, 409);
  return day.id;
}

function parseAmount(value, field) {
  const v = Number(value);
  if (value === '' || value === null || value === undefined || !Number.isFinite(v) || v < 0 || v > 1e12) {
    throw new AppError(`${field} must be a non-negative amount in RWF`, 422);
  }
  return n(v);
}

/** Serializes everything that opens a day or files an opening request. */
async function lockOpening(trx) {
  await trx.raw("SELECT pg_advisory_xact_lock(hashtext('business_days.open'))");
}

/** POST /open - store managers only (day.open). */
async function openDay({ req, openingFloat }) {
  const float = parseAmount(openingFloat, 'opening_float');
  const settings = await getClosingSettings();
  const businessDate = shopDate(settings);

  return db.transaction(async (trx) => {
    // Serialize opens so the friendly checks below are race-free (the unique
    // indexes would catch a race anyway, but with a less helpful error).
    await lockOpening(trx);
    const day = await openDayInTrx(trx, { req, float, businessDate });
    // Requests for this date are moot once a manager has opened it directly.
    await trx('business_day_opening_requests').where({ business_date: businessDate, status: 'pending' }).update({
      status: 'expired', reviewed_at: trx.fn.now(), manager_comment: `Business day opened directly by ${req.user.full_name}`,
    });
    return day;
  });
}

/**
 * Opens a new session for businessDate, as req.user (a manager - directly or
 * by approving a request). Caller holds lockOpening() in trx.
 */
async function openDayInTrx(trx, { req, float, businessDate, openingRequestId = null }) {
  const active = await activeDay(trx);
  if (active) {
    throw new AppError(`The business day ${dateOnly(active.business_date)} is still ${active.status === 'open' ? 'open' : 'being closed'} - close it first`, 409);
  }
  const existing = await trx('business_days').where({ business_date: businessDate }).max('session_no as n').first();
  const sessionNo = Number(existing?.n || 0) + 1;
  const later = await trx('business_days').where('business_date', '>', businessDate).first();
  if (later) throw new AppError('A later business day already exists - check the shop timezone setting', 409);

  const previous = await trx('daily_closings')
    .join('business_days', 'business_days.id', 'daily_closings.business_day_id')
    .orderBy('business_days.business_date', 'desc')
    .orderBy('business_days.session_no', 'desc')
    .orderBy('daily_closings.version', 'desc')
    .first('daily_closings.counted_cash', 'business_days.business_date');

  const [day] = await trx('business_days')
    .insert({
      business_date: businessDate, session_no: sessionNo, status: 'open', opening_float: float,
      opened_by: req.user.id, opened_at: trx.fn.now(), opening_request_id: openingRequestId,
    })
    .returning('*');

  await audit(req, {
    action: 'day.open', entityType: 'business_day', entityId: day.id,
    newValues: { business_date: businessDate, session_no: sessionNo, status: 'open', opening_float: float },
    metadata: {
      business_day_id: day.id,
      // Reference only - cash removal/banking is out of scope, so no variance is computed.
      previous_counted_cash: previous ? Number(previous.counted_cash) : null,
      ...(openingRequestId && { opening_request_id: openingRequestId }),
    },
  }, { trx, required: true });
  return day;
}

async function startClosing({ req }) {
  return db.transaction(async (trx) => {
    const current = await trx('business_days').whereIn('status', ACTIVE).forUpdate().first();
    if (!current) throw new AppError('No business day is open', 409);
    if (current.status !== 'open') throw new AppError('Closing has already been started', 409);
    const [day] = await trx('business_days').where({ id: current.id }).update({
      status: 'closing_in_progress', closing_started_by: req.user.id, closing_started_at: trx.fn.now(), updated_at: trx.fn.now(),
    }).returning('*');
    await audit(req, {
      action: 'day.closing_start', entityType: 'business_day', entityId: day.id,
      oldValues: { status: 'open' }, newValues: { status: day.status },
      metadata: { business_day_id: day.id },
    }, { trx, required: true });
    return day;
  });
}

async function cancelClosing({ req }) {
  return db.transaction(async (trx) => {
    const current = await trx('business_days').where({ status: 'closing_in_progress' }).forUpdate().first();
    if (!current) throw new AppError('No closing is in progress', 409);
    const [day] = await trx('business_days').where({ id: current.id }).update({
      status: 'open', closing_started_by: null, closing_started_at: null, updated_at: trx.fn.now(),
    }).returning('*');
    await audit(req, {
      action: 'day.closing_cancel', entityType: 'business_day', entityId: day.id,
      oldValues: { status: 'closing_in_progress', closing_started_by: current.closing_started_by },
      newValues: { status: 'open' },
      metadata: { business_day_id: day.id },
    }, { trx, required: true });
    return day;
  });
}

/** The day a submit applies to: the day being closed, or a submitted day awaiting a recount. */
async function submittableDay(trx) {
  const closing = await trx('business_days').where({ status: 'closing_in_progress' }).forUpdate().first();
  if (closing) return closing;
  const recount = await trx('business_days')
    .where({ status: 'closing_submitted' })
    .whereNotNull('recount_requested_at')
    .modify(newestFirst)
    .forUpdate()
    .first();
  return recount || null;
}

async function previewClosing() {
  const settings = await getClosingSettings();
  return db.transaction(async (trx) => {
    const day = await submittableDay(trx);
    if (!day) throw new AppError('Start the closing first', 409);
    const figures = await buildFigures(trx, day, settings);
    const { per_cashier: _omit, ...shared } = figures; // closers see shop-level figures only
    return {
      day: dayState(day),
      figures: shared,
      thresholds: { attention_variance_rwf: settings.attention_variance_rwf, critical_variance_rwf: settings.critical_variance_rwf },
      recount: !!day.recount_requested_at,
      recount_reason: day.recount_reason || null,
    };
  });
}

async function submitClosing({ req, countedCash, explanation }) {
  const counted = parseAmount(countedCash, 'counted_cash');
  const note = typeof explanation === 'string' ? explanation.trim().slice(0, 1000) : '';
  const settings = await getClosingSettings();

  const result = await db.transaction(async (trx) => {
    const day = await submittableDay(trx);
    if (!day) throw new AppError('There is no closing waiting to be submitted (it may already have been submitted)', 409);

    const figures = await buildFigures(trx, day, settings);
    const variance = n(counted - figures.cash.expected_cash);
    const band = varianceBand(variance, settings);
    if (band !== 'normal' && !note) {
      throw new AppError(`A cash variance of ${signedRwf(variance)} needs an explanation before the closing can be submitted`, 422);
    }

    const previous = await trx('daily_closings').where({ business_day_id: day.id }).orderBy('version', 'desc').first();
    const submitterName = await actorName(trx, req.user.id);
    const snapshot = {
      ...figures,
      counted_cash: counted,
      variance,
      variance_band: band,
      explanation: note || null,
      thresholds: { attention_variance_rwf: settings.attention_variance_rwf, critical_variance_rwf: settings.critical_variance_rwf },
      timezone: settings.timezone,
      submitted_by: { id: req.user.id, name: submitterName },
      generated_at: new Date().toISOString(),
    };

    const [closing] = await trx('daily_closings').insert({
      business_day_id: day.id,
      version: previous ? previous.version + 1 : 1,
      supersedes_id: previous ? previous.id : null,
      submitted_by: req.user.id,
      submitted_by_name: submitterName,
      opening_float: figures.cash.opening_float,
      cash_sales: figures.cash.cash_sales,
      cash_refunds: figures.cash.cash_refunds,
      expected_cash: figures.cash.expected_cash,
      counted_cash: counted,
      variance,
      variance_band: band,
      explanation: note || null,
      gross_sales: figures.sales.gross,
      refunds_total: figures.sales.refunds,
      net_sales: figures.sales.net,
      transaction_count: figures.sales.transactions,
      void_count: figures.sales.void_count,
      snapshot: JSON.stringify(snapshot),
    }).returning('*');

    // Critical variances wait for a manager - unless a manager submitted it:
    // then it is accepted as theirs at once (still flagged, audited, notified).
    const selfAccept = band === 'critical' && isManager(req);
    const autoAccept = band !== 'critical' || selfAccept;
    const [updated] = await trx('business_days').where({ id: day.id }).update({
      status: autoAccept ? 'closed' : 'closing_submitted',
      submitted_by: req.user.id,
      submitted_at: trx.fn.now(),
      acceptance: selfAccept ? 'manager' : autoAccept ? 'auto' : null,
      accepted_by: selfAccept ? req.user.id : null,
      accepted_at: autoAccept ? trx.fn.now() : null,
      acceptance_note: null,
      closed_at: autoAccept ? trx.fn.now() : null,
      recount_requested_by: null,
      recount_requested_at: null,
      recount_reason: null,
      updated_at: trx.fn.now(),
    }).returning('*');

    const meta = { business_day_id: day.id, closing_id: closing.id, version: closing.version };
    await audit(req, {
      action: 'day.closing_submit', entityType: 'business_day', entityId: day.id,
      oldValues: { status: day.status },
      newValues: { status: updated.status, expected_cash: figures.cash.expected_cash, counted_cash: counted, variance, variance_band: band, explanation: note || null },
      metadata: meta,
    }, { trx, required: true });
    if (autoAccept) {
      await audit(req, {
        action: selfAccept ? 'day.accept' : 'day.auto_accept', entityType: 'business_day', entityId: day.id,
        newValues: { status: 'closed', variance, variance_band: band, ...(selfAccept && { self_accepted: true }) }, metadata: meta,
      }, { trx, required: true });
    }

    const date = dayLabel(day);
    const common = { entityType: 'business_day', entityId: day.id, actorUserId: req.user.id };
    await emit(trx, {
      ...common, type: 'CLOSING_SUBMITTED', dedupKey: `CLOSING_SUBMITTED:day:${day.id}:v${closing.version}`,
      params: { business_date: date, actor_name: submitterName, variance_rwf: signedRwf(variance), band },
    });
    const varianceParams = {
      business_date: date, variance_rwf: signedRwf(variance), expected_rwf: figures.cash.expected_cash,
      counted_rwf: counted, actor_name: submitterName, explanation: note || '-',
    };
    if (band === 'attention') {
      await emit(trx, { ...common, type: 'CASH_VARIANCE_ATTENTION', dedupKey: `CASH_VARIANCE_ATTENTION:day:${day.id}:v${closing.version}`, params: varianceParams });
    }
    if (band === 'critical') {
      await emit(trx, {
        ...common, type: 'CASH_VARIANCE_CRITICAL', dedupKey: `CASH_VARIANCE_CRITICAL:day:${day.id}:v${closing.version}`,
        targetUserIds: [req.user.id], params: varianceParams,
      });
    }
    if (autoAccept && !selfAccept) {
      await emit(trx, {
        ...common, type: 'CLOSING_ACCEPTED', dedupKey: `CLOSING_ACCEPTED:day:${day.id}:v${closing.version}`,
        targetUserIds: [req.user.id], params: { business_date: date, accepted_by_name: 'automatic acceptance', variance_rwf: signedRwf(variance) },
      });
    }
    return { day: updated, closing };
  });
  return result;
}

async function currentClosing(trx, dayId) {
  return trx('daily_closings').where({ business_day_id: dayId }).orderBy('version', 'desc').first();
}

async function acceptClosing({ req, dayId, note }) {
  return db.transaction(async (trx) => {
    const day = await lockDay(trx, dayId);
    if (day.status !== 'closing_submitted') throw new AppError('Only a submitted closing awaiting review can be accepted', 409);
    if (day.recount_requested_at) throw new AppError('A recount has been requested - wait for the new count', 409);
    const closing = await currentClosing(trx, day.id);

    const [updated] = await trx('business_days').where({ id: day.id }).update({
      status: 'closed', acceptance: 'manager', accepted_by: req.user.id, accepted_at: trx.fn.now(),
      acceptance_note: note ? String(note).slice(0, 1000) : null, closed_at: trx.fn.now(), updated_at: trx.fn.now(),
    }).returning('*');
    await audit(req, {
      action: 'day.accept', entityType: 'business_day', entityId: day.id,
      oldValues: { status: day.status }, newValues: { status: 'closed', note: note || null, variance: Number(closing.variance) },
      metadata: { business_day_id: day.id, closing_id: closing.id },
    }, { trx, required: true });
    await emit(trx, {
      type: 'CLOSING_ACCEPTED', dedupKey: `CLOSING_ACCEPTED:day:${day.id}:v${closing.version}`,
      entityType: 'business_day', entityId: day.id, actorUserId: req.user.id, targetUserIds: [closing.submitted_by],
      params: { business_date: dayLabel(day), accepted_by_name: req.user.full_name, variance_rwf: signedRwf(closing.variance) },
    });
    return updated;
  });
}

async function requestRecount({ req, dayId, reason }) {
  const why = typeof reason === 'string' ? reason.trim() : '';
  if (!why) throw new AppError('A reason is required to request a recount', 422);
  return db.transaction(async (trx) => {
    const day = await lockDay(trx, dayId);
    if (day.status !== 'closing_submitted') throw new AppError('Only a submitted closing awaiting review can be sent back for recount', 409);
    if (day.recount_requested_at) throw new AppError('A recount is already pending', 409);
    const closing = await currentClosing(trx, day.id);

    const [updated] = await trx('business_days').where({ id: day.id }).update({
      recount_requested_by: req.user.id, recount_requested_at: trx.fn.now(), recount_reason: why.slice(0, 1000), updated_at: trx.fn.now(),
    }).returning('*');
    await audit(req, {
      action: 'day.recount_request', entityType: 'business_day', entityId: day.id,
      newValues: { recount_reason: why }, metadata: { business_day_id: day.id, closing_id: closing.id },
    }, { trx, required: true });
    await emit(trx, {
      type: 'RECOUNT_REQUESTED', dedupKey: `RECOUNT_REQUESTED:day:${day.id}:v${closing.version}`,
      entityType: 'business_day', entityId: day.id, actorUserId: req.user.id, targetUserIds: [closing.submitted_by],
      params: { business_date: dayLabel(day), reviewer_name: req.user.full_name, reason: why },
    });
    return updated;
  });
}

/**
 * Exceptional, manager-only: puts the most recent closed day back to OPEN.
 * The previous closing stays in history; the next submit adds a new version.
 */
async function reopenDay({ req, dayId, reason }) {
  const why = typeof reason === 'string' ? reason.trim() : '';
  if (why.length < 10) throw new AppError('A reason (at least 10 characters) is required to reopen a business day', 422);
  return db.transaction(async (trx) => {
    await trx.raw("SELECT pg_advisory_xact_lock(hashtext('business_days.open'))");
    const day = await lockDay(trx, dayId);
    if (!['closed', 'closed_with_adjustment'].includes(day.status)) throw new AppError('Only a closed business day can be reopened', 409);
    const active = await activeDay(trx);
    if (active) throw new AppError(`Close the current business day (${dateOnly(active.business_date)}) before reopening another`, 409);
    const newest = await trx('business_days').modify(newestFirst).first('id');
    if (newest.id !== day.id) throw new AppError('Only the most recent business day can be reopened - use a correction request instead', 409);

    const [updated] = await trx('business_days').where({ id: day.id }).update({
      status: 'open', closing_started_by: null, closing_started_at: null, submitted_by: null, submitted_at: null,
      acceptance: null, accepted_by: null, accepted_at: null, acceptance_note: null, closed_at: null,
      reopened_count: day.reopened_count + 1, updated_at: trx.fn.now(),
    }).returning('*');
    await audit(req, {
      action: 'day.reopen', entityType: 'business_day', entityId: day.id,
      oldValues: dayState(day), newValues: { status: 'open', reopened_count: updated.reopened_count, reason: why },
      metadata: { business_day_id: day.id },
    }, { trx, required: true });
    await emit(trx, {
      type: 'BUSINESS_DAY_REOPENED', dedupKey: `BUSINESS_DAY_REOPENED:day:${day.id}:${updated.reopened_count}`,
      entityType: 'business_day', entityId: day.id, actorUserId: req.user.id,
      params: { business_date: dayLabel(day), actor_name: req.user.full_name, reason: why },
    });
    return updated;
  });
}

module.exports = {
  ACTIVE, NOT_OPEN_MESSAGE, requireOpenDay, activeDayId, activeDay, openDay, openDayInTrx, lockOpening, parseAmount, startClosing, cancelClosing, previewClosing, submitClosing,
  acceptClosing, requestRecount, reopenDay, currentClosing, dateOnly, dayLabel, newestFirst, dayState, signedRwf,
};
