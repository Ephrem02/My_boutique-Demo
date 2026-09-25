const { recordAccessDenied } = require('../audit/securityMonitor');

/**
 * Usage: router.post('/stock/intake', authenticate, requirePermission('stock.intake'), handler)
 * Pass multiple codes to require ANY of them: requirePermission('stock.view', 'stock.intake')
 * Denials are audited (and bursts alert managers) without delaying the response.
 */
function requirePermission(...anyOfCodes) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    const has = anyOfCodes.some((code) => req.user.permissions.includes(code));
    if (!has) {
      recordAccessDenied(req, anyOfCodes).catch(() => {});
      return res.status(403).json({
        error: 'You do not have permission to perform this action',
        required: anyOfCodes,
      });
    }
    next();
  };
}

/** For handlers that branch on a permission rather than requiring it. */
function can(req, code) {
  return !!req.user?.permissions?.includes(code);
}

module.exports = { requirePermission, can };
