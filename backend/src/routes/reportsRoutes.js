const express = require('express');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const reports = require('../controllers/reportsController');

const router = express.Router();
router.use(authenticate);

router.get('/sales-summary', requirePermission('reports.sales.view'), reports.salesSummary);
router.get('/top-products', requirePermission('reports.sales.view'), reports.topProducts);
router.get('/shrinkage', requirePermission('reports.shrinkage.view'), reports.shrinkage);
router.get('/financial-summary', requirePermission('reports.financial.view'), reports.financialSummary);

module.exports = router;
