// Append-only audit trail (see migration 20260101000012 and
// scripts/setup-db-roles.js for how it's protected).
//
// Everything written here passes through redact(): password/token/secret
// fields are replaced with [REDACTED], control characters are stripped, and
// sizes are capped - so request bodies can be passed in without leaking
// credentials or enabling log injection.
const db = require('../config/db');
const { redact, cleanString } = require('../utils/sanitize');

/**
 * audit(req, entry, { trx, required })
 *  entry: { action, entityType, entityId, oldValues, newValues, metadata,
 *           result: 'success'|'denied'|'failure', actorUserId, actorRole }
 *  - actor defaults to req.user
 *  - pass trx to write in the same transaction as the change it describes
 *  - required: true rethrows on failure (use for admin configuration
 *    changes, which must not happen unaudited); otherwise failures are
 *    logged and swallowed so auditing can't break normal operations.
 */
async function audit(req, entry, { trx = db, required = false } = {}) {
  const row = {
    actor_user_id: entry.actorUserId ?? req?.user?.id ?? null,
    actor_role: entry.actorRole ?? req?.user?.role ?? null,
    action: cleanString(entry.action, { max: 100, singleLine: true }),
    entity_type: entry.entityType ? cleanString(entry.entityType, { max: 64, singleLine: true }) : null,
    entity_id: entry.entityId !== undefined && entry.entityId !== null ? cleanString(entry.entityId, { max: 64, singleLine: true }) : null,
    old_values: entry.oldValues ? JSON.stringify(redact(entry.oldValues)) : null,
    new_values: entry.newValues ? JSON.stringify(redact(entry.newValues)) : null,
    metadata: entry.metadata ? JSON.stringify(redact(entry.metadata)) : null,
    result: entry.result || 'success',
    ip: req?.ip ? cleanString(req.ip, { max: 64, singleLine: true }) : null,
    user_agent: req?.get?.('user-agent') ? cleanString(req.get('user-agent'), { max: 300, singleLine: true }) : null,
    request_id: req?.requestId || null,
  };
  try {
    await trx('audit_logs').insert(row);
  } catch (err) {
    console.error('[audit] failed to write audit log:', err.message);
    if (required) throw err;
  }
}

module.exports = { audit };
