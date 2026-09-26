// A calendar date can now have several business-day sessions: a manager may
// open again after closing (each open -> close has its own opening cash, count
// and closing). Still at most one OPEN/CLOSING_IN_PROGRESS session at a time.
exports.up = async function (knex) {
  await knex.schema.alterTable('business_days', (t) => {
    t.integer('session_no').notNullable().defaultTo(1);
  });
  await knex.schema.alterTable('business_days', (t) => {
    t.dropUnique(['business_date']);
    t.unique(['business_date', 'session_no']);
  });
  await knex.raw('ALTER TABLE business_days ADD CONSTRAINT business_days_session_no_positive CHECK (session_no >= 1)');
};

exports.down = async function (knex) {
  // Only reversible while every date still has a single session.
  await knex.raw('ALTER TABLE business_days DROP CONSTRAINT business_days_session_no_positive');
  await knex.schema.alterTable('business_days', (t) => {
    t.dropUnique(['business_date', 'session_no']);
    t.unique(['business_date']);
  });
  await knex.schema.alterTable('business_days', (t) => {
    t.dropColumn('session_no');
  });
};
