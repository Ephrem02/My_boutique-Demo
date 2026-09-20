const express = require('express');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const categories = require('../controllers/categoryController');

const router = express.Router();
router.use(authenticate);

router.get('/', requirePermission('products.view'), categories.list);
router.post('/', requirePermission('products.manage'), categories.create);
router.put('/:id', requirePermission('products.manage'), categories.update);
router.delete('/:id', requirePermission('products.manage'), categories.remove);

module.exports = router;
