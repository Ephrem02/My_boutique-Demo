const express = require('express');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const days = require('../controllers/businessDayController');

// /api/business-days
const router = express.Router();
router.use(authenticate);

router.get('/dashboard', requirePermission('day.view'), days.dashboard);
router.post('/open', requirePermission('day.open'), days.open);
// Opening requests (declared before /:id so the path isn't taken for an id)
router.get('/opening-requests', requirePermission('day.open.request', 'day.open.review'), days.listOpeningRequests);
router.post('/opening-requests', requirePermission('day.open.request'), days.requestOpening);
router.post('/opening-requests/:id/approve', requirePermission('day.open.review'), days.approveOpening);
router.post('/opening-requests/:id/reject', requirePermission('day.open.review'), days.rejectOpening);
router.get('/current/closing/preview', requirePermission('day.close'), days.preview);
router.post('/current/closing/start', requirePermission('day.close'), days.startClosing);
router.post('/current/closing/cancel', requirePermission('day.close'), days.cancelClosing);
router.post('/current/closing/submit', requirePermission('day.close'), days.submit);

router.get('/', requirePermission('day.history.view'), days.history);
router.get('/:id', requirePermission('day.history.view'), days.detail);
router.get('/:id/timeline', requirePermission('day.history.view'), days.timeline);
router.post('/:id/accept', requirePermission('day.review'), days.accept);
router.post('/:id/recount', requirePermission('day.review'), days.recount);
router.post('/:id/reopen', requirePermission('day.reopen'), days.reopen);

// /api/corrections
const corrections = express.Router();
corrections.use(authenticate);
corrections.get('/', requirePermission('day.corrections.request', 'day.review'), days.listCorrections);
corrections.post('/', requirePermission('day.corrections.request'), days.requestCorrection);
corrections.post('/:id/decision', requirePermission('day.review'), days.decideCorrection);

module.exports = { businessDayRoutes: router, correctionRoutes: corrections };
