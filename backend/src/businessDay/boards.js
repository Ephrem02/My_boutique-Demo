// Read side of the daily business cycle: the two dashboard boards, history,
// health and the accountability timeline.
//
// Board A (last day) is always rendered from the stored closing snapshot plus
// approved adjustments - never recalculated from live data. Board B (today)
// is live. Per-cashier figures are removed unless the viewer holds
// day.history.view (managers), so cashiers only ever see shop-level totals.
const db = require('../config/db');
const { buildFigures, atClockTime } = require('./figures');
const { getClosingSettings, shopDate, shopTime, varianceBand } = require('./settings');
const { ACTIVE, dateOnly, dayState, newestFirst } = require('./businessDayService');
const { correctedView } = require('./corrections');
const openingRequests = require('./openingRequests');

const SECURITY_TYPES = ['FAILED_LOGIN_BURST', 'ACCESS_DENIED_BURST', 'SUSPICIOUS_ACTIVITY'];

async function names(ids) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return new Map();
  const rows = await db('users').whereIn('id', unique).select('id', 'full_name');
  return new Map(rows.map((r) => [r.id, r.full_name]));
}

/**
 * Instant (Date) of the expected closing time on a business date, in the shop
 * timezone - or null for a session opened after that time (an extra session
 * the manager opened late has no scheduled closing, so no due/overdue alerts).
 */
async function dueAt(day, settings) {
  const { rows } = await db.raw('SELECT ((?::date + ?::time) AT TIME ZONE ?) AS due', [dateOnly(day.business_date), settings.expected_closing_time, settings.timezone]);
  const due = new Date(rows[0].due);
  return new Date(day.opened_at) >= due ? null : due;
}

/**
 * Explicit, measurable health rules (thresholds come from closing settings).
 * Returns { status: 'normal'|'attention'|'critical', reasons: [codes] }.
 */
async function computeHealth(day, { closing, corrected, settings }) {
  const reasons = { critical: [], attention: [] };
  const windowEnd = day.closed_at || new Date();

  if (corrected) {
    const band = varianceBand(corrected.variance, settings);
    if (band === 'critical') reasons.critical.push('critical_variance');
    if (band === 'attention') reasons.attention.push('variance_needs_explanation');
  }
  if (day.reopened_count > 0) reasons.critical.push('reopened');

  const leftOpen = await db('notification_events').where({ type: 'DAY_LEFT_OPEN', entity_type: 'business_day', entity_id: day.id }).first('id');
  if (leftOpen) reasons.critical.push('left_open_past_deadline');

  const security = await db('notification_events')
    .whereIn('type', SECURITY_TYPES)
    .whereBetween('created_at', [day.opened_at, windowEnd])
    .first('id');
  if (security) reasons.critical.push('security_event');

  const pending = await db('closing_correction_requests').where({ business_day_id: day.id, status: 'pending' }).count('* as n').first();
  if (Number(pending.n) > 0) reasons.attention.push('pending_correction');

  if (closing) {
    // Repeated corrections: the same person requesting 2+ corrections in 7 days
    const repeated = await db('closing_correction_requests')
      .where('requested_at', '>', db.raw("now() - interval '7 days'"))
      .groupBy('requested_by')
      .havingRaw('count(*) >= 2')
      .select('requested_by');
    const dayRequesters = await db('closing_correction_requests').where({ business_day_id: day.id }).pluck('requested_by');
    if (repeated.some((r) => dayRequesters.includes(r.requested_by))) reasons.critical.push('repeated_corrections');
  }
  if (day.status === 'closing_submitted') reasons.attention.push(day.recount_requested_at ? 'recount_requested' : 'awaiting_review');

  const status = reasons.critical.length ? 'critical' : reasons.attention.length ? 'attention' : 'normal';
  return { status, reasons: [...reasons.critical, ...reasons.attention] };
}

function stripManagementData(figures, canSeeHistory) {
  if (canSeeHistory) return figures;
  const { per_cashier: _omit, ...shared } = figures;
  return shared;
}

async function peopleFor(day, closing) {
  const request = day.opening_request_id
    ? await db('business_day_opening_requests').where({ id: day.opening_request_id }).first('requested_by', 'requested_at')
    : null;
  const map = await names([day.opened_by, day.closing_started_by, day.accepted_by, day.recount_requested_by, request?.requested_by]);
  const person = (id, at) => (id ? { id, name: map.get(id) || null, at } : null);
  return {
    opening_requested_by: request ? person(request.requested_by, request.requested_at) : null,
    opened_by: person(day.opened_by, day.opened_at),
    closing_requested_by: person(day.closing_started_by, day.closing_started_at),
    submitted_by: closing ? { id: closing.submitted_by, name: closing.submitted_by_name, at: closing.submitted_at } : null,
    accepted_by: day.acceptance === 'manager' ? person(day.accepted_by, day.accepted_at) : null,
    acceptance: day.acceptance,
    recount_requested_by: person(day.recount_requested_by, day.recount_requested_at),
  };
}

/** Board for a day that has a submitted closing (from the snapshot). */
async function closedBoard(day, { canSeeHistory, settings }) {
  const closing = await db('daily_closings').where({ business_day_id: day.id }).orderBy('version', 'desc').first();
  if (!closing) return null;
  const adjustments = await db('closing_adjustments').where({ closing_id: closing.id }).orderBy('id');
  const corrected = correctedView(closing, adjustments);
  const snapshot = stripManagementData(closing.snapshot, canSeeHistory);
  const people = await peopleFor(day, closing);
  const pendingCorrections = await db('closing_correction_requests').where({ business_day_id: day.id, status: 'pending' }).count('* as n').first();
  const versions = await db('daily_closings').where({ business_day_id: day.id }).orderBy('version').select('id', 'version', 'submitted_by_name', 'submitted_at', 'counted_cash', 'variance', 'variance_band');

  return {
    kind: 'closed',
    day: { ...dayState(day), business_date: dateOnly(day.business_date), acceptance_note: day.acceptance_note, recount_reason: day.recount_reason },
    closing: {
      id: closing.id,
      version: closing.version,
      submitted_at: closing.submitted_at,
      expected_cash: Number(closing.expected_cash),
      counted_cash: Number(closing.counted_cash),
      variance: Number(closing.variance),
      variance_band: closing.variance_band,
      explanation: closing.explanation,
    },
    figures: snapshot,
    // Workers are names only - no per-person figures for non-managers
    people: { ...people, worked: closing.snapshot.people?.worked || [] },
    adjustments: adjustments.map((a) => ({
      id: a.id, field: a.field, original_value: Number(a.original_value), adjusted_value: Number(a.adjusted_value), delta: Number(a.delta),
      reason: a.reason, requested_by_name: a.requested_by_name, approved_by_name: a.approved_by_name, created_at: a.created_at,
    })),
    corrected,
    pending_corrections: Number(pendingCorrections.n),
    versions: canSeeHistory ? versions : undefined,
    health: await computeHealth(day, { closing, corrected, settings }),
  };
}

/** Live board for the active (open / closing) day. */
async function liveBoard(day, { canSeeHistory, settings }) {
  const figures = await buildFigures(db, day, settings);
  const due = await dueAt(day, settings);
  const now = Date.now();
  const reminderAt = due && due.getTime() - settings.reminder_lead_minutes * 60000;
  const criticalAt = due && due.getTime() + settings.critical_delay_minutes * 60000;
  const pendingCorrections = await db('closing_correction_requests').where({ status: 'pending' }).count('* as n').first();
  return {
    kind: 'live',
    day: { ...dayState(day), business_date: dateOnly(day.business_date), opening_float: Number(day.opening_float) },
    figures: stripManagementData(figures, canSeeHistory),
    people: { ...(await peopleFor(day, null)), worked: figures.people.worked },
    closing_schedule: due ? {
      expected_closing_time: settings.expected_closing_time,
      due_at: due.toISOString(),
      state: now >= criticalAt ? 'overdue_critical' : now >= due.getTime() ? 'due' : now >= reminderAt ? 'reminder' : 'not_due',
    } : null,
    alerts: {
      low_stock_count: figures.inventory.low_stock_count,
      out_of_stock_count: figures.inventory.out_of_stock_count,
      pending_corrections: canSeeHistory ? Number(pendingCorrections.n) : undefined,
    },
    health: await computeHealth(day, { closing: null, corrected: null, settings }),
  };
}

/** GET /api/business-days/dashboard */
async function dashboard(user) {
  const settings = await getClosingSettings();
  const canSeeHistory = user.permissions.includes('day.history.view');

  const active = await db('business_days').whereIn('status', ACTIVE).first();
  const last = await db('business_days')
    .whereNotIn('status', ACTIVE)
    .modify(newestFirst)
    .first();
  const awaitingReview = canSeeHistory
    ? await db('business_days').where({ status: 'closing_submitted' }).orderBy('business_date').orderBy('session_no').select('id', 'business_date', 'session_no', 'recount_requested_at')
    : [];
  const shopToday = shopDate(settings);
  const sessionsToday = await db('business_days').where({ business_date: shopToday }).count('* as n').first();

  const today = active ? await liveBoard(active, { canSeeHistory, settings }) : null;
  const lastBoard = last ? await closedBoard(last, { canSeeHistory, settings }) : null;

  let comparison = null;
  if (today && lastBoard) {
    const [hh, mm] = shopTime(settings).split(':').map(Number);
    const slot = `${String(hh).padStart(2, '0')}:${String(Math.floor(mm / 15) * 15).padStart(2, '0')}`;
    comparison = {
      same_time: {
        slot, // both sides include only quarter-hours that finished before this time
        today: atClockTime(today.figures.cumulative, slot),
        last: atClockTime(lastBoard.figures.cumulative, slot),
      },
      last_full_day: { sales: lastBoard.figures.sales.gross, transactions: lastBoard.figures.sales.transactions },
    };
  }

  return {
    shop_date: shopToday,
    sessions_today: Number(sessionsToday.n),
    opening_requests: await openingRequests.forDashboard(user, shopToday),
    settings: {
      expected_closing_time: settings.expected_closing_time,
      timezone: settings.timezone,
      attention_variance_rwf: settings.attention_variance_rwf,
      critical_variance_rwf: settings.critical_variance_rwf,
    },
    today,
    last: lastBoard,
    awaiting_review: awaitingReview.map((d) => ({ ...d, business_date: dateOnly(d.business_date) })),
    comparison,
  };
}

/** GET /api/business-days (managers) */
async function history({ page = 1, limit = 30 }) {
  const rows = await db('business_days as d')
    .leftJoin('users as o', 'o.id', 'd.opened_by')
    .leftJoin('users as s', 's.id', 'd.submitted_by')
    .select('d.*', 'o.full_name as opened_by_name', 's.full_name as submitted_by_name',
      db.raw('(SELECT variance FROM daily_closings c WHERE c.business_day_id = d.id ORDER BY version DESC LIMIT 1) as variance'),
      db.raw('(SELECT variance_band FROM daily_closings c WHERE c.business_day_id = d.id ORDER BY version DESC LIMIT 1) as variance_band'),
      db.raw('(SELECT net_sales FROM daily_closings c WHERE c.business_day_id = d.id ORDER BY version DESC LIMIT 1) as net_sales'),
      db.raw("(SELECT count(*)::int FROM closing_correction_requests r WHERE r.business_day_id = d.id AND r.status = 'pending') as pending_corrections"),
      db.raw('(SELECT count(*)::int FROM closing_adjustments a WHERE a.business_day_id = d.id) as adjustments'))
    .orderBy('d.business_date', 'desc')
    .orderBy('d.session_no', 'desc')
    .limit(limit)
    .offset((page - 1) * limit);
  const [{ count }] = await db('business_days').count('* as count');
  return {
    items: rows.map((r) => ({
      id: r.id, business_date: dateOnly(r.business_date), session_no: r.session_no, status: r.status, opened_by_name: r.opened_by_name, submitted_by_name: r.submitted_by_name,
      opened_at: r.opened_at, closed_at: r.closed_at, variance: r.variance === null ? null : Number(r.variance), variance_band: r.variance_band,
      net_sales: r.net_sales === null ? null : Number(r.net_sales), pending_corrections: r.pending_corrections, adjustments: r.adjustments,
      reopened_count: r.reopened_count, acceptance: r.acceptance,
    })),
    total: Number(count),
    page,
    limit,
  };
}

/** GET /api/business-days/:id (managers) */
async function detail(dayId) {
  const settings = await getClosingSettings();
  const day = await db('business_days').where({ id: dayId }).first();
  if (!day) return null;
  if (ACTIVE.includes(day.status)) return liveBoard(day, { canSeeHistory: true, settings });
  return closedBoard(day, { canSeeHistory: true, settings });
}

// Business-significant audit actions shown on the timeline (not every read).
const TIMELINE_ACTIONS = [
  'day.open', 'day.closing_start', 'day.closing_cancel', 'day.closing_submit', 'day.auto_accept', 'day.accept', 'day.recount_request',
  'day.reopen', 'day.left_open_critical', 'day.open_request_approve', 'correction.request', 'correction.approve', 'correction.reject', 'adjustment.apply',
  'sale.void', 'sale.refund', 'stock.intake', 'stock.transfer', 'stock.damage', 'product.price_change', 'product.deactivate',
  'supplier_delivery.create', 'institution_order.create', 'user.role_change', 'user.disable', 'user.password_reset',
];
const TIMELINE_EVENTS = [
  'HIGH_VALUE_SALE', 'LOW_STOCK', 'OUT_OF_STOCK', 'SHELF_EMPTY', 'LARGE_DAMAGE', 'SUSPICIOUS_ACTIVITY', 'FAILED_LOGIN_BURST',
  'ACCESS_DENIED_BURST', 'SYSTEM_ERROR', 'CLOSING_REMINDER', 'CLOSING_DUE', 'DAY_LEFT_OPEN', 'CASH_VARIANCE_ATTENTION',
  'CASH_VARIANCE_CRITICAL', 'OVERPAYMENT',
];

/** GET /api/business-days/:id/timeline - merged audit + notification events for the day's window. */
async function timeline(dayId) {
  const day = await db('business_days').where({ id: dayId }).first();
  if (!day) return null;
  const from = day.opened_at;
  const to = day.closed_at && !ACTIVE.includes(day.status) ? new Date(new Date(day.closed_at).getTime() + 60 * 60000) : new Date();

  const audits = await db('audit_logs as a')
    .leftJoin('users as u', 'u.id', 'a.actor_user_id')
    .where((qb) => qb
      .whereRaw("a.metadata->>'business_day_id' = ?", [String(day.id)])
      .orWhere((q) => q.whereIn('a.action', TIMELINE_ACTIONS).whereBetween('a.created_at', [from, to])))
    .select('a.id', 'a.created_at as at', 'a.action', 'a.entity_type', 'a.entity_id', 'a.result', 'a.new_values', 'u.full_name as actor_name', 'a.actor_role')
    .orderBy('a.created_at')
    .limit(500);
  const events = await db('notification_events as e')
    .leftJoin('users as u', 'u.id', 'e.actor_user_id')
    .whereIn('e.type', TIMELINE_EVENTS)
    .where((qb) => qb
      .where({ 'e.entity_type': 'business_day', 'e.entity_id': day.id })
      .orWhereBetween('e.created_at', [from, to]))
    .select('e.id', 'e.created_at as at', 'e.type', 'e.severity', 'e.entity_type', 'e.entity_id', 'e.params', 'e.occurrence_count', 'u.full_name as actor_name')
    .orderBy('e.created_at')
    .limit(500);
  const firstSale = await db('sales').where({ business_day_id: day.id }).orderBy('created_at').first('id', 'created_at', 'cashier_id');
  const firstSaleBy = firstSale ? (await names([firstSale.cashier_id])).get(firstSale.cashier_id) : null;

  const items = [
    ...audits.map((a) => ({ kind: 'audit', id: `a${a.id}`, at: a.at, code: a.action, actor_name: a.actor_name, actor_role: a.actor_role,
      entity_type: a.entity_type, entity_id: a.entity_id, result: a.result, details: a.new_values })),
    ...events.map((e) => ({ kind: 'event', id: `e${e.id}`, at: e.at, code: e.type, severity: e.severity, actor_name: e.actor_name,
      entity_type: e.entity_type, entity_id: e.entity_id, details: e.params, occurrences: e.occurrence_count })),
    ...(firstSale ? [{ kind: 'derived', id: 'first-sale', at: firstSale.created_at, code: 'first_sale', actor_name: firstSaleBy, entity_type: 'sale', entity_id: firstSale.id }] : []),
  ].sort((a, b) => new Date(a.at) - new Date(b.at));

  return { day: { ...dayState(day), business_date: dateOnly(day.business_date) }, items };
}

module.exports = { dashboard, history, detail, timeline, computeHealth, dueAt };
