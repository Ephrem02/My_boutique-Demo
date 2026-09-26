const express = require('express');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const { auditRoute } = require('../audit/auditRoute');
const orders = require('../controllers/institutionOrderController');

// Customer sales invoices. Payments, refunds, credits, returns and reversals
// live under /api/finance/customer - see financeRoutes.js.
const router = express.Router();
router.use(authenticate);

router.get('/unpaid-summary', requirePermission('institution_payments.view'), orders.unpaidSummary);
router.get('/', requirePermission('institution_orders.view'), orders.list);
router.get('/:id', requirePermission('institution_orders.view'), orders.getOne);
router.post('/', requirePermission('institution_orders.manage'), orders.create); // audited in the service
router.post('/:id/deliver', requirePermission('institution_orders.manage'), auditRoute('institution_order.deliver', 'institution_order'), orders.deliver);

module.exports = router;
