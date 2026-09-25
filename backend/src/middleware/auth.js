const jwt = require('jsonwebtoken');
const db = require('../config/db');
const { getPermissionsForUser } = require('../utils/permissions');

/** Resolves a raw token to an active user, or null. Shared with the SSE stream. */
async function userFromToken(token) {
  if (!token) return null;
  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return null;
  }

  const user = await db('users')
    .select('users.id', 'users.full_name', 'users.email', 'users.status', 'users.session_version', 'roles.name as role')
    .join('roles', 'roles.id', 'users.role_id')
    .where('users.id', payload.sub)
    .first();

  // session_version is bumped on password reset, which invalidates every
  // token issued before it (tokens from before this field existed count as 0).
  if (!user || user.status !== 'active' || (payload.sv ?? 0) !== user.session_version) {
    return null;
  }

  const permissions = await getPermissionsForUser(user.id);
  return { ...user, permissions, tokenExpiresAt: payload.exp * 1000 };
}

/**
 * Verifies the JWT from the httpOnly session cookie and attaches the current
 * user (with role name + permission codes) to req.user.
 */
async function authenticate(req, res, next) {
  try {
    const token = req.cookies?.token || null;
    if (!token) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    const user = await userFromToken(token);
    if (!user) {
      return res.status(401).json({ error: 'Session is invalid or has expired - please sign in again' });
    }
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { authenticate, userFromToken };
