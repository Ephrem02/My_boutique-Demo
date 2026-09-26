// Links that complete the ledger:
//  - a till sale can name its customer (their purchase history), and
//  - a refund or credit can point at the return it settles ("related
//    payment/credit adjustment" on the return).
exports.up = async function (knex) {
  await knex.schema.alterTable('sales', (t) => {
    t.integer('institution_id').references('id').inTable('institutions');
    t.index(['institution_id']);
  });
  await knex.schema.alterTable('supplier_transactions', (t) => {
    t.integer('return_id').references('id').inTable('supplier_returns');
    t.index(['return_id']);
  });
  await knex.schema.alterTable('customer_transactions', (t) => {
    t.integer('return_id').references('id').inTable('customer_returns');
    t.index(['return_id']);
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('customer_transactions', (t) => t.dropColumn('return_id'));
  await knex.schema.alterTable('supplier_transactions', (t) => t.dropColumn('return_id'));
  await knex.schema.alterTable('sales', (t) => t.dropColumn('institution_id'));
};
