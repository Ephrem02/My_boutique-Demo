// Physical stock counts (stock takes) and their discrepancy approvals.
//
// A count saves each line's stock at the start (snapshot_qty, taken with the
// rows share-locked) and the last movement id at that moment. At submission
// the expected quantity is the snapshot plus every movement since, so sales
// made while people were counting never show up as false differences.
// Differences are posted only when a manager (never a counter) approves, as
// 'adjustment' stock movements - stock is never overwritten.
//
// Counts are never deleted; their header only changes status/decision
// columns, and lines can only be edited while the count is still open.
const GRANTS = { 'stock.count': ['store_keeper', 'store_manager'], 'stock.count.approve': ['store_manager'] };

exports.up = async function (knex) {
  await knex.schema.createTable('stock_counts', (t) => {
    t.increments('id').primary();
    t.string('number', 32).notNullable().unique();
    t.integer('location_id').references('id').inTable('stock_locations'); // null = every location
    t.string('scope', 16).notNullable(); // all | category | products
    t.integer('category_id').references('id').inTable('categories');
    t.boolean('blind').notNullable().defaultTo(true);
    t.bigInteger('snapshot_movement_id').notNullable().defaultTo(0);
    t.string('status', 16).notNullable().defaultTo('counting');
    t.text('notes');
    t.integer('started_by').notNullable().references('id').inTable('users');
    t.timestamp('started_at').notNullable().defaultTo(knex.fn.now());
    t.integer('submitted_by').references('id').inTable('users');
    t.timestamp('submitted_at');
    t.integer('decided_by').references('id').inTable('users');
    t.timestamp('decided_at');
    t.text('decision_note');
    t.integer('lines_with_difference');
    t.decimal('shortage_value', 14, 2);
    t.decimal('overage_value', 14, 2);
    t.index(['status']);
  });
  await knex.raw(`ALTER TABLE stock_counts
    ADD CONSTRAINT stock_counts_status_valid CHECK (status IN ('counting', 'submitted', 'approved', 'rejected', 'cancelled')),
    ADD CONSTRAINT stock_counts_scope_valid CHECK (scope IN ('all', 'category', 'products')),
    ADD CONSTRAINT stock_counts_not_self_decided CHECK (decided_by IS NULL OR (decided_by <> started_by AND decided_by <> submitted_by)),
    ADD CONSTRAINT stock_counts_reject_reason CHECK (status <> 'rejected' OR length(trim(decision_note)) >= 3)`);

  await knex.schema.createTable('stock_count_lines', (t) => {
    t.increments('id').primary();
    t.integer('count_id').notNullable().references('id').inTable('stock_counts');
    t.integer('product_id').notNullable().references('id').inTable('products');
    t.integer('location_id').notNullable().references('id').inTable('stock_locations');
    t.integer('snapshot_qty').notNullable();
    t.integer('counted_qty');
    t.integer('counted_by').references('id').inTable('users');
    t.timestamp('counted_at');
    t.integer('expected_qty'); // at submission: snapshot + movements since
    t.integer('variance'); // counted - expected
    t.decimal('unit_cost', 12, 2);
    t.decimal('variance_value', 14, 2);
    t.string('reason', 16);
    t.text('note');
    t.unique(['count_id', 'product_id', 'location_id']);
    t.index(['product_id', 'location_id']);
  });
  await knex.raw(`ALTER TABLE stock_count_lines
    ADD CONSTRAINT stock_count_lines_counted_nonnegative CHECK (counted_qty IS NULL OR counted_qty >= 0),
    ADD CONSTRAINT stock_count_lines_reason_valid CHECK (reason IS NULL OR reason IN ('miscount', 'theft', 'spoilage', 'other'))`);

  // Header: never deleted; only status / submission / decision columns change
  await knex.raw(`CREATE TRIGGER stock_counts_ledger_guard BEFORE UPDATE OR DELETE ON stock_counts
    FOR EACH ROW EXECUTE FUNCTION ledger_row_guard('status', 'submitted_by', 'submitted_at', 'decided_by', 'decided_at', 'decision_note',
      'lines_with_difference', 'shortage_value', 'overage_value')`);
  // Lines: never deleted; editable only while their count is still being counted
  await knex.raw(`
    CREATE FUNCTION stock_count_line_guard() RETURNS trigger AS $$
    DECLARE
      count_status text;
    BEGIN
      IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'ledger_protected: stock count lines cannot be deleted';
      END IF;
      SELECT status INTO count_status FROM stock_counts WHERE id = OLD.count_id;
      -- the submission itself writes expected/variance while the header still says 'counting'
      IF count_status <> 'counting' THEN
        RAISE EXCEPTION 'ledger_protected: lines of a % stock count cannot be changed', count_status;
      END IF;
      IF NEW.count_id <> OLD.count_id OR NEW.product_id <> OLD.product_id OR NEW.location_id <> OLD.location_id OR NEW.snapshot_qty <> OLD.snapshot_qty THEN
        RAISE EXCEPTION 'ledger_protected: a stock count line cannot be moved or re-snapshotted';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);
  await knex.raw(`CREATE TRIGGER stock_count_lines_guard BEFORE UPDATE OR DELETE ON stock_count_lines
    FOR EACH ROW EXECUTE FUNCTION stock_count_line_guard()`);

  for (const [code, roleNames] of Object.entries(GRANTS)) {
    await knex('permissions').insert({ code }).onConflict('code').ignore();
    const permission = await knex('permissions').where({ code }).first();
    const roles = await knex('roles').whereIn('name', roleNames);
    if (roles.length) {
      await knex('role_permissions').insert(roles.map((r) => ({ role_id: r.id, permission_id: permission.id })))
        .onConflict(['role_id', 'permission_id']).ignore();
    }
  }
};

exports.down = async function (knex) {
  await knex('permissions').whereIn('code', Object.keys(GRANTS)).del();
  await knex.schema.dropTableIfExists('stock_count_lines');
  await knex.raw('DROP FUNCTION IF EXISTS stock_count_line_guard()');
  await knex.schema.dropTableIfExists('stock_counts');
};
