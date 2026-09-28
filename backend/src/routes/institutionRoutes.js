const express = require('express');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const { auditRoute } = require('../audit/auditRoute');
const institutions = require('../controllers/institutionController');

const router = express.Router();
router.use(authenticate);

router.get('/', requirePermission('institutions.view'), institutions.list);
router.get('/:id', requirePermission('institutions.view'), institutions.getOne);
router.post('/', requirePermission('institutions.manage'), institutions.create);
router.put('/:id', requirePermission('institutions.manage'), institutions.update);
// Credit limit: managers only (credit.manage), audited before/after
router.put('/:id/credit', requirePermission('credit.manage'), institutions.updateCredit);
router.delete('/:id', requirePermission('institutions.manage'), auditRoute('institution.delete', 'institution'), institutions.remove);

module.exports = router;
