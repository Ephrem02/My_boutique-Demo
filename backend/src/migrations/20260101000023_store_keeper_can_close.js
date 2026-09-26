// Store keepers can close the business day, like cashiers (count the cash and
// submit the closing). Critical variances still wait for a store manager.
// Keep in sync with src/seeds/01_roles_permissions.js and verify with
// `npm run check:permissions`.
async function roleAndPermission(knex) {
  const permission = await knex('permissions').where({ code: 'day.close' }).first();
  const role = await knex('roles').where({ name: 'store_keeper' }).first();
  return { permission, role };
}

exports.up = async function (knex) {
  const { permission, role } = await roleAndPermission(knex);
  if (!permission || !role) return;
  await knex('role_permissions').insert({ role_id: role.id, permission_id: permission.id }).onConflict(['role_id', 'permission_id']).ignore();
};

exports.down = async function (knex) {
  const { permission, role } = await roleAndPermission(knex);
  if (!permission || !role) return;
  await knex('role_permissions').where({ role_id: role.id, permission_id: permission.id }).del();
};
