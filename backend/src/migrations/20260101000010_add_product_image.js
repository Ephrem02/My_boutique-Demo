exports.up = async function (knex) {
  await knex.schema.alterTable('products', (t) => {
    t.string('image_url');
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('products', (t) => {
    t.dropColumn('image_url');
  });
};
