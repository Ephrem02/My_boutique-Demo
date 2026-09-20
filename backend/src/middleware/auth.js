const jwt = require('jsonwebtoken');
const db = require('../config/db');
const { getPermissionsForUser } = require('../utils/permissions');

/**
 * Verifies the JWT on the Authorization header and attaches the current
 * user (with role name + permission codes) to req.user.
 */
async function authenticate(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) {
      return res.status(401).json({ error: 'Missing or malformed Authorization header' });
    }

    const payload = jwt.verify(token, process.env.JWT_SECRET);

    const user = await db('users')
      .select('users.id', 'users.full_name', 'users.email', 'users.status', 'roles.name as role')
      .join('roles', 'roles.id', 'users.role_id')
      .where('users.id', payload.sub)
      .first();

    if (!user || user.status !== 'active') {
      return res.status(401).json({ error: 'Account not found or disabled' });
    }

    const permissions = await getPermissionsForUser(user.id);

    req.user = { ...user, permissions };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

module.exports = { authenticate };
