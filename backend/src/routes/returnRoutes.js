const express = require('express');
const { authenticate } = require('../middleware/auth');
const { idempotent } = require('../middleware/idempotency');
const { requirePermission } = require('../middleware/rbac');
const returns = require('../controllers/returnController');

const router = express.Router();
router.use(authenticate);
router.use(idempotent()); // POSTs with an Idempotency-Key are never recorded twice

router.get('/', requirePermission('sales.view'), returns.list);
router.post('/', requirePermission('returns.process'), returns.create);

module.exports = router;
