const express = require('express');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const stock = require('../controllers/stockController');

const router = express.Router();

router.use(authenticate);

router.get('/locations', requirePermission('stock.view'), stock.getLocations);
router.get('/levels', requirePermission('stock.view'), stock.getLevels);
// Movement history names who did what - not for cashiers (least privilege)
router.get('/movements', requirePermission('stock.movements.view'), stock.getMovements);
router.post('/intake', requirePermission('stock.intake'), stock.intake);
router.post('/transfer', requirePermission('stock.transfer'), stock.transfer);
router.post('/damage', requirePermission('stock.adjust'), stock.reportDamage);

module.exports = router;
