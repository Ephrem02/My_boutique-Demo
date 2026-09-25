const express = require('express');
const rateLimit = require('express-rate-limit');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const admin = require('../controllers/adminNotificationController');
const auditLogs = require('../controllers/auditController');
const businessDays = require('../controllers/businessDayController');

const router = express.Router();
router.use(authenticate);

// Anything that can cause email to go out is throttled per admin account,
// on top of the worker's daily and per-recipient caps.
const outboundLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: Number(process.env.ADMIN_SEND_RATE_LIMIT) || 30,
  keyGenerator: (req) => `user:${req.user.id}`,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many sends this hour - please wait before sending more.' },
});

const manage = requirePermission('notifications.manage');
const deliveries = requirePermission('notifications.deliveries.manage');
const settings = requirePermission('settings.manage');
const auditView = requirePermission('audit.view');

router.get('/monitoring', manage, admin.monitoring);
router.get('/notification-types', manage, admin.listTypes);
router.get('/notification-events', manage, admin.listEvents);
router.post('/notifications/manual', manage, outboundLimiter, admin.sendManual);

router.get('/notification-rules', manage, admin.listRules);
router.put('/notification-rules/:type', manage, admin.updateRule);
router.post('/notification-rules/:type/reset', manage, admin.resetRule);

router.get('/notification-templates', manage, admin.listTemplates);
router.put('/notification-templates/:type', manage, admin.updateTemplate);
router.post('/notification-templates/:type/reset', manage, admin.resetTemplate);
router.post('/notification-templates/:type/preview', manage, admin.previewTemplate);

router.get('/email-settings', settings, admin.getEmailSettingsView);
router.put('/email-settings', settings, admin.updateEmailSettings);
router.post('/email-settings/test', settings, outboundLimiter, admin.sendTestEmail);

router.get('/deliveries', deliveries, admin.listDeliveries);
router.post('/deliveries/:id/resend', deliveries, outboundLimiter, admin.resendDelivery);

router.get('/closing-settings', settings, businessDays.getSettings);
router.put('/closing-settings', settings, businessDays.updateSettings);

router.get('/audit-logs', auditView, auditLogs.list);
router.get('/audit-logs/export', auditView, auditLogs.exportCsv);

module.exports = router;
