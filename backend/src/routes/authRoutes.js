const express = require('express');
const rateLimit = require('express-rate-limit');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const { recordFailedLogin } = require('../audit/securityMonitor');
const { login, logout, me, createEmployee, listEmployees, updateEmployee } = require('../controllers/authController');

const router = express.Router();

// Narrow window on login specifically - this is what brute-force/credential
// stuffing targets, so it gets a much tighter cap than the general API limit.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.LOGIN_RATE_LIMIT) || 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res, next, options) => {
    recordFailedLogin(req, { identifier: req.body?.email, reason: 'rate_limited' }).catch(() => {});
    res.status(options.statusCode).json({ error: 'Too many login attempts. Please try again later.' });
  },
});

router.post('/login', loginLimiter, login);
router.post('/logout', logout);
router.get('/me', authenticate, me);
router.post('/employees', authenticate, requirePermission('employees.manage'), createEmployee);
router.get('/employees', authenticate, requirePermission('employees.manage'), listEmployees);
router.patch('/employees/:id', authenticate, requirePermission('employees.manage'), updateEmployee);

module.exports = router;
