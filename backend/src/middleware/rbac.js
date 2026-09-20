/**
 * Usage: router.post('/stock/intake', authenticate, requirePermission('stock.intake'), handler)
 * Pass multiple codes to require ANY of them: requirePermission('stock.view', 'stock.intake')
 */
function requirePermission(...anyOfCodes) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    const has = anyOfCodes.some((code) => req.user.permissions.includes(code));
    if (!has) {
      return res.status(403).json({
        error: 'You do not have permission to perform this action',
        required: anyOfCodes,
      });
    }
    next();
  };
}

module.exports = { requirePermission };
