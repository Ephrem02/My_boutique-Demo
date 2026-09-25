// Adds the new permission codes to an existing database without re-running
// the seed (which wipes users). Must stay in sync with
// src/seeds/01_roles_permissions.js - verify with `npm run check:permissions`.
const GRANTS = {
  'sales.view_all': ['store_manager', 'store_keeper'],
  'stock.movements.view': ['store_manager', 'store_keeper'],
  'notifications.manage': ['store_manager'],
  'notifications.deliveries.manage': ['store_manager'],
  'audit.view': ['store_manager'],
};

exports.up = async function (knex) {
  for (const [code, roleNames] of Object.entries(GRANTS)) {
    await knex('permissions').insert({ code }).onConflict('code').ignore();
    const permission = await knex('permissions').where({ code }).first();
    const roles = await knex('roles').whereIn('name', roleNames);
    if (roles.length) {
      await knex('role_permissions')
        .insert(roles.map((r) => ({ role_id: r.id, permission_id: permission.id })))
        .onConflict(['role_id', 'permission_id'])
        .ignore();
    }
  }
};

exports.down = async function (knex) {
  await knex('permissions').whereIn('code', Object.keys(GRANTS)).del();
};
