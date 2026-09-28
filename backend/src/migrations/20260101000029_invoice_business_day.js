// Customer invoices remember the business day they were made in, so the
// day's figures can show "sold on account" next to till sales.
//
// Only new invoices are stamped. Older ones stay NULL: several sessions can
// share a date, so guessing their day from order_date could count one sale in
// two sessions' reports. They remain on the client ledger and in Finance.
exports.up = async function (knex) {
  await knex.schema.alterTable('institution_orders', (t) => {
    t.integer('business_day_id').references('id').inTable('business_days');
    t.index(['business_day_id']);
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('institution_orders', (t) => {
    t.dropIndex(['business_day_id']);
    t.dropColumn('business_day_id');
  });
};
