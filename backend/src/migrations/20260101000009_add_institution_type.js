exports.up = async function (knex) {
  await knex.schema.alterTable('institutions', (t) => {
    t.enu('type', ['shop', 'school', 'individual', 'company', 'other']).notNullable().defaultTo('other');
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('institutions', (t) => {
    t.dropColumn('type');
  });
};
