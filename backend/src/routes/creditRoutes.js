const express = require('express');
const { authenticate } = require('../middleware/auth');
const { idempotent } = require('../middleware/idempotency');
const { requirePermission } = require('../middleware/rbac');
const { handleServiceError } = require('../utils/handleServiceError');
const credit = require('../finance/credit');

// /api/credit-exceptions - going over a client's credit limit.
// Whoever sells on account may ask; only a manager (credit.manage) decides,
// and never on their own request (also a DB CHECK).
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

router.get('/', requirePermission('credit.manage', 'institution_orders.manage'), handle(async (req, res) => {
  res.json(await credit.listExceptions({ status: req.query.status, institutionId: req.query.institution_id }));
}));

router.post('/', requirePermission('institution_orders.manage'), handle(async (req, res) => {
  const b = req.body || {};
  res.status(201).json(await credit.requestException({ req, institutionId: b.institution_id, amount: b.amount, reason: b.reason }));
}));

router.post('/:id/decision', requirePermission('credit.manage'), handle(async (req, res) => {
  res.json(await credit.decideException({ req, id: req.params.id, decision: req.body?.decision, note: req.body?.note }));
}));

module.exports = router;
