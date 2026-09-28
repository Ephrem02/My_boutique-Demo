// Customer / supplier 360° profiles: identity fields and a follow-up notes log.
//
// Money never lives here - balances still come only from the ledger views.
// party_notes is append-only (the runtime role may only read and add, see
// scripts/setup-db-roles.js): a wrong note is corrected by adding another.

exports.up = async function (knex) {
  await knex.schema.alterTable('institutions', (t) => {
    t.enu('status', ['active', 'inactive', 'blocked']).notNullable().defaultTo('active');
    t.string('contact_email');
    t.string('alt_phone');
    t.string('district');
    t.string('sector');
    t.string('city');
    t.string('country');
    t.string('id_number', 64); // national ID or business TIN, only when needed
    t.integer('assigned_user_id').references('id').inTable('users').onDelete('SET NULL');
    t.text('notes');
    t.index(['status']);
  });

  await knex.schema.alterTable('suppliers', (t) => {
    t.enu('status', ['active', 'inactive', 'under_review']).notNullable().defaultTo('active');
    t.string('contact_person');
    t.string('alt_phone');
    t.string('district');
    t.string('sector');
    t.string('city');
    t.string('country');
    t.string('registration_no', 64);
    t.string('tin', 64);
    t.string('category', 100);
    t.text('notes');
    t.index(['status']);
  });

  await knex.schema.createTable('party_notes', (t) => {
    t.bigIncrements('id').primary();
    t.enu('side', ['customer', 'supplier']).notNullable();
    t.integer('party_id').notNullable();
    t.text('body').notNullable();
    t.date('follow_up_date');
    t.integer('created_by').notNullable().references('id').inTable('users');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['side', 'party_id', 'created_at']);
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('party_notes');
  await knex.schema.alterTable('suppliers', (t) => {
    t.dropIndex(['status']);
    t.dropColumns('status', 'contact_person', 'alt_phone', 'district', 'sector', 'city', 'country', 'registration_no', 'tin', 'category', 'notes');
  });
  await knex.schema.alterTable('institutions', (t) => {
    t.dropIndex(['status']);
    t.dropColumns('status', 'contact_email', 'alt_phone', 'district', 'sector', 'city', 'country', 'id_number', 'assigned_user_id', 'notes');
  });
};
