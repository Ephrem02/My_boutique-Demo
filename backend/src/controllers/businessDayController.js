const db = require('../config/db');
const service = require('../businessDay/businessDayService');
const boards = require('../businessDay/boards');
const corrections = require('../businessDay/corrections');
const openingRequests = require('../businessDay/openingRequests');
const closingSettings = require('../businessDay/settings');
const { handleServiceError } = require('../utils/handleServiceError');
const { can } = require('../middleware/rbac');
const { audit } = require('../audit/auditService');

// Wraps a handler so AppErrors become their status + message and anything
// else is reported and hidden behind a generic 500.
const handle = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (err) {
    handleServiceError(err, res);
  }
};

const dayId = (req) => Number(req.params.id) || 0;

module.exports = {
  // GET /api/business-days/dashboard
  dashboard: handle(async (req, res) => res.json(await boards.dashboard(req.user))),

  // POST /api/business-days/open { opening_float }
  open: handle(async (req, res) => res.status(201).json(await service.openDay({ req, openingFloat: req.body?.opening_float }))),

  // GET /api/business-days/opening-requests?status= - reviewers see all, requesters their own
  listOpeningRequests: handle(async (req, res) => {
    res.json(await openingRequests.listRequests({ user: req.user, canReview: can(req, 'day.open.review'), status: req.query.status }));
  }),

  // POST /api/business-days/opening-requests { opening_float, reason, note }
  requestOpening: handle(async (req, res) => {
    const { opening_float: openingFloat, reason, note } = req.body || {};
    res.status(201).json(await openingRequests.createRequest({ req, openingFloat, reason, note }));
  }),

  // POST /api/business-days/opening-requests/:id/approve | reject { comment }
  approveOpening: handle(async (req, res) => res.json(await openingRequests.approveRequest({ req, id: dayId(req), comment: req.body?.comment }))),
  rejectOpening: handle(async (req, res) => res.json(await openingRequests.rejectRequest({ req, id: dayId(req), comment: req.body?.comment }))),

  // POST /api/business-days/current/closing/start | cancel
  startClosing: handle(async (req, res) => res.json(await service.startClosing({ req }))),
  cancelClosing: handle(async (req, res) => res.json(await service.cancelClosing({ req }))),

  // GET /api/business-days/current/closing/preview
  preview: handle(async (req, res) => res.json(await service.previewClosing())),

  // POST /api/business-days/current/closing/submit { counted_cash, explanation }
  submit: handle(async (req, res) => {
    const { day, closing } = await service.submitClosing({ req, countedCash: req.body?.counted_cash, explanation: req.body?.explanation });
    res.status(201).json({
      day: service.dayState(day),
      closing: {
        id: closing.id, version: closing.version, expected_cash: Number(closing.expected_cash), counted_cash: Number(closing.counted_cash),
        variance: Number(closing.variance), variance_band: closing.variance_band,
      },
    });
  }),

  // POST /api/business-days/:id/accept { note } | recount { reason } | reopen { reason }
  accept: handle(async (req, res) => res.json(service.dayState(await service.acceptClosing({ req, dayId: dayId(req), note: req.body?.note })))),
  recount: handle(async (req, res) => res.json(service.dayState(await service.requestRecount({ req, dayId: dayId(req), reason: req.body?.reason })))),
  reopen: handle(async (req, res) => res.json(service.dayState(await service.reopenDay({ req, dayId: dayId(req), reason: req.body?.reason })))),

  // GET /api/business-days (managers)
  history: handle(async (req, res) => {
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), 100);
    res.json(await boards.history({ page, limit }));
  }),

  // GET /api/business-days/:id (managers)
  detail: handle(async (req, res) => {
    const board = await boards.detail(dayId(req));
    if (!board) return res.status(404).json({ error: 'Business day not found' });
    res.json(board);
  }),

  // GET /api/business-days/:id/timeline (managers)
  timeline: handle(async (req, res) => {
    const result = await boards.timeline(dayId(req));
    if (!result) return res.status(404).json({ error: 'Business day not found' });
    res.json(result);
  }),

  // GET /api/corrections?status= - reviewers see all, requesters their own
  listCorrections: handle(async (req, res) => {
    res.json(await corrections.listCorrections({ user: req.user, status: req.query.status, canReview: can(req, 'day.review') }));
  }),

  // POST /api/corrections { business_day_id, field, requested_value, reason, explanation, related_entity_type, related_entity_id }
  requestCorrection: handle(async (req, res) => {
    const b = req.body || {};
    res.status(201).json(await corrections.requestCorrection({
      req, dayId: Number(b.business_day_id) || 0, field: b.field, requestedValue: b.requested_value, reason: b.reason,
      explanation: b.explanation, relatedEntityType: b.related_entity_type, relatedEntityId: b.related_entity_id,
    }));
  }),

  // POST /api/corrections/:id/decision { decision: approve|reject, reason }
  decideCorrection: handle(async (req, res) => {
    res.json(await corrections.decideCorrection({ req, requestId: Number(req.params.id) || 0, decision: req.body?.decision, reason: req.body?.reason }));
  }),

  // GET/PUT /api/admin/closing-settings (settings.manage)
  getSettings: handle(async (req, res) => res.json(await closingSettings.getClosingSettings())),
  updateSettings: handle(async (req, res) => {
    const saved = await db.transaction(async (trx) => {
      const before = await closingSettings.getClosingSettings(trx);
      const next = closingSettings.validateClosingSettings(before, req.body || {});
      await closingSettings.saveClosingSettings(trx, next, req.user.id);
      await audit(req, {
        action: 'closing_settings.update', entityType: 'app_setting', entityId: 'closing', oldValues: before, newValues: next,
      }, { trx, required: true });
      return next;
    });
    res.json(saved);
  }),
};
