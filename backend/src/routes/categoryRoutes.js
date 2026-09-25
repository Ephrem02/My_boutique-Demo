const express = require('express');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const { auditRoute } = require('../audit/auditRoute');
const categories = require('../controllers/categoryController');

const router = express.Router();
router.use(authenticate);

router.get('/', requirePermission('products.view'), categories.list);
router.post('/', requirePermission('products.manage'), auditRoute('category.create', 'category'), categories.create);
router.put('/:id', requirePermission('products.manage'), auditRoute('category.update', 'category'), categories.update);
router.delete('/:id', requirePermission('products.manage'), auditRoute('category.delete', 'category'), categories.remove);

module.exports = router;
