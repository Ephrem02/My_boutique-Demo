const db = require('../config/db');

async function getPermissionsForUser(userId) {
  return db('role_permissions')
    .join('permissions', 'permissions.id', 'role_permissions.permission_id')
    .join('users', 'users.role_id', 'role_permissions.role_id')
    .where('users.id', userId)
    .pluck('permissions.code');
}

module.exports = { getPermissionsForUser };
