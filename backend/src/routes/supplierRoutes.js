const express = require('express');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const suppliers = require('../controllers/supplierController');

const router = express.Router();
router.use(authenticate);

router.get('/', requirePermission('suppliers.view'), suppliers.list);
router.get('/:id', requirePermission('suppliers.view'), suppliers.getOne);
router.post('/', requirePermission('suppliers.manage'), suppliers.create);
router.put('/:id', requirePermission('suppliers.manage'), suppliers.update);
router.delete('/:id', requirePermission('suppliers.manage'), suppliers.remove);

module.exports = router;
