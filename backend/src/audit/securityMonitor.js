// Security signals: failed logins and permission denials are audited, and a
// burst of either raises a grouped, mandatory alert for managers (one open
// alert per account/user per hour, with an occurrence count - not one
// notification per attempt).
const db = require('../config/db');
const { audit } = require('./auditService');
const { emit, hourBucket } = require('../notifications/notificationService');
const { getRule } = require('../notifications/rules');
const { cleanString } = require('../utils/sanitize');

async function countRecent(action, column, value, minutes) {
  const { count } = await db('audit_logs')
    .where({ action })
    .whereRaw(`metadata->>'${column}' = ?`, [value])
    .where('created_at', '>', db.raw(`now() - (? * interval '1 minute')`, [minutes]))
    .count('* as count')
    .first();
  return Number(count);
}

/** reason: 'unknown_account' | 'bad_password' | 'disabled' | 'rate_limited' */
async function recordFailedLogin(req, { identifier, reason, userId = null }) {
  const id = cleanString(String(identifier || '').toLowerCase(), { max: 120, singleLine: true });
  await audit(req, {
    action: reason === 'rate_limited' ? 'auth.login_rate_limited' : 'auth.login_failed',
    entityType: 'user',
    entityId: userId,
    actorUserId: userId,
    actorRole: null,
    result: 'denied',
    metadata: { identifier: id, reason },
  });
  if (reason === 'rate_limited' || !id) return;

  try {
    const rule = await getRule(db, 'FAILED_LOGIN_BURST');
    const { failures, window_minutes: windowMinutes } = rule.thresholds;
    const count = await countRecent('auth.login_failed', 'identifier', id, windowMinutes);
    if (count < failures) return;
    await emit(db, {
      type: 'FAILED_LOGIN_BURST',
      dedupKey: `FAILED_LOGIN_BURST:${id}:${hourBucket()}`,
      group: true,
      entityType: 'user',
      entityId: userId,
      params: { identifier: id, failure_count: count, window_minutes: windowMinutes, ip: req.ip || 'unknown' },
    });
  } catch (err) {
    console.error('[security] failed-login burst check failed:', err.message);
  }
}

async function recordAccessDenied(req, requiredCodes) {
  const userId = req.user?.id;
  await audit(req, {
    action: 'access.denied',
    entityType: 'route',
    entityId: `${req.method} ${req.baseUrl}${req.route?.path || ''}`,
    result: 'denied',
    metadata: { user_id: String(userId), required: requiredCodes, path: req.originalUrl },
  });
  if (!userId) return;

  try {
    const rule = await getRule(db, 'ACCESS_DENIED_BURST');
    const { denials, window_minutes: windowMinutes } = rule.thresholds;
    const count = await countRecent('access.denied', 'user_id', String(userId), windowMinutes);
    if (count < denials) return;
    await emit(db, {
      type: 'ACCESS_DENIED_BURST',
      dedupKey: `ACCESS_DENIED_BURST:user:${userId}:${hourBucket()}`,
      group: true,
      entityType: 'user',
      entityId: userId,
      actorUserId: userId,
      params: { user_name: req.user.full_name, denial_count: count, window_minutes: windowMinutes },
    });
  } catch (err) {
    console.error('[security] access-denied burst check failed:', err.message);
  }
}

module.exports = { recordFailedLogin, recordAccessDenied };
