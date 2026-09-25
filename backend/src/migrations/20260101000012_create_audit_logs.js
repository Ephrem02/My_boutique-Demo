// Append-only audit trail. Two layers of protection:
//  1. The runtime DB role (scripts/setup-db-roles.js) is only granted
//     SELECT/INSERT on this table.
//  2. A trigger rejects UPDATE/DELETE/TRUNCATE for every role, including the
//     owner, so history can't be rewritten by accident either. Removing rows
//     (e.g. a future retention policy) requires deliberately dropping it.
// actor_user_id is intentionally not a foreign key: audit history must
// survive independently of the users table.
exports.up = async function (knex) {
  await knex.schema.createTable('audit_logs', (t) => {
    t.bigIncrements('id').primary();
    t.integer('actor_user_id');
    t.string('actor_role', 64);
    t.string('action', 100).notNullable();
    t.string('entity_type', 64);
    t.string('entity_id', 64);
    t.jsonb('old_values');
    t.jsonb('new_values');
    t.jsonb('metadata');
    t.enu('result', ['success', 'denied', 'failure']).notNullable().defaultTo('success');
    t.string('ip', 64);
    t.string('user_agent', 300);
    t.string('request_id', 64);
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());

    t.index(['created_at']);
    t.index(['actor_user_id', 'created_at']);
    t.index(['entity_type', 'entity_id']);
    t.index(['action', 'created_at']);
    t.index(['ip', 'created_at']);
  });

  await knex.raw(`
    CREATE FUNCTION audit_logs_append_only() RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION 'audit_logs is append-only';
    END
    $$ LANGUAGE plpgsql;
  `);
  await knex.raw(`
    CREATE TRIGGER audit_logs_no_update_delete BEFORE UPDATE OR DELETE ON audit_logs
    FOR EACH ROW EXECUTE FUNCTION audit_logs_append_only();
  `);
  await knex.raw(`
    CREATE TRIGGER audit_logs_no_truncate BEFORE TRUNCATE ON audit_logs
    FOR EACH STATEMENT EXECUTE FUNCTION audit_logs_append_only();
  `);
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('audit_logs');
  await knex.raw('DROP FUNCTION IF EXISTS audit_logs_append_only()');
};
