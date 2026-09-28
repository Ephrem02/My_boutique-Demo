const express = require('express');
const { authenticate } = require('../middleware/auth');
const { idempotent } = require('../middleware/idempotency');
const { requirePermission } = require('../middleware/rbac');
const { handleServiceError } = require('../utils/handleServiceError');
const { audit } = require('../audit/auditService');
const counts = require('../models/stockCountService');
const { stockCountDocument } = require('../documents/stockCountDocs');

// /api/stock-counts - physical counts. Counters (stock.count) start, count and
// submit; a manager who did not count (stock.count.approve) decides.
const router = express.Router();
router.use(authenticate);
router.use(idempotent());

const handle = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (err) {
    handleServiceError(err, res);
  }
};
const anyCount = requirePermission('stock.count', 'stock.count.approve');

router.get('/', anyCount, handle(async (req, res) => res.json(await counts.listCounts({ status: req.query.status }))));
router.get('/:id', anyCount, handle(async (req, res) => {
  if (req.query.format !== 'pdf') return res.json(await counts.getCount({ req, id: req.params.id }));
  const kind = req.query.kind === 'sheet' ? 'sheet' : 'report';
  const doc = await stockCountDocument({ req, id: req.params.id, kind, generatedBy: req.user.full_name });
  await audit(req, { action: 'document.download', entityType: 'stock_count', entityId: doc.model.id, metadata: { type: `stock_count_${kind}`, format: 'pdf' } });
  res.setHeader('Content-Type', 'application/octet-stream'); // plain bytes - see documentRoutes.js
  res.setHeader('X-Document-Type', 'application/pdf');
  res.setHeader('X-Document-Filename', doc.filename);
  return res.send(doc.pdf);
}));
router.post('/', requirePermission('stock.count'), handle(async (req, res) => res.status(201).json(await counts.startCount({ req, body: req.body }))));
router.put('/:id/lines', requirePermission('stock.count'), handle(async (req, res) => res.json(await counts.saveLines({ req, id: req.params.id, lines: req.body?.lines }))));
router.post('/:id/submit', requirePermission('stock.count'), handle(async (req, res) => res.json(await counts.submitCount({ req, id: req.params.id }))));
router.post('/:id/cancel', anyCount, handle(async (req, res) => res.json(await counts.cancelCount({ req, id: req.params.id, reason: req.body?.reason }))));
router.post('/:id/decision', requirePermission('stock.count.approve'), handle(async (req, res) => {
  res.json(await counts.decideCount({ req, id: req.params.id, decision: req.body?.decision, note: req.body?.note }));
}));

module.exports = router;
