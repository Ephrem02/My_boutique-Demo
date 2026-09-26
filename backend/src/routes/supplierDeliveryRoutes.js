const express = require('express');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const deliveries = require('../controllers/supplierDeliveryController');

// Purchase invoices (goods received). Payments, refunds, credits, returns and
// reversals live under /api/finance/supplier - see financeRoutes.js.
const router = express.Router();
router.use(authenticate);

router.get('/unpaid-summary', requirePermission('supplier_payments.view'), deliveries.unpaidSummary);
router.get('/', requirePermission('supplier_deliveries.view'), deliveries.list);
router.get('/:id', requirePermission('supplier_deliveries.view'), deliveries.getOne);
router.post('/', requirePermission('supplier_deliveries.manage'), deliveries.create); // audited in the service

module.exports = router;
