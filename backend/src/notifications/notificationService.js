// emit() is called from business services *inside their transaction*:
//  - the event + per-recipient notifications + queued emails commit
//    atomically with the sale/delivery/etc. A rolled-back sale never
//    produces a notification, and a committed one can't lose its event.
//  - it runs in a savepoint and swallows its own errors, so a notification
//    bug can never fail or roll back the business transaction.
//  - real-time push uses pg_notify, which Postgres only delivers on COMMIT.
// Emails are only queued here; worker.js sends them asynchronously.
const { TYPES } = require('./types');
const { getRule } = require('./rules');
const { getTemplate, renderAll } = require('./templates');
const { getEmailSettings } = require('./settings');
const { cleanString, formatRwf } = require('../utils/sanitize');

const PUSH_CHANNEL = 'notifications';

function sanitizeParams(type, params) {
  const out = {};
  for (const name of TYPES[type].vars) {
    let value = params[name];
    if (value === undefined || value === null) continue;
    if (name.endsWith('_rwf') && typeof value === 'number') value = formatRwf(value);
    if (typeof value === 'boolean') value = value ? 'yes' : 'no';
    out[name] = cleanString(value, { max: name === 'message' ? 1000 : 200 });
  }
  return out;
}

/**
 * Recipients for an event, enforcing the type's permission ceiling:
 *  - role-based: active, role listed in the rule, and the role holds the
 *    type's visibility permission; the actor is excluded (they know).
 *  - targets: active users the event is about (their own sale/account).
 *    Included when the type always informs its target, or when their role
 *    is listed in the rule.
 *  - explicitUserIds: manual notifications, already authorized by the caller.
 */
async function resolveRecipients(trx, type, rule, { actorUserId, targetUserIds = [], explicitUserIds = null }) {
  const def = TYPES[type];
  const base = () =>
    trx('users').join('roles', 'roles.id', 'users.role_id').where('users.status', 'active')
      .select('users.id', 'users.email', 'users.full_name', 'roles.name as role');

  if (explicitUserIds) return explicitUserIds.length ? base().whereIn('users.id', explicitUserIds) : [];

  const byId = new Map();
  if (def.permission && rule.recipient_roles.length) {
    const roleBased = await base()
      .whereIn('roles.name', rule.recipient_roles)
      .whereExists(function () {
        this.select(1).from('role_permissions')
          .join('permissions', 'permissions.id', 'role_permissions.permission_id')
          .whereRaw('role_permissions.role_id = users.role_id')
          .where('permissions.code', def.permission);
      });
    for (const u of roleBased) if (u.id !== actorUserId) byId.set(u.id, u);
  }
  const targets = targetUserIds.filter(Boolean);
  if (targets.length) {
    const targetUsers = await base().whereIn('users.id', targets);
    for (const u of targetUsers) {
      if (def.targetAlways || rule.recipient_roles.includes(u.role)) byId.set(u.id, u);
    }
  }
  return [...byId.values()];
}

async function insertEvent(trx, row, group) {
  const columns = ['type', 'category', 'severity', 'entity_type', 'entity_id', 'params', 'dedup_key', 'actor_user_id'];
  const values = columns.map((c) => row[c]);
  const onConflict = group
    ? `DO UPDATE SET occurrence_count = notification_events.occurrence_count + 1,
         last_occurred_at = now(), params = EXCLUDED.params`
    : 'DO NOTHING';
  const result = await trx.raw(
    `INSERT INTO notification_events (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})
     ON CONFLICT (dedup_key) WHERE resolved_at IS NULL ${onConflict}
     RETURNING *, (xmax = 0) AS inserted`,
    values
  );
  return result.rows[0] || null;
}

/**
 * Records an event and fans it out. Returns the event row if new
 * notifications were created, otherwise null (disabled, deduplicated,
 * cooling down, grouped into an existing event, or failed).
 *
 * options: { type, dedupKey, params, entityType, entityId, actorUserId,
 *            targetUserIds, explicitUserIds, severity, group }
 * `group: true` turns repeats of an open dedupKey into an occurrence count
 * instead of new notifications (bursts: failed logins, errors).
 */
async function emit(trx, options) {
  const run = async (sp) => {
    const { type, dedupKey, params = {}, entityType = null, entityId = null, actorUserId = null, group = false } = options;
    const def = TYPES[type];
    if (!def) throw new Error(`Unknown notification type ${type}`);
    const rule = await getRule(sp, type);
    if (!rule.enabled && !def.mandatory) return null;

    if (rule.cooldown_minutes > 0) {
      const recent = await sp('notification_events')
        .where({ dedup_key: dedupKey })
        .where('created_at', '>', sp.raw(`now() - (? * interval '1 minute')`, [rule.cooldown_minutes]))
        .first();
      if (recent) return null;
    }

    const cleanParams = sanitizeParams(type, params);
    const event = await insertEvent(sp, {
      type,
      category: def.category,
      severity: options.severity || rule.severity,
      entity_type: entityType,
      entity_id: entityId,
      params: JSON.stringify(cleanParams),
      dedup_key: String(dedupKey).slice(0, 255),
      actor_user_id: actorUserId,
    }, group);
    if (!event || !event.inserted) return null;

    const recipients = await resolveRecipients(sp, type, rule, options);
    if (!recipients.length) return event;

    const template = await getTemplate(sp, type);
    const text = renderAll(type, template, cleanParams);
    const prefs = await sp('notification_preferences')
      .where({ type })
      .whereIn('user_id', recipients.map((r) => r.id));
    const prefByUser = new Map(prefs.map((p) => [p.user_id, p]));
    const emailSettings = await getEmailSettings(sp);
    const emailAllowed = def.emailAllowed !== false && (def.manual ? options.email === true : rule.email);

    const pushed = [];
    for (const user of recipients) {
      const pref = prefByUser.get(user.id);
      const inApp = (def.manual || rule.in_app) && (def.mandatory || def.manual || pref?.in_app_enabled !== false);
      const wantsEmail = emailAllowed && (def.mandatory || def.manual || pref?.email_enabled !== false);
      if (!inApp && !wantsEmail) continue;

      const [notification] = await sp('notifications')
        .insert({ event_id: event.id, recipient_user_id: user.id, in_app: inApp, title: text.title, body: text.body })
        .onConflict(['event_id', 'recipient_user_id'])
        .ignore()
        .returning('*');
      if (!notification) continue;
      if (inApp) pushed.push(user.id);

      if (wantsEmail) {
        let skipReason = null;
        if (!emailSettings.enabled) skipReason = 'email_disabled';
        else if (!user.email) skipReason = 'no_address';
        await sp('notification_deliveries').insert({
          notification_id: notification.id,
          recipient_user_id: user.id,
          channel: 'email',
          status: skipReason ? 'skipped' : 'pending',
          skip_reason: skipReason,
          subject: text.emailSubject,
          body_text: text.emailBody,
        });
      }
    }

    if (pushed.length) {
      // Payload carries only user ids - clients fetch content over the
      // authenticated API, so nothing sensitive crosses the channel.
      await sp.raw('SELECT pg_notify(?, ?)', [PUSH_CHANNEL, JSON.stringify({ user_ids: pushed })]);
    }
    return event;
  };

  try {
    return await trx.transaction(run);
  } catch (err) {
    console.error(`[notifications] failed to emit ${options.type}:`, err.message);
    return null;
  }
}

/** emit() only when `value` meets the rule's threshold (admin-configurable). */
async function emitIfOver(trx, type, thresholdKey, value, options) {
  try {
    const rule = await getRule(trx, type);
    const threshold = Number(rule.thresholds[thresholdKey] ?? 0);
    if (Number(value) < threshold) return null;
  } catch (err) {
    console.error(`[notifications] threshold check for ${type} failed:`, err.message);
    return null;
  }
  return emit(trx, { type, ...options });
}

/** Closes open events for a key (e.g. low stock once replenished). Returns how many closed. */
async function resolve(trx, dedupKey) {
  try {
    return await trx('notification_events')
      .where({ dedup_key: dedupKey })
      .whereNull('resolved_at')
      .update({ resolved_at: trx.fn.now() });
  } catch (err) {
    console.error('[notifications] resolve failed:', err.message);
    return 0;
  }
}

/** Hour bucket for grouping bursts: one open event per key per hour. */
function hourBucket(date = new Date()) {
  return date.toISOString().slice(0, 13);
}

async function actorName(trx, userId) {
  if (!userId) return 'System';
  const user = await trx('users').where({ id: userId }).first('full_name');
  return user?.full_name || 'Unknown user';
}

module.exports = { emit, emitIfOver, resolve, resolveRecipients, hourBucket, actorName, PUSH_CHANNEL };
