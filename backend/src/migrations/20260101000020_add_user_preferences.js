// Per-user personal preferences (currently the appearance: light/dark/system).
// Stored server-side so a user gets their choice on any device, including
// shared tills where several cashiers sign in on the same browser.
exports.up = async function (knex) {
  await knex.schema.alterTable('users', (t) => {
    t.jsonb('preferences').notNullable().defaultTo('{}');
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('users', (t) => {
    t.dropColumn('preferences');
  });
};
