// Business-day permission codes, added without re-running the (destructive)
// seed. Keep in sync with src/seeds/01_roles_permissions.js and verify with
// `npm run check:permissions`.
const GRANTS = {
  'day.view': ['cashier', 'store_keeper', 'store_manager'],
  'day.open': ['cashier', 'store_manager'],
  'day.close': ['cashier', 'store_manager'],
  'day.corrections.request': ['cashier', 'store_manager'],
  'day.review': ['store_manager'],
  'day.reopen': ['store_manager'],
  'day.history.view': ['store_manager'],
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
