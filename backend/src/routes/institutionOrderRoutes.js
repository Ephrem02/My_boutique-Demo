const express = require('express');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const orders = require('../controllers/institutionOrderController');

const router = express.Router();
router.use(authenticate);

// Specific path before the :id param route
router.get('/unpaid-summary', requirePermission('institution_payments.view'), orders.unpaidSummary);

router.get('/', requirePermission('institution_orders.view'), orders.list);
router.get('/:id', requirePermission('institution_orders.view'), orders.getOne);
router.post('/', requirePermission('institution_orders.manage'), orders.create);
router.post('/:id/deliver', requirePermission('institution_orders.manage'), orders.deliver);
router.post('/:id/payments', requirePermission('institution_payments.manage'), orders.pay);

module.exports = router;
