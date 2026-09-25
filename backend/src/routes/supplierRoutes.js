const express = require('express');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const { auditRoute } = require('../audit/auditRoute');
const suppliers = require('../controllers/supplierController');

const router = express.Router();
router.use(authenticate);

router.get('/', requirePermission('suppliers.view'), suppliers.list);
router.get('/:id', requirePermission('suppliers.view'), suppliers.getOne);
router.post('/', requirePermission('suppliers.manage'), auditRoute('supplier.create', 'supplier'), suppliers.create);
router.put('/:id', requirePermission('suppliers.manage'), auditRoute('supplier.update', 'supplier'), suppliers.update);
router.delete('/:id', requirePermission('suppliers.manage'), auditRoute('supplier.delete', 'supplier'), suppliers.remove);

module.exports = router;
