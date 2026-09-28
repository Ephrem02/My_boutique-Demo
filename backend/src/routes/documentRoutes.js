const express = require('express');
const { authenticate } = require('../middleware/auth');
const { requirePermission, can } = require('../middleware/rbac');
const { handleServiceError } = require('../utils/handleServiceError');
const { audit } = require('../audit/auditService');
const { recordAccessDenied } = require('../audit/securityMonitor');
const business = require('../documents/business');
const { dailyReport, canPrintDay } = require('../documents/dailyReport');
const { employeeReport } = require('../documents/employeeProfile');

// /api/documents - printable reports built on the server from stored records.
// ?format=pdf streams a PDF (audited as a download); otherwise the same data
// model is returned as JSON for the screen.
const router = express.Router();
router.use(authenticate);

const handle = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (err) {
    handleServiceError(err, res);
  }
};

const deny = (req, res, required) => {
  recordAccessDenied(req, required).catch(() => {});
  return res.status(403).json({ error: 'You do not have permission to see this report', required });
};

async function send(req, res, result, { type, entityType, entityId, params }) {
  if (!result.pdf) return res.json(result.model);
  await audit(req, { action: 'document.download', entityType, entityId, metadata: { type, format: 'pdf', ...params } });
  // The page fetches this with a script and names/opens the file itself, so
  // it is sent as plain bytes: a browser without a PDF viewer (e.g. headless
  // Chrome) hijacks anything recognisable as a PDF - by type or by a .pdf
  // filename - into a download, and the script's request then fails.
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('X-Document-Type', 'application/pdf');
  res.setHeader('X-Document-Filename', result.filename);
  res.setHeader('Cache-Control', 'no-store');
  return res.send(result.pdf);
}

// Business identity printed on documents
router.get('/settings', handle(async (req, res) => res.json(await business.getBusiness())));
router.put('/settings', requirePermission('settings.manage'), handle(async (req, res) => res.json(await business.updateBusiness({ req, input: req.body }))));

// Daily report: managers any day; staff with day.view only the day in progress
router.get('/daily/:dayId', handle(async (req, res) => {
  if (!(await canPrintDay(req, req.params.dayId))) return deny(req, res, ['day.history.view']);
  const format = req.query.format === 'pdf' ? 'pdf' : 'json';
  const result = await dailyReport({ dayId: req.params.dayId, canSeeStaff: can(req, 'day.history.view'), format, generatedBy: req.user.full_name });
  return send(req, res, result, { type: 'daily_report', entityType: 'business_day', entityId: result.model.day.id });
}));

// Employee 360° / report: managers for anyone, everyone for themselves ("me")
router.get('/employees/:id', handle(async (req, res) => {
  const userId = req.params.id === 'me' ? req.user.id : Number(req.params.id) || 0;
  if (userId !== req.user.id && !can(req, 'employees.manage')) return deny(req, res, ['employees.manage']);
  const format = req.query.format === 'pdf' ? 'pdf' : 'json';
  const result = await employeeReport({
    userId, from: req.query.from, to: req.query.to, canSeeAudit: can(req, 'audit.view'), format, generatedBy: req.user.full_name,
  });
  return send(req, res, result, { type: 'employee_report', entityType: 'user', entityId: userId, params: { from: result.model.period.from, to: result.model.period.to } });
}));

module.exports = router;
