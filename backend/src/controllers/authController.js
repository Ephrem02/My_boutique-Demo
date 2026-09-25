const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('../config/db');
const { getPermissionsForUser } = require('../utils/permissions');
const { userFromToken } = require('../middleware/auth');
const { audit } = require('../audit/auditService');
const { recordFailedLogin } = require('../audit/securityMonitor');
const { emit } = require('../notifications/notificationService');
const { handleServiceError } = require('../utils/handleServiceError');
const { AppError } = require('../utils/AppError');

const EIGHT_HOURS_MS = 8 * 60 * 60 * 1000;
const MIN_PASSWORD_LENGTH = 8;
const MANAGE_PERMISSION = 'employees.manage';

function parseExpiryToMs(expiry, fallbackMs) {
  const match = /^(\d+)([smhd])$/.exec(expiry || '');
  if (!match) return fallbackMs;
  const unitMs = { s: 1000, m: 60 * 1000, h: 60 * 60 * 1000, d: 24 * 60 * 60 * 1000 };
  return Number(match[1]) * unitMs[match[2]];
}

// Shared between setting and clearing the cookie - the attributes must match
// on both ends for the browser to actually remove it on logout.
function authCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
  };
}

function issueSessionCookie(res, user) {
  const token = jwt.sign({ sub: user.id, role: user.role, sv: user.session_version }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '8h',
  });
  res.cookie('token', token, {
    ...authCookieOptions(),
    maxAge: parseExpiryToMs(process.env.JWT_EXPIRES_IN, EIGHT_HOURS_MS),
  });
}

function assertPassword(password) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    throw new AppError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
}

// Unique email/phone collisions are user input errors, not server faults.
function rethrowUniqueViolation(err) {
  if (err.code === '23505') throw new AppError('That email or phone number is already used by another account', 409);
  throw err;
}

async function login(req, res, next) {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const user = await db('users')
      .select('users.*', 'roles.name as role')
      .join('roles', 'roles.id', 'users.role_id')
      .where('users.email', email)
      .first();

    // Same response for every failure so the endpoint doesn't reveal which
    // accounts exist; the audit trail records the real reason.
    if (!user) {
      await recordFailedLogin(req, { identifier: email, reason: 'unknown_account' });
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid || user.status !== 'active') {
      await recordFailedLogin(req, { identifier: email, reason: valid ? 'disabled' : 'bad_password', userId: user.id });
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    await db('users').where('id', user.id).update({ last_login_at: db.fn.now() });
    issueSessionCookie(res, user);
    const permissions = await getPermissionsForUser(user.id);
    await audit(req, { action: 'auth.login', entityType: 'user', entityId: user.id, actorUserId: user.id, actorRole: user.role });

    res.json({
      user: { id: user.id, full_name: user.full_name, email: user.email, role: user.role, permissions },
    });
  } catch (err) {
    next(err);
  }
}

async function logout(req, res) {
  // Logout isn't behind authenticate (an expired session must still be able
  // to clear its cookie), so identify the user best-effort for the audit.
  const user = await userFromToken(req.cookies?.token).catch(() => null);
  if (user) {
    await audit(req, { action: 'auth.logout', entityType: 'user', entityId: user.id, actorUserId: user.id, actorRole: user.role });
  }
  res.clearCookie('token', authCookieOptions());
  res.status(204).send();
}

// GET /api/auth/me - lets the frontend recover the session after a page
// reload, since the token itself lives in an httpOnly cookie it can't read.
async function me(req, res) {
  const { id, full_name, email, role, permissions } = req.user;
  res.json({ user: { id, full_name, email, role, permissions } });
}

const EMPLOYEE_COLUMNS = ['users.id', 'users.full_name', 'users.email', 'users.phone', 'users.status', 'roles.name as role', 'users.last_login_at'];

// Only reachable by users with 'employees.manage' permission (store manager / admin)
async function createEmployee(req, res) {
  const { full_name, email, phone, password, role_name } = req.body;
  if (!full_name || !password || !role_name || (!email && !phone)) {
    return res.status(400).json({ error: 'full_name, password, role_name and email or phone are required' });
  }

  try {
    assertPassword(password);
    const role = await db('roles').where('name', role_name).first();
    if (!role) throw new AppError(`Unknown role: ${role_name}`);

    const password_hash = await bcrypt.hash(password, 10);

    const created = await db.transaction(async (trx) => {
      const [newUser] = await trx('users')
        .insert({
          full_name,
          email: email || null,
          phone: phone || null,
          password_hash,
          role_id: role.id,
          created_by: req.user.id,
        })
        .returning(['id', 'full_name', 'email', 'phone'])
        .catch(rethrowUniqueViolation);

      await audit(req, {
        action: 'user.create',
        entityType: 'user',
        entityId: newUser.id,
        newValues: { full_name, email: email || null, phone: phone || null, role: role.name },
      }, { trx, required: true });

      await emit(trx, {
        type: 'USER_CREATED',
        dedupKey: `USER_CREATED:user:${newUser.id}`,
        entityType: 'user',
        entityId: newUser.id,
        actorUserId: req.user.id,
        targetUserIds: [newUser.id],
        params: { user_name: full_name, role: role.name.replace('_', ' '), actor_name: req.user.full_name },
      });
      return newUser;
    });

    res.status(201).json({ ...created, role: role.name });
  } catch (err) {
    handleServiceError(err, res);
  }
}

async function listEmployees(req, res) {
  const employees = await db('users')
    .select(EMPLOYEE_COLUMNS)
    .join('roles', 'roles.id', 'users.role_id')
    .orderBy('users.full_name');
  res.json(employees);
}

/** Would `userId` losing management access leave nobody able to manage employees? */
async function isLastManager(trx, userId) {
  const { count } = await trx('users')
    .join('role_permissions', 'role_permissions.role_id', 'users.role_id')
    .join('permissions', 'permissions.id', 'role_permissions.permission_id')
    .where('permissions.code', MANAGE_PERMISSION)
    .where('users.status', 'active')
    .whereNot('users.id', userId)
    .countDistinct('users.id as count')
    .first();
  return Number(count) === 0;
}

// PATCH /api/auth/employees/:id { full_name?, email?, phone?, role_name?, status?, password? }
// Only reachable by users with 'employees.manage' permission (store manager / admin)
async function updateEmployee(req, res) {
  const id = Number(req.params.id);
  const { full_name, email, phone, role_name, status, password } = req.body;

  try {
    if (!Number.isInteger(id)) throw new AppError('Employee not found', 404);
    if (status && !['active', 'disabled'].includes(status)) {
      throw new AppError("status must be 'active' or 'disabled'");
    }
    if (password) assertPassword(password);

    const result = await db.transaction(async (trx) => {
      // Serialize status/role changes: without this, two managers demoting
      // each other at the same moment would each see the other as still
      // active, both succeed, and leave nobody able to manage employees.
      if (status !== undefined || role_name !== undefined) {
        await trx.raw("SELECT pg_advisory_xact_lock(hashtext('employees.status_or_role'))");
      }
      const before = await trx('users')
        .select('users.*', 'roles.name as role')
        .join('roles', 'roles.id', 'users.role_id')
        .where('users.id', id)
        .forUpdate('users')
        .first();
      if (!before) throw new AppError('Employee not found', 404);

      const updates = {};
      if (full_name !== undefined) updates.full_name = full_name;
      if (email !== undefined) updates.email = email || null;
      if (phone !== undefined) updates.phone = phone || null;
      if (status !== undefined) updates.status = status;

      let newRole = null;
      if (role_name !== undefined) {
        newRole = await trx('roles').where('name', role_name).first();
        if (!newRole) throw new AppError(`Unknown role: ${role_name}`);
        updates.role_id = newRole.id;
      }

      const isSelf = id === req.user.id;
      const disabling = status === 'disabled' && before.status !== 'disabled';
      const roleChanging = newRole && newRole.id !== before.role_id;

      // Lockout guards: nobody can disable or demote themselves, and the last
      // active employee manager can't be removed by anyone.
      if (isSelf && (disabling || roleChanging)) {
        throw new AppError('You cannot disable your own account or change your own role', 403);
      }
      if (disabling || roleChanging) {
        const holdsManage = await trx('role_permissions')
          .join('permissions', 'permissions.id', 'role_permissions.permission_id')
          .where({ 'role_permissions.role_id': before.role_id, 'permissions.code': MANAGE_PERMISSION })
          .first();
        const keepsManage = !disabling && newRole && (await trx('role_permissions')
          .join('permissions', 'permissions.id', 'role_permissions.permission_id')
          .where({ 'role_permissions.role_id': newRole.id, 'permissions.code': MANAGE_PERMISSION })
          .first());
        if (holdsManage && before.status === 'active' && !keepsManage && (await isLastManager(trx, id))) {
          throw new AppError('This is the last active manager account - create or reactivate another manager first', 409);
        }
      }

      if (password) {
        updates.password_hash = await bcrypt.hash(password, 10);
        // Signs out every existing session for this account.
        updates.session_version = before.session_version + 1;
      }

      if (Object.keys(updates).length === 0) throw new AppError('No fields to update');

      await trx('users').where({ id }).update(updates).catch(rethrowUniqueViolation);

      const oldValues = { full_name: before.full_name, email: before.email, phone: before.phone, status: before.status, role: before.role };
      const newValues = {
        full_name: updates.full_name ?? before.full_name,
        email: updates.email !== undefined ? updates.email : before.email,
        phone: updates.phone !== undefined ? updates.phone : before.phone,
        status: updates.status ?? before.status,
        role: newRole ? newRole.name : before.role,
      };
      const changedOld = {};
      const changedNew = {};
      for (const key of Object.keys(newValues)) {
        if (String(oldValues[key] ?? '') !== String(newValues[key] ?? '')) {
          changedOld[key] = oldValues[key];
          changedNew[key] = newValues[key];
        }
      }
      if (password) {
        changedOld.password = '[unchanged]';
        changedNew.password = '[reset]';
      }
      await audit(req, {
        action: roleChanging ? 'user.role_change' : disabling ? 'user.disable' : password ? 'user.password_reset' : 'user.update',
        entityType: 'user',
        entityId: id,
        oldValues: changedOld,
        newValues: changedNew,
      }, { trx, required: true });

      const common = { entityType: 'user', entityId: id, actorUserId: req.user.id, targetUserIds: [id] };
      const names = { user_name: newValues.full_name, actor_name: req.user.full_name };
      const stamp = Date.now();
      if (roleChanging) {
        await emit(trx, {
          ...common, type: 'ACCOUNT_ROLE_CHANGED', dedupKey: `ACCOUNT_ROLE_CHANGED:user:${id}:${stamp}`,
          params: { ...names, old_role: before.role.replace('_', ' '), new_role: newRole.name.replace('_', ' ') },
        });
      }
      if (disabling) {
        await emit(trx, { ...common, type: 'ACCOUNT_DISABLED', dedupKey: `ACCOUNT_DISABLED:user:${id}:${stamp}`, params: names });
      }
      if (password) {
        await emit(trx, { ...common, type: 'ACCOUNT_PASSWORD_RESET', dedupKey: `ACCOUNT_PASSWORD_RESET:user:${id}:${stamp}`, params: names });
      }

      return { sessionVersion: updates.session_version, role: newRole ? newRole.name : before.role, isSelf };
    });

    // Resetting your own password shouldn't sign you out of the tab you did it from.
    if (result.isSelf && result.sessionVersion !== undefined) {
      issueSessionCookie(res, { id, role: result.role, session_version: result.sessionVersion });
    }

    const employee = await db('users')
      .select(EMPLOYEE_COLUMNS)
      .join('roles', 'roles.id', 'users.role_id')
      .where('users.id', id)
      .first();
    res.json(employee);
  } catch (err) {
    handleServiceError(err, res);
  }
}

module.exports = { login, logout, me, createEmployee, listEmployees, updateEmployee };
