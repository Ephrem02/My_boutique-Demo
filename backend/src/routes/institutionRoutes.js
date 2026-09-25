const express = require('express');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const { auditRoute } = require('../audit/auditRoute');
const institutions = require('../controllers/institutionController');

const router = express.Router();
router.use(authenticate);

router.get('/', requirePermission('institutions.view'), institutions.list);
router.get('/:id', requirePermission('institutions.view'), institutions.getOne);
router.post('/', requirePermission('institutions.manage'), auditRoute('institution.create', 'institution'), institutions.create);
router.put('/:id', requirePermission('institutions.manage'), auditRoute('institution.update', 'institution'), institutions.update);
router.delete('/:id', requirePermission('institutions.manage'), auditRoute('institution.delete', 'institution'), institutions.remove);

module.exports = router;
