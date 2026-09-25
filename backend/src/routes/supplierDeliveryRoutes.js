const express = require('express');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const { auditRoute } = require('../audit/auditRoute');
const deliveries = require('../controllers/supplierDeliveryController');

const router = express.Router();
router.use(authenticate);

// Specific path before the :id param route, or 'unpaid-summary' would be parsed as an id
router.get('/unpaid-summary', requirePermission('supplier_payments.view'), deliveries.unpaidSummary);

router.get('/', requirePermission('supplier_deliveries.view'), deliveries.list);
router.get('/:id', requirePermission('supplier_deliveries.view'), deliveries.getOne);
router.post('/', requirePermission('supplier_deliveries.manage'), auditRoute('supplier_delivery.create', 'supplier_delivery'), deliveries.create);
router.post('/:id/payments', requirePermission('supplier_payments.manage'), auditRoute('supplier_payment.create', 'supplier_delivery'), deliveries.pay);

module.exports = router;
