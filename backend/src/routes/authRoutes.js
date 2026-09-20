const express = require('express');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const { login, createEmployee, listEmployees, updateEmployee } = require('../controllers/authController');

const router = express.Router();

router.post('/login', login);
router.post('/employees', authenticate, requirePermission('employees.manage'), createEmployee);
router.get('/employees', authenticate, requirePermission('employees.manage'), listEmployees);
router.patch('/employees/:id', authenticate, requirePermission('employees.manage'), updateEmployee);

module.exports = router;
