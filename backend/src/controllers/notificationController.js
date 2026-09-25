// A user's own notifications. Every query is scoped with
// recipient_user_id = req.user.id; anything else is a 404, never a 403, so
// notification ids can't be probed. No permission code is needed - every
// signed-in user has an inbox - but nobody can read anyone else's.
const db = require('../config/db');
const { TYPES, CATEGORIES, SEVERITIES } = require('../notifications/types');
const { eligibleRoles } = require('../notifications/rules');
const { unreadCount, pushUnread } = require('../notifications/realtime');
const { audit } = require('../audit/auditService');

const COLUMNS = [
  'notifications.id', 'notifications.title', 'notifications.body', 'notifications.read_at',
  'notifications.archived_at', 'notifications.created_at',
  'notification_events.type', 'notification_events.category', 'notification_events.severity',
  'notification_events.entity_type', 'notification_events.entity_id', 'notification_events.occurrence_count',
];

function ownInbox(userId) {
  return db('notifications')
    .join('notification_events', 'notification_events.id', 'notifications.event_id')
    .where({ 'notifications.recipient_user_id': userId, 'notifications.in_app': true });
}

// GET /api/notifications?status=unread|read|all&category=&severity=&archived=true&page=&limit=
async function list(req, res) {
  const { status = 'all', category, severity, archived } = req.query;
  const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 50);
  const page = Math.max(Number(req.query.page) || 1, 1);

  const query = ownInbox(req.user.id);
  if (archived === 'true') query.whereNotNull('notifications.archived_at');
  else query.whereNull('notifications.archived_at');
  if (status === 'unread') query.whereNull('notifications.read_at');
  if (status === 'read') query.whereNotNull('notifications.read_at');
  if (category && CATEGORIES.includes(category)) query.where('notification_events.category', category);
  if (severity && SEVERITIES.includes(severity)) query.where('notification_events.severity', severity);

  const [{ count }] = await query.clone().count('* as count');
  const items = await query
    .select(COLUMNS)
    .orderBy('notifications.created_at', 'desc')
    .orderBy('notifications.id', 'desc')
    .limit(limit)
    .offset((page - 1) * limit);

  res.json({ items, total: Number(count), page, limit, unread: await unreadCount(req.user.id) });
}

async function getUnreadCount(req, res) {
  res.json({ count: await unreadCount(req.user.id) });
}

async function setFlag(req, res, changes) {
  const updated = await db('notifications')
    .where({ id: req.params.id, recipient_user_id: req.user.id, in_app: true })
    .update(changes)
    .returning('id');
  if (!updated.length) return res.status(404).json({ error: 'Notification not found' });
  pushUnread(req.user.id).catch(() => {});
  res.json({ id: updated[0].id ?? updated[0], unread: await unreadCount(req.user.id) });
}

// PATCH /api/notifications/:id/read  { read: true|false }
function markRead(req, res) {
  return setFlag(req, res, { read_at: req.body?.read === false ? null : db.fn.now() });
}

// PATCH /api/notifications/:id/archive  { archived: true|false }
function archive(req, res) {
  return setFlag(req, res, { archived_at: req.body?.archived === false ? null : db.fn.now() });
}

// POST /api/notifications/read-all
async function markAllRead(req, res) {
  const updated = await db('notifications')
    .where({ recipient_user_id: req.user.id, in_app: true })
    .whereNull('read_at')
    .whereNull('archived_at')
    .update({ read_at: db.fn.now() });
  pushUnread(req.user.id).catch(() => {});
  res.json({ updated, unread: 0 });
}

/** Types this user could ever receive: via their role's permissions, or as a target. */
async function relevantTypes(user) {
  const types = [];
  for (const [type, def] of Object.entries(TYPES)) {
    if (def.manual) continue;
    const viaRole = def.permission && user.permissions.includes(def.permission) && def.roles.includes(user.role);
    const viaTarget = def.targetAlways || (def.roles.includes(user.role) && !user.permissions.includes(def.permission));
    if (viaRole || viaTarget) types.push(type);
  }
  return types;
}

// GET /api/notifications/preferences
async function getPreferences(req, res) {
  const types = await relevantTypes(req.user);
  const rows = await db('notification_preferences').where({ user_id: req.user.id });
  const byType = new Map(rows.map((r) => [r.type, r]));
  res.json(types.map((type) => {
    const def = TYPES[type];
    const pref = byType.get(type);
    return {
      type,
      category: def.category,
      mandatory: !!def.mandatory,
      email_available: def.emailAllowed !== false,
      in_app_enabled: def.mandatory ? true : pref?.in_app_enabled ?? true,
      email_enabled: def.mandatory ? true : pref?.email_enabled ?? true,
    };
  }));
}

// PUT /api/notifications/preferences  { preferences: [{ type, in_app_enabled, email_enabled }] }
async function updatePreferences(req, res) {
  const input = req.body?.preferences;
  if (!Array.isArray(input) || input.length > 100) {
    return res.status(400).json({ error: 'preferences must be an array' });
  }
  const allowed = new Set(await relevantTypes(req.user));
  const rows = [];
  for (const p of input) {
    if (!allowed.has(p?.type)) return res.status(400).json({ error: `Unknown notification type: ${String(p?.type).slice(0, 64)}` });
    if (TYPES[p.type].mandatory) continue; // silently kept on - can't opt out
    if (typeof p.in_app_enabled !== 'boolean' || typeof p.email_enabled !== 'boolean') {
      return res.status(400).json({ error: 'in_app_enabled and email_enabled must be true or false' });
    }
    rows.push({ user_id: req.user.id, type: p.type, in_app_enabled: p.in_app_enabled, email_enabled: p.email_enabled, updated_at: db.fn.now() });
  }
  if (rows.length) {
    await db('notification_preferences').insert(rows).onConflict(['user_id', 'type']).merge();
  }
  await audit(req, {
    action: 'notification.preferences_update',
    entityType: 'user',
    entityId: req.user.id,
    newValues: { preferences: rows.map(({ type, in_app_enabled, email_enabled }) => ({ type, in_app_enabled, email_enabled })) },
  });
  return getPreferences(req, res);
}

module.exports = { list, getUnreadCount, markRead, archive, markAllRead, getPreferences, updatePreferences, relevantTypes, eligibleRoles };
