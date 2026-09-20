const express = require('express');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const products = require('../controllers/productController');

const router = express.Router();
router.use(authenticate);

router.get('/', requirePermission('products.view'), products.list);
router.get('/:id', requirePermission('products.view'), products.getOne);
router.post('/', requirePermission('products.manage'), products.create);
router.put('/:id', requirePermission('products.manage'), products.update);
router.delete('/:id', requirePermission('products.manage'), products.remove);

module.exports = router;
