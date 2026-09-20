const express = require('express');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const sales = require('../controllers/salesController');

const router = express.Router();
router.use(authenticate);

router.get('/', requirePermission('sales.view'), sales.list);
router.get('/:id', requirePermission('sales.view'), sales.getOne);
router.post('/', requirePermission('sales.create'), sales.create);
router.post('/:id/void', requirePermission('sales.void'), sales.voidOne);

module.exports = router;
