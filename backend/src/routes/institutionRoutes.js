const express = require('express');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const institutions = require('../controllers/institutionController');

const router = express.Router();
router.use(authenticate);

router.get('/', requirePermission('institutions.view'), institutions.list);
router.get('/:id', requirePermission('institutions.view'), institutions.getOne);
router.post('/', requirePermission('institutions.manage'), institutions.create);
router.put('/:id', requirePermission('institutions.manage'), institutions.update);
router.delete('/:id', requirePermission('institutions.manage'), institutions.remove);

module.exports = router;
