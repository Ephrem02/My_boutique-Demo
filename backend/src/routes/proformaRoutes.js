const express = require('express');
const { authenticate } = require('../middleware/auth');
const { idempotent } = require('../middleware/idempotency');
const { requirePermission } = require('../middleware/rbac');
const { handleServiceError } = require('../utils/handleServiceError');
const { audit } = require('../audit/auditService');
const proformas = require('../documents/proformas');

// /api/proformas - price proposals before a sale. Whoever may make customer
// invoices may issue, cancel and convert them; anyone who sees invoices may read them.
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

router.get('/', requirePermission('institution_orders.view'), handle(async (req, res) => {
  res.json(await proformas.listProformas({ status: req.query.status, institutionId: req.query.institution_id }));
}));

router.get('/:id', requirePermission('institution_orders.view'), handle(async (req, res) => {
  const result = await proformas.proformaDocument({ id: req.params.id, format: req.query.format === 'pdf' ? 'pdf' : 'json', generatedBy: req.user.full_name });
  if (!result.pdf) return res.json(result.model);
  await audit(req, { action: 'document.download', entityType: 'proforma', entityId: result.model.id, metadata: { type: 'proforma', format: 'pdf' } });
  res.setHeader('Content-Type', 'application/octet-stream'); // plain bytes - see documentRoutes.js
  res.setHeader('X-Document-Type', 'application/pdf');
  res.setHeader('X-Document-Filename', result.filename);
  res.setHeader('Cache-Control', 'no-store');
  return res.send(result.pdf);
}));

router.post('/', requirePermission('institution_orders.manage'), handle(async (req, res) => {
  res.status(201).json(await proformas.createProforma({ req, body: req.body }));
}));

router.post('/:id/cancel', requirePermission('institution_orders.manage'), handle(async (req, res) => {
  res.json(await proformas.cancelProforma({ req, id: req.params.id, reason: req.body?.reason }));
}));

router.post('/:id/convert', requirePermission('institution_orders.manage'), handle(async (req, res) => {
  res.status(201).json(await proformas.convertProforma({ req, id: req.params.id, body: req.body }));
}));

module.exports = router;
