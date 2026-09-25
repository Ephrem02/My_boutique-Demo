// Admin: notification rules, templates, email settings, deliveries, manual
// notifications, events and monitoring. Route-level permissions are in
// routes/adminRoutes.js; every configuration change below is audited inside
// the same transaction (required: true), so a change can't land unaudited.
const crypto = require('crypto');
const db = require('../config/db');
const { TYPES, ROLES, SEVERITIES, CATEGORIES } = require('../notifications/types');
const { getRule, validateRule, eligibleRoles, defaultRule } = require('../notifications/rules');
const templates = require('../notifications/templates');
const { getEmailSettings, validateEmailSettings, saveEmailSettings } = require('../notifications/settings');
const { describeTransport } = require('../notifications/email/transport');
const worker = require('../notifications/worker');
const { emit } = require('../notifications/notificationService');
const { audit } = require('../audit/auditService');
const { handleServiceError } = require('../utils/handleServiceError');
const { AppError } = require('../utils/AppError');
const { maskEmail, cleanString } = require('../utils/sanitize');
const { can } = require('../middleware/rbac');

function paging(req, max = 100) {
  const limit = Math.min(Math.max(Number(req.query.limit) || 25, 1), max);
  const page = Math.max(Number(req.query.page) || 1, 1);
  return { limit, page, offset: (page - 1) * limit };
}

// ---------- Catalogue & rules ----------

// GET /api/admin/notification-types
async function listTypes(req, res) {
  const out = [];
  for (const [type, def] of Object.entries(TYPES)) {
    out.push({
      type,
      category: def.category,
      mandatory: !!def.mandatory,
      manual: !!def.manual,
      email_allowed: def.emailAllowed !== false,
      permission: def.permission,
      eligible_roles: def.manual ? ROLES : await eligibleRoles(db, type),
      target_roles: def.roles,
      vars: def.vars,
      threshold_keys: Object.keys(def.thresholds),
    });
  }
  res.json({ types: out, roles: ROLES, severities: SEVERITIES, categories: CATEGORIES });
}

// GET /api/admin/notification-rules
async function listRules(req, res) {
  const rules = [];
  for (const [type, def] of Object.entries(TYPES)) {
    if (def.manual) continue;
    rules.push({ ...(await getRule(db, type)), category: def.category, mandatory: !!def.mandatory });
  }
  res.json(rules);
}

// PUT /api/admin/notification-rules/:type
async function updateRule(req, res) {
  try {
    const { type } = req.params;
    const input = {};
    for (const key of ['enabled', 'recipient_roles', 'in_app', 'email', 'severity', 'thresholds', 'cooldown_minutes']) {
      if (req.body[key] !== undefined) input[key] = req.body[key];
    }
    const rule = await db.transaction(async (trx) => {
      const before = await getRule(trx, type);
      const next = await validateRule(trx, type, input);
      await trx('notification_rules')
        .insert({ ...next, thresholds: JSON.stringify(next.thresholds), updated_by: req.user.id, updated_at: trx.fn.now() })
        .onConflict('type')
        .merge();
      const { customized, ...beforeValues } = before;
      await audit(req, {
        action: 'notification.rule_update', entityType: 'notification_rule', entityId: type,
        oldValues: beforeValues, newValues: next,
      }, { trx, required: true });
      return getRule(trx, type);
    });
    res.json(rule);
  } catch (err) {
    handleServiceError(err, res);
  }
}

// POST /api/admin/notification-rules/:type/reset
async function resetRule(req, res) {
  try {
    const { type } = req.params;
    if (!TYPES[type] || TYPES[type].manual) throw new AppError('Unknown notification type', 404);
    const rule = await db.transaction(async (trx) => {
      const before = await getRule(trx, type);
      await trx('notification_rules').where({ type }).del();
      const { customized, ...beforeValues } = before;
      await audit(req, {
        action: 'notification.rule_reset', entityType: 'notification_rule', entityId: type,
        oldValues: beforeValues, newValues: defaultRule(type),
      }, { trx, required: true });
      return getRule(trx, type);
    });
    res.json(rule);
  } catch (err) {
    handleServiceError(err, res);
  }
}

// ---------- Templates ----------

async function templateView(trx, type) {
  const current = await trx('notification_templates').where({ type }).first();
  const def = TYPES[type];
  return {
    type,
    category: def.category,
    vars: def.vars,
    limits: templates.LIMITS,
    defaults: templates.defaultTemplate(type),
    customized: !!current,
    is_active: current ? current.is_active : null,
    version: current?.version ?? 0,
    updated_at: current?.updated_at ?? null,
    ...(current
      ? { title: current.title, body: current.body, email_subject: current.email_subject, email_body: current.email_body }
      : templates.defaultTemplate(type)),
  };
}

// GET /api/admin/notification-templates
async function listTemplates(req, res) {
  const out = [];
  for (const type of Object.keys(TYPES)) out.push(await templateView(db, type));
  res.json(out);
}

function pickTemplate(body) {
  return Object.fromEntries(templates.FIELDS.map((f) => [f, body?.[f]]));
}

// PUT /api/admin/notification-templates/:type { title, body, email_subject, email_body, is_active }
async function updateTemplate(req, res) {
  try {
    const { type } = req.params;
    if (!TYPES[type]) throw new AppError('Unknown notification type', 404);
    const proposed = pickTemplate(req.body);
    templates.assertValidTemplate(type, proposed);
    const isActive = req.body.is_active === undefined ? true : req.body.is_active;
    if (typeof isActive !== 'boolean') throw new AppError('is_active must be true or false', 422);

    const view = await db.transaction(async (trx) => {
      const before = await trx('notification_templates').where({ type }).forUpdate().first();
      const row = { type, ...proposed, is_active: isActive, version: (before?.version || 0) + 1, updated_by: req.user.id, updated_at: trx.fn.now() };
      await trx('notification_templates').insert(row).onConflict('type').merge();
      await audit(req, {
        action: 'notification.template_update', entityType: 'notification_template', entityId: type,
        oldValues: before ? { ...pickTemplate(before), is_active: before.is_active, version: before.version } : { ...templates.defaultTemplate(type), source: 'default' },
        newValues: { ...proposed, is_active: isActive, version: row.version },
      }, { trx, required: true });
      return templateView(trx, type);
    });
    res.json(view);
  } catch (err) {
    handleServiceError(err, res);
  }
}

// POST /api/admin/notification-templates/:type/reset - back to the built-in text
async function resetTemplate(req, res) {
  try {
    const { type } = req.params;
    if (!TYPES[type]) throw new AppError('Unknown notification type', 404);
    const view = await db.transaction(async (trx) => {
      const before = await trx('notification_templates').where({ type }).forUpdate().first();
      if (before) {
        await trx('notification_templates').where({ type }).del();
        await audit(req, {
          action: 'notification.template_reset', entityType: 'notification_template', entityId: type,
          oldValues: { ...pickTemplate(before), is_active: before.is_active, version: before.version },
          newValues: { ...templates.defaultTemplate(type), source: 'default' },
        }, { trx, required: true });
      }
      return templateView(trx, type);
    });
    res.json(view);
  } catch (err) {
    handleServiceError(err, res);
  }
}

// POST /api/admin/notification-templates/:type/preview - renders with placeholder samples
async function previewTemplate(req, res) {
  try {
    const { type } = req.params;
    if (!TYPES[type]) throw new AppError('Unknown notification type', 404);
    const proposed = pickTemplate(req.body);
    const errors = templates.validateTemplate(type, proposed);
    if (errors.length) return res.status(422).json({ error: errors.join('; '), errors });
    res.json(templates.renderAll(type, proposed, templates.sampleParams(type)));
  } catch (err) {
    handleServiceError(err, res);
  }
}

// ---------- Email settings ----------

// GET /api/admin/email-settings - never includes credentials
async function getEmailSettingsView(req, res) {
  res.json({ settings: await getEmailSettings(), transport: describeTransport() });
}

// PUT /api/admin/email-settings
async function updateEmailSettings(req, res) {
  try {
    const result = await db.transaction(async (trx) => {
      const before = await getEmailSettings(trx);
      const next = validateEmailSettings(before, req.body || {});
      await saveEmailSettings(trx, next, req.user.id);
      await audit(req, {
        action: 'settings.email_update', entityType: 'app_setting', entityId: 'email',
        oldValues: before, newValues: next,
      }, { trx, required: true });
      return next;
    });
    res.json({ settings: result, transport: describeTransport() });
  } catch (err) {
    handleServiceError(err, res);
  }
}

// POST /api/admin/email-settings/test - only ever to the admin's own address
async function sendTestEmail(req, res) {
  try {
    const me = await db('users').where({ id: req.user.id }).first('email');
    if (!me?.email) throw new AppError('Your account has no email address to send a test to');
    const event = await emit(db, {
      type: 'MANUAL',
      dedupKey: `MANUAL:test:${crypto.randomUUID()}`,
      explicitUserIds: [req.user.id],
      email: true,
      actorUserId: req.user.id,
      params: { title: 'Test email', message: 'This is a test of your shop notification email settings.', sender_name: req.user.full_name },
    });
    await audit(req, { action: 'settings.email_test', entityType: 'app_setting', entityId: 'email', metadata: { event_id: event?.id } });
    const summary = await worker.runOnce();
    const delivery = event
      ? await db('notification_deliveries')
        .join('notifications', 'notifications.id', 'notification_deliveries.notification_id')
        .where('notifications.event_id', event.id)
        .first('notification_deliveries.status', 'notification_deliveries.skip_reason', 'notification_deliveries.last_error')
      : null;
    res.json({ delivery, worker: summary });
  } catch (err) {
    handleServiceError(err, res);
  }
}

// ---------- Deliveries ----------

// GET /api/admin/deliveries?status=&type=&from=&to=&page=&limit=
async function listDeliveries(req, res) {
  const { status, type, from, to } = req.query;
  const { limit, page, offset } = paging(req);
  const query = db('notification_deliveries as d')
    .join('notifications as n', 'n.id', 'd.notification_id')
    .join('notification_events as e', 'e.id', 'n.event_id')
    .join('users as u', 'u.id', 'd.recipient_user_id');
  if (status) query.where('d.status', status);
  if (type) query.where('e.type', type);
  if (from) query.where('d.created_at', '>=', from);
  if (to) query.where('d.created_at', '<=', `${to} 23:59:59`);

  const [{ count }] = await query.clone().count('* as count');
  const rows = await query
    .select(
      'd.id', 'd.status', 'd.attempts', 'd.subject', 'd.skip_reason', 'd.last_error', 'd.next_attempt_at',
      'd.sent_at', 'd.created_at', 'd.updated_at', 'e.type', 'e.severity', 'u.full_name as recipient_name', 'u.email as recipient_email'
    )
    .orderBy('d.id', 'desc')
    .limit(limit)
    .offset(offset);
  const byStatus = await db('notification_deliveries').select('status').count('* as count').groupBy('status');

  res.json({
    items: rows.map(({ recipient_email, ...r }) => ({ ...r, recipient_email: maskEmail(recipient_email) })),
    total: Number(count),
    page,
    limit,
    by_status: Object.fromEntries(byStatus.map((r) => [r.status, Number(r.count)])),
  });
}

// POST /api/admin/deliveries/:id/resend - only failed/dead/skipped deliveries
async function resendDelivery(req, res) {
  try {
    const result = await db.transaction(async (trx) => {
      const delivery = await trx('notification_deliveries').where({ id: req.params.id }).forUpdate().first();
      if (!delivery) throw new AppError('Delivery not found', 404);
      if (!['failed', 'dead', 'skipped'].includes(delivery.status)) {
        throw new AppError(`A ${delivery.status} delivery can't be resent`, 409);
      }
      await trx('notification_deliveries').where({ id: delivery.id }).update({
        status: 'pending', attempts: 0, next_attempt_at: trx.fn.now(), skip_reason: null, last_error: null, updated_at: trx.fn.now(),
      });
      await audit(req, {
        action: 'notification.resend', entityType: 'notification_delivery', entityId: delivery.id,
        oldValues: { status: delivery.status, attempts: delivery.attempts, skip_reason: delivery.skip_reason },
        newValues: { status: 'pending', attempts: 0 },
      }, { trx, required: true });
      return { id: delivery.id, status: 'pending' };
    });
    worker.runOnce().catch(() => {});
    res.json(result);
  } catch (err) {
    handleServiceError(err, res);
  }
}

// ---------- Manual notifications ----------

// POST /api/admin/notifications/manual { title, message, recipient_roles?, user_ids?, email? }
async function sendManual(req, res) {
  try {
    const { recipient_roles = [], user_ids = [], email = false } = req.body || {};
    const title = cleanString(String(req.body?.title || '').trim(), { max: 1000, singleLine: true });
    const message = cleanString(String(req.body?.message || '').trim(), { max: 5000 });
    const errors = [];
    if (!title || title.length > 120) errors.push('title is required (max 120 characters)');
    if (!message || message.length > 1000) errors.push('message is required (max 1000 characters)');
    if (/<\s*\/?\s*[a-z!?]/i.test(title + message)) errors.push('title and message must be plain text (no HTML)');
    if (!Array.isArray(recipient_roles) || recipient_roles.some((r) => !ROLES.includes(r))) errors.push('recipient_roles contains an unknown role');
    if (!Array.isArray(user_ids) || user_ids.some((id) => !Number.isInteger(id)) || user_ids.length > 200) errors.push('user_ids must be a list of user ids');
    if (typeof email !== 'boolean') errors.push('email must be true or false');
    if (!errors.length && !recipient_roles.length && !user_ids.length) errors.push('choose at least one role or user');
    if (errors.length) throw new AppError(errors.join('; '), 422);

    const recipients = await db('users')
      .join('roles', 'roles.id', 'users.role_id')
      .where('users.status', 'active')
      .where((qb) => qb.whereIn('roles.name', recipient_roles).orWhereIn('users.id', user_ids))
      .pluck('users.id');
    if (!recipients.length) throw new AppError('No active users match those recipients', 422);

    const event = await db.transaction(async (trx) => {
      const created = await emit(trx, {
        type: 'MANUAL',
        dedupKey: `MANUAL:${crypto.randomUUID()}`,
        explicitUserIds: recipients,
        email,
        actorUserId: req.user.id,
        params: { title, message, sender_name: req.user.full_name },
      });
      if (!created) throw new AppError('The notification could not be sent', 500);
      await audit(req, {
        action: 'notification.manual_send', entityType: 'notification_event', entityId: created.id,
        newValues: { title, message, recipient_roles, user_ids, email, recipient_count: recipients.length },
      }, { trx, required: true });
      return created;
    });
    res.status(201).json({ event_id: event.id, recipient_count: recipients.length });
  } catch (err) {
    handleServiceError(err, res);
  }
}

// ---------- Events (all notifications, admin view) ----------

// GET /api/admin/notification-events?type=&category=&severity=&from=&to=&open=true&page=&limit=
async function listEvents(req, res) {
  const { type, category, severity, from, to, open } = req.query;
  const { limit, page, offset } = paging(req);
  const query = db('notification_events as e').leftJoin('users as a', 'a.id', 'e.actor_user_id');
  if (type) query.where('e.type', type);
  if (category) query.where('e.category', category);
  if (severity) query.where('e.severity', severity);
  if (from) query.where('e.created_at', '>=', from);
  if (to) query.where('e.created_at', '<=', `${to} 23:59:59`);
  if (open === 'true') query.whereNull('e.resolved_at');

  const [{ count }] = await query.clone().count('* as count');
  const rows = await query
    .select(
      'e.*', 'a.full_name as actor_name',
      db.raw('(SELECT COUNT(*)::int FROM notifications n WHERE n.event_id = e.id) as recipient_count'),
      db.raw('(SELECT COUNT(*)::int FROM notifications n WHERE n.event_id = e.id AND n.read_at IS NOT NULL) as read_count')
    )
    .orderBy('e.id', 'desc')
    .limit(limit)
    .offset(offset);
  res.json({ items: rows, total: Number(count), page, limit });
}

// ---------- Monitoring ----------

async function countWhere(table, apply) {
  const q = db(table);
  apply(q);
  const { count } = await q.count('* as count').first();
  return Number(count);
}

// GET /api/admin/monitoring
async function monitoring(req, res) {
  const today = db.raw("date_trunc('day', now())");
  const since = (days) => db.raw(`now() - interval '${Number(days)} days'`);

  const notifications = {
    total: await countWhere('notifications', () => {}),
    unread: await countWhere('notifications', (q) => q.whereNull('read_at').where('in_app', true)),
    today: await countWhere('notification_events', (q) => q.where('created_at', '>=', today)),
    by_severity: Object.fromEntries(
      (await db('notification_events').where('created_at', '>=', since(30)).select('severity').count('* as count').groupBy('severity'))
        .map((r) => [r.severity, Number(r.count)])
    ),
    open_critical: await countWhere('notification_events', (q) => q.where('severity', 'critical').whereNull('resolved_at').where('created_at', '>=', since(7))),
    by_day: (await db('notification_events')
      .where('created_at', '>=', since(14))
      .select(db.raw("to_char(created_at, 'YYYY-MM-DD') as day"), 'severity')
      .count('* as count')
      .groupByRaw("to_char(created_at, 'YYYY-MM-DD'), severity")
      .orderBy('day')).map((r) => ({ ...r, count: Number(r.count) })),
  };

  const deliveryStatus = Object.fromEntries(
    (await db('notification_deliveries').select('status').count('* as count').groupBy('status')).map((r) => [r.status, Number(r.count)])
  );
  const attempted = (deliveryStatus.sent || 0) + (deliveryStatus.dead || 0);
  const avg = await db('notification_deliveries').whereNotNull('sent_at')
    .select(db.raw('AVG(EXTRACT(EPOCH FROM (sent_at - created_at)))::float as seconds')).first();
  const delivery = {
    by_status: deliveryStatus,
    sent_today: await countWhere('notification_deliveries', (q) => q.where('status', 'sent').where('sent_at', '>=', today)),
    success_rate: attempted ? Math.round(((deliveryStatus.sent || 0) / attempted) * 1000) / 10 : null,
    retries: Number((await db('notification_deliveries').where('attempts', '>', 1).count('* as count').first()).count),
    avg_seconds_to_send: avg?.seconds ? Math.round(avg.seconds) : null,
    backlog: (deliveryStatus.pending || 0) + (deliveryStatus.failed || 0),
  };

  const stock = await db('products')
    .leftJoin('stock_levels', 'stock_levels.product_id', 'products.id')
    .where('products.is_active', true)
    .groupBy('products.id')
    .select('products.id', 'products.name', 'products.sku', 'products.reorder_level', db.raw('COALESCE(SUM(stock_levels.quantity), 0)::int as total'));
  const business = {
    low_stock: stock.filter((p) => p.total > 0 && p.total <= p.reorder_level).slice(0, 50),
    out_of_stock: stock.filter((p) => p.total === 0).slice(0, 50),
    voids_7d: await countWhere('sales', (q) => q.where('status', 'voided').where('created_at', '>=', since(7))),
    refunds_7d: await countWhere('returns', (q) => q.where('created_at', '>=', since(7))),
    large_sales_7d: await countWhere('notification_events', (q) => q.where('type', 'HIGH_VALUE_SALE').where('created_at', '>=', since(7))),
    overpayments_30d: await countWhere('notification_events', (q) => q.where('type', 'OVERPAYMENT').where('created_at', '>=', since(30))),
    overdue_supplier_payments: await countWhere('supplier_deliveries', (q) =>
      q.whereIn('status', ['unpaid', 'partial']).whereNotNull('payment_due_date').where('payment_due_date', '<', db.raw('current_date'))),
    shrinkage_events_30d: await countWhere('shrinkage_records', (q) => q.where('created_at', '>=', since(30))),
  };

  let security = null;
  if (can(req, 'audit.view')) {
    const audits = (action, days) => countWhere('audit_logs', (q) => q.where('action', action).where('created_at', '>=', since(days)));
    security = {
      failed_logins_24h: await countWhere('audit_logs', (q) => q.where('action', 'auth.login_failed').where('created_at', '>=', db.raw("now() - interval '24 hours'"))),
      failed_logins_7d: await audits('auth.login_failed', 7),
      rate_limited_logins_7d: await audits('auth.login_rate_limited', 7),
      access_denied_7d: await audits('access.denied', 7),
      role_changes_30d: await audits('user.role_change', 30),
      users_created_30d: await audits('user.create', 30),
      users_disabled_30d: await audits('user.disable', 30),
      password_resets_30d: await audits('user.password_reset', 30),
      recent: await db('audit_logs')
        .whereIn('action', ['auth.login_failed', 'access.denied', 'user.role_change', 'user.disable', 'user.password_reset', 'user.create'])
        .orderBy('id', 'desc')
        .limit(10)
        .select('id', 'action', 'actor_role', 'entity_type', 'entity_id', 'result', 'ip', 'created_at'),
    };
  }

  const system = {
    worker: worker.status(),
    errors_24h: Number((await db('notification_events').where('type', 'SYSTEM_ERROR')
      .where('last_occurred_at', '>=', db.raw("now() - interval '24 hours'"))
      .sum('occurrence_count as n').first()).n || 0),
    dead_deliveries: deliveryStatus.dead || 0,
    delivery_backlog: delivery.backlog,
  };

  res.json({ notifications, delivery, business, security, system, generated_at: new Date().toISOString() });
}

module.exports = {
  listTypes, listRules, updateRule, resetRule,
  listTemplates, updateTemplate, resetTemplate, previewTemplate,
  getEmailSettingsView, updateEmailSettings, sendTestEmail,
  listDeliveries, resendDelivery, sendManual, listEvents, monitoring,
};
