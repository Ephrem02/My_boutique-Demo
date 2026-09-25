// Database-level backstop for closed periods. The services already refuse
// these operations; the triggers make sure no code path (or bug) can:
//  - record a sale/return without an OPEN business day,
//  - attach a sale/return to a day that isn't OPEN (backdating), or
//  - change or delete a sale, sale item or return once its day is no
//    longer OPEN (including pre-cycle rows, which are history too).
exports.up = async function (knex) {
  await knex.raw(`
    CREATE FUNCTION business_day_guard() RETURNS trigger AS $$
    DECLARE
      day_id integer;
      day_status text;
    BEGIN
      IF TG_OP = 'INSERT' THEN
        IF TG_TABLE_NAME = 'sale_items' THEN
          SELECT business_day_id INTO day_id FROM sales WHERE id = NEW.sale_id;
        ELSE
          day_id := NEW.business_day_id;
        END IF;
        IF day_id IS NULL THEN
          RAISE EXCEPTION 'business_day_closed: % requires an open business day', TG_TABLE_NAME;
        END IF;
      ELSE
        IF TG_TABLE_NAME = 'sale_items' THEN
          SELECT business_day_id INTO day_id FROM sales WHERE id = OLD.sale_id;
        ELSE
          day_id := OLD.business_day_id;
        END IF;
        IF day_id IS NULL THEN
          RAISE EXCEPTION 'business_day_closed: % from before daily closing cannot be changed', TG_TABLE_NAME;
        END IF;
        -- Nested IFs on purpose: PL/pgSQL doesn't short-circuit AND, and
        -- sale_items has no business_day_id column to read.
        IF TG_OP = 'UPDATE' AND TG_TABLE_NAME <> 'sale_items' THEN
          IF NEW.business_day_id IS DISTINCT FROM OLD.business_day_id THEN
            RAISE EXCEPTION 'business_day_closed: business day of a % cannot be changed', TG_TABLE_NAME;
          END IF;
        END IF;
      END IF;

      SELECT status INTO day_status FROM business_days WHERE id = day_id;
      IF day_status IS DISTINCT FROM 'open' THEN
        RAISE EXCEPTION 'business_day_closed: business day % is %', day_id, coalesce(day_status, 'missing');
      END IF;

      IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
      RETURN NEW;
    END
    $$ LANGUAGE plpgsql;
  `);
  for (const table of ['sales', 'sale_items', 'returns']) {
    await knex.raw(`CREATE TRIGGER ${table}_business_day_guard BEFORE INSERT OR UPDATE OR DELETE ON ${table}
      FOR EACH ROW EXECUTE FUNCTION business_day_guard()`);
  }
};

exports.down = async function (knex) {
  for (const table of ['sales', 'sale_items', 'returns']) {
    await knex.raw(`DROP TRIGGER IF EXISTS ${table}_business_day_guard ON ${table}`);
  }
  await knex.raw('DROP FUNCTION IF EXISTS business_day_guard()');
};
