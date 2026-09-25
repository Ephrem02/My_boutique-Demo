// Payment methods: MTN and Airtel are reported separately from now on.
// 'mobile_money' and 'bank_transfer' stay valid for existing rows only (the
// API no longer accepts them) - an old mobile-money sale can't honestly be
// assigned to one network, so nothing is remapped.
//
// Returns gain the refunded amount and method at the time of the refund,
// which daily cash reconciliation needs. V1 rule: refunds go back through the
// sale's own payment method. Existing returns are backfilled the same way.
const NEW_METHODS = ['cash', 'mtn_mobile_money', 'airtel_money', 'card'];
const LEGACY_METHODS = ['mobile_money', 'bank_transfer'];
const quoted = (list) => list.map((m) => `'${m}'`).join(', ');

exports.up = async function (knex) {
  await knex.raw('ALTER TABLE sales DROP CONSTRAINT IF EXISTS sales_payment_method_check');
  await knex.raw(
    `ALTER TABLE sales ADD CONSTRAINT sales_payment_method_check CHECK (payment_method IN (${quoted([...NEW_METHODS, ...LEGACY_METHODS])}))`
  );

  await knex.schema.alterTable('returns', (t) => {
    t.decimal('refund_amount', 14, 2);
    t.text('refund_method');
  });
  await knex.raw(`
    UPDATE returns r SET
      refund_amount = r.quantity * si.unit_price,
      refund_method = s.payment_method
    FROM sale_items si JOIN sales s ON s.id = si.sale_id
    WHERE si.id = r.sale_item_id
  `);
  await knex.raw('ALTER TABLE returns ALTER COLUMN refund_amount SET NOT NULL');
  await knex.raw('ALTER TABLE returns ALTER COLUMN refund_method SET NOT NULL');
};

exports.down = async function (knex) {
  await knex.schema.alterTable('returns', (t) => {
    t.dropColumn('refund_amount');
    t.dropColumn('refund_method');
  });
  await knex.raw('ALTER TABLE sales DROP CONSTRAINT IF EXISTS sales_payment_method_check');
  // Rows sold with the new methods would violate the old constraint, so it is
  // restored NOT VALID (enforced for new rows only) rather than failing.
  await knex.raw(
    "ALTER TABLE sales ADD CONSTRAINT sales_payment_method_check CHECK (payment_method IN ('cash', 'mobile_money', 'card', 'bank_transfer')) NOT VALID"
  );
};
