exports.up = async function (knex) {
  await knex.schema
    .createTable('roles', (t) => {
      t.increments('id').primary();
      t.string('name').notNullable().unique(); // e.g. 'admin', 'store_manager', 'cashier', 'store_keeper'
      t.string('description');
      t.timestamps(true, true);
    })
    .createTable('permissions', (t) => {
      t.increments('id').primary();
      t.string('code').notNullable().unique(); // e.g. 'sales.create', 'reports.financial.view'
      t.string('description');
    })
    .createTable('role_permissions', (t) => {
      t.integer('role_id').unsigned().notNullable().references('id').inTable('roles').onDelete('CASCADE');
      t.integer('permission_id').unsigned().notNullable().references('id').inTable('permissions').onDelete('CASCADE');
      t.primary(['role_id', 'permission_id']);
    })
    .createTable('users', (t) => {
      t.increments('id').primary();
      t.string('full_name').notNullable();
      t.string('email').unique();
      t.string('phone').unique();
      t.string('password_hash').notNullable();
      t.integer('role_id').unsigned().notNullable().references('id').inTable('roles');
      t.integer('created_by').unsigned().references('id').inTable('users');
      t.enu('status', ['active', 'disabled']).notNullable().defaultTo('active');
      t.timestamp('last_login_at');
      t.timestamps(true, true);
    });
};

exports.down = async function (knex) {
  await knex.schema
    .dropTableIfExists('users')
    .dropTableIfExists('role_permissions')
    .dropTableIfExists('permissions')
    .dropTableIfExists('roles');
};
