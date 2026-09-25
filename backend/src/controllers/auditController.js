// Read-only audit log access (audit.view). The runtime DB role can't modify
// audit_logs at all, so there are deliberately no write endpoints here.
const db = require('../config/db');
const { audit } = require('../audit/auditService');

const EXPORT_LIMIT = 10000;

function filtered(req) {
  const { user_id, role, action, entity_type, entity_id, result, ip, from, to, q } = req.query;
  const query = db('audit_logs as a').leftJoin('users as u', 'u.id', 'a.actor_user_id');
  if (user_id) query.where('a.actor_user_id', Number(user_id) || 0);
  if (role) query.where('a.actor_role', role);
  if (action) query.where('a.action', 'like', `${String(action).replace(/[%_\\]/g, '\\$&')}%`);
  if (entity_type) query.where('a.entity_type', entity_type);
  if (entity_id) query.where('a.entity_id', String(entity_id));
  if (result) query.where('a.result', result);
  if (ip) query.where('a.ip', ip);
  if (from) query.where('a.created_at', '>=', from);
  if (to) query.where('a.created_at', '<=', `${to} 23:59:59`);
  if (q) query.whereRaw('a.metadata::text ILIKE ?', [`%${String(q).replace(/[%_\\]/g, '\\$&').slice(0, 100)}%`]);
  return query;
}

const COLUMNS = [
  'a.id', 'a.created_at', 'a.actor_user_id', 'u.full_name as actor_name', 'a.actor_role', 'a.action', 'a.entity_type',
  'a.entity_id', 'a.result', 'a.ip', 'a.user_agent', 'a.request_id', 'a.old_values', 'a.new_values', 'a.metadata',
];

// GET /api/admin/audit-logs?user_id=&role=&action=&entity_type=&entity_id=&result=&ip=&from=&to=&q=&page=&limit=
async function list(req, res) {
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
  const page = Math.max(Number(req.query.page) || 1, 1);
  const query = filtered(req);
  const [{ count }] = await query.clone().count('* as count');
  const items = await query.select(COLUMNS).orderBy('a.id', 'desc').limit(limit).offset((page - 1) * limit);
  const actions = await db('audit_logs').distinct('action').orderBy('action').pluck('action');
  res.json({ items, total: Number(count), page, limit, actions });
}

// Spreadsheet apps execute cells starting with = + - @ (CSV injection);
// prefix them so exported values are always inert text.
function csvCell(value) {
  if (value === null || value === undefined) return '';
  let s = typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

// GET /api/admin/audit-logs/export (same filters) - CSV, capped, and itself audited
async function exportCsv(req, res) {
  const rows = await filtered(req).select(COLUMNS).orderBy('a.id', 'desc').limit(EXPORT_LIMIT);
  await audit(req, {
    action: 'audit.export',
    entityType: 'audit_log',
    metadata: { filters: req.query, row_count: rows.length },
  }, { required: true });

  const headers = ['id', 'created_at', 'actor_user_id', 'actor_name', 'actor_role', 'action', 'entity_type', 'entity_id',
    'result', 'ip', 'user_agent', 'request_id', 'old_values', 'new_values', 'metadata'];
  const lines = [headers.join(',')];
  for (const r of rows) lines.push(headers.map((h) => csvCell(h === 'created_at' ? r[h]?.toISOString?.() ?? r[h] : r[h])).join(','));

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="audit-log-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(lines.join('\n'));
}

module.exports = { list, exportCsv, csvCell };
