// Background worker, run in-process by server.js (tests call runOnce()).
//  - Sends queued emails. Rows are claimed with FOR UPDATE SKIP LOCKED, so
//    several API processes can run workers without double-sending.
//  - Retries with backoff; after max_attempts (or a permanent 5xx SMTP
//    rejection) a delivery is 'dead' and admins get an in-app alert.
//  - 'sending' rows stuck for 10+ minutes (crash mid-send) are retried.
//  - Hourly: supplier payment due / overdue checks.
// Nothing here ever deletes records.
const db = require('../config/db');
const { getTransport } = require('./email/transport');
const { buildEmail } = require('./email/render');
const { getEmailSettings } = require('./settings');
const { getRule } = require('./rules');
const { emit, hourBucket } = require('./notificationService');
const { cleanString, formatRwf } = require('../utils/sanitize');

const BACKOFF_MINUTES = [1, 5, 15, 60, 240];
const BATCH_SIZE = 20;
const TICK_MS = 15 * 1000;
const SCHEDULE_MS = 60 * 60 * 1000;

const state = { timer: null, inFlight: null, lastRunAt: null, lastScheduledAt: null, lastError: null };

async function recoverStale() {
  await db('notification_deliveries')
    .where({ status: 'sending' })
    .where('claimed_at', '<', db.raw("now() - interval '10 minutes'"))
    .update({ status: 'failed', last_error: 'Worker stopped mid-send; retrying', next_attempt_at: db.fn.now(), updated_at: db.fn.now() });
}

async function claimBatch() {
  const result = await db.raw(
    `UPDATE notification_deliveries SET status = 'sending', claimed_at = now(), attempts = attempts + 1, updated_at = now()
     WHERE id IN (
       SELECT id FROM notification_deliveries
       WHERE status IN ('pending', 'failed') AND next_attempt_at <= now()
       ORDER BY id LIMIT ? FOR UPDATE SKIP LOCKED
     ) RETURNING *`,
    [BATCH_SIZE]
  );
  return result.rows;
}

async function finish(delivery, changes) {
  await db('notification_deliveries').where({ id: delivery.id }).update({ ...changes, updated_at: db.fn.now() });
}

function isPermanent(err) {
  return Number(err.responseCode) >= 500 && Number(err.responseCode) < 600;
}

async function markDead(delivery, reason, recipientName) {
  await finish(delivery, { status: 'dead', last_error: reason });
  await emit(db, {
    type: 'EMAIL_DELIVERY_FAILED',
    dedupKey: `EMAIL_DELIVERY_FAILED:${hourBucket()}`,
    group: true,
    entityType: 'notification_delivery',
    entityId: delivery.id,
    params: { recipient_name: recipientName, subject: delivery.subject },
  });
}

async function sendOne(delivery, settings, counters) {
  const user = await db('users').where({ id: delivery.recipient_user_id }).first('email', 'full_name', 'status');
  const skip = (reason) => finish(delivery, { status: 'skipped', skip_reason: reason, attempts: delivery.attempts - 1 });

  if (!settings.enabled) return skip('email_disabled');
  const transport = getTransport();
  if (!transport) return skip('not_configured');
  if (!user || user.status !== 'active') return skip('recipient_inactive');
  if (!user.email) return skip('no_address');
  if (counters.sentToday >= settings.daily_limit) return skip('daily_limit');

  const { count } = await db('notification_deliveries')
    .where({ recipient_user_id: delivery.recipient_user_id, status: 'sent' })
    .where('sent_at', '>', db.raw("now() - interval '1 hour'"))
    .count('* as count')
    .first();
  if (Number(count) >= settings.per_recipient_hourly_limit) return skip('recipient_hourly_limit');

  const email = buildEmail({ subject: delivery.subject, bodyText: delivery.body_text });
  try {
    const info = await transport.sendMail({
      from: { name: settings.sender_name, address: settings.sender_address },
      to: user.email,
      subject: email.subject,
      text: email.text,
      html: email.html,
    });
    counters.sentToday += 1;
    await finish(delivery, {
      status: 'sent',
      sent_at: db.fn.now(),
      last_error: null,
      provider_message_id: info?.messageId ? cleanString(info.messageId, { max: 255, singleLine: true }) : null,
    });
  } catch (err) {
    const reason = cleanString(`${err.responseCode || err.code || 'ERROR'}: ${err.message}`, { max: 500, singleLine: true });
    if (isPermanent(err) || delivery.attempts >= settings.max_attempts) {
      await markDead(delivery, reason, user.full_name);
    } else {
      const minutes = BACKOFF_MINUTES[Math.min(delivery.attempts - 1, BACKOFF_MINUTES.length - 1)];
      await finish(delivery, {
        status: 'failed',
        last_error: reason,
        next_attempt_at: db.raw(`now() + (? * interval '1 minute')`, [minutes]),
      });
    }
  }
}

async function processDeliveries() {
  await recoverStale();
  const settings = await getEmailSettings();
  const { count } = await db('notification_deliveries')
    .where({ status: 'sent' })
    .where('sent_at', '>=', db.raw('date_trunc(\'day\', now())'))
    .count('* as count')
    .first();
  const counters = { sentToday: Number(count) };

  let processed = 0;
  for (;;) {
    const batch = await claimBatch();
    if (!batch.length) break;
    for (const delivery of batch) {
      await sendOne(delivery, settings, counters);
      processed += 1;
    }
    if (batch.length < BATCH_SIZE) break;
  }
  return processed;
}

/** SUPPLIER_PAYMENT_DUE (within days_before) and SUPPLIER_PAYMENT_OVERDUE, once per delivery. */
async function checkSupplierPayments() {
  const dueRule = await getRule(db, 'SUPPLIER_PAYMENT_DUE');
  const daysBefore = Number(dueRule.thresholds.days_before) || 0;
  const open = await db('supplier_deliveries')
    .join('suppliers', 'suppliers.id', 'supplier_deliveries.supplier_id')
    .whereIn('supplier_deliveries.status', ['unpaid', 'partial'])
    .whereNotNull('supplier_deliveries.payment_due_date')
    .where('supplier_deliveries.payment_due_date', '<=', db.raw(`current_date + (? * interval '1 day')`, [daysBefore]))
    .select(
      'supplier_deliveries.id', 'suppliers.name as supplier_name',
      db.raw("to_char(supplier_deliveries.payment_due_date, 'YYYY-MM-DD') as due_date"),
      db.raw('(supplier_deliveries.payment_due_date < current_date) as overdue'),
      db.raw('(supplier_deliveries.total_amount - supplier_deliveries.amount_paid) as balance')
    );

  for (const d of open) {
    const type = d.overdue ? 'SUPPLIER_PAYMENT_OVERDUE' : 'SUPPLIER_PAYMENT_DUE';
    await emit(db, {
      type,
      dedupKey: `${type}:delivery:${d.id}`,
      entityType: 'supplier_delivery',
      entityId: d.id,
      params: { supplier_name: d.supplier_name, delivery_id: d.id, balance_rwf: formatRwf(d.balance), due_date: d.due_date },
    });
  }
  return open.length;
}

/**
 * One pass of the worker. If a pass is already running, callers share it
 * (and wait for it) instead of starting a second one in parallel.
 */
function runOnce(options = {}) {
  if (!state.inFlight) {
    state.inFlight = runPass(options).finally(() => {
      state.inFlight = null;
    });
  }
  return state.inFlight;
}

async function runPass({ includeScheduled = false } = {}) {
  try {
    const sent = await processDeliveries();
    let checked = null;
    const due = !state.lastScheduledAt || Date.now() - state.lastScheduledAt >= SCHEDULE_MS;
    if (includeScheduled || due) {
      checked = await checkSupplierPayments();
      state.lastScheduledAt = Date.now();
    }
    state.lastRunAt = Date.now();
    state.lastError = null;
    return { sent, checked };
  } catch (err) {
    state.lastError = cleanString(err.message, { max: 300, singleLine: true });
    console.error('[worker] run failed:', err);
    return { error: state.lastError };
  }
}

function start() {
  if (state.timer) return;
  state.timer = setInterval(() => runOnce(), TICK_MS);
  state.timer.unref?.();
  runOnce();
}

function stop() {
  clearInterval(state.timer);
  state.timer = null;
}

function status() {
  return {
    running: !!state.timer,
    last_run_at: state.lastRunAt ? new Date(state.lastRunAt).toISOString() : null,
    last_scheduled_check_at: state.lastScheduledAt ? new Date(state.lastScheduledAt).toISOString() : null,
    last_error: state.lastError,
    stale: !state.lastRunAt || Date.now() - state.lastRunAt > 5 * 60 * 1000,
  };
}

module.exports = { runOnce, start, stop, status, checkSupplierPayments, BACKOFF_MINUTES };
