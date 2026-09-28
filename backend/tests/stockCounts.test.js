const app = require('../src/app');
const { resetDb, createUser, loginAs, createProduct, ownerDb, stockOf, eventsOfType, inbox, locations } = require('./helpers');

async function staff() {
  const cashier = await createUser('cashier', { full_name: 'Alice Cashier' });
  const keeper = await createUser('store_keeper', { full_name: 'Kevin Keeper' });
  const manager = await createUser('store_manager', { full_name: 'Grace Manager' });
  const manager2 = await createUser('store_manager', { full_name: 'Paul Manager' });
  return {
    cashier, keeper, manager, manager2,
    c: await loginAs(app, cashier), k: await loginAs(app, keeper), m: await loginAs(app, manager), m2: await loginAs(app, manager2),
  };
}

const ok = (res, status = 200) => {
  expect([res.status, res.body?.error]).toEqual([status, undefined]);
  return res.body;
};

/** counted: { productId: qty } for the given location name */
async function enter(agent, count, locationName, counted, extra = {}) {
  const loc = await locations();
  const lines = count.lines
    .filter((l) => l.location_id === loc[locationName] && counted[l.product_id] !== undefined)
    .map((l) => ({ id: l.id, counted_qty: counted[l.product_id], ...(extra[l.product_id] || {}) }));
  return agent.put(`/api/stock-counts/${count.id}/lines`).send({ lines });
}

describe('stock counts', () => {
  beforeEach(() => resetDb());

  test('blind count: a sale during counting is not a difference; approval posts adjustments and shrinkage; alerts fire', async () => {
    const s = await staff();
    const loc = await locations();
    const soap = await createProduct({ name: 'Soap', price: 1000, cost: 600, shelf: 20, reorder: 5 });
    const rice = await createProduct({ name: 'Rice', price: 5000, cost: 4000, shelf: 10, reorder: 3 });
    expect((await s.c.post('/api/stock-counts').send({})).status).toBe(403); // cashiers don't count
    expect((await s.k.post('/api/stock-counts').send({ location_id: loc.front_shelf, blind: false })).status).toBe(403); // only managers may unblind

    const started = ok(await s.k.post('/api/stock-counts').send({ location_id: loc.front_shelf, scope: 'products', product_ids: [soap.id, rice.id] }), 201);
    expect(started).toMatchObject({ blind: true, status: 'counting', lines: 2 });
    expect(started.number).toMatch(/^SC-\d{4}-000001$/);
    expect((await s.k.post('/api/stock-counts').send({ location_id: loc.front_shelf })).status).toBe(409); // one open count per location

    // the counter does not see system quantities; the manager does
    let count = ok(await s.k.get(`/api/stock-counts/${started.id}`));
    expect(count.system_hidden).toBe(true);
    expect(count.lines[0].expected_qty).toBeUndefined();
    expect(ok(await s.m.get(`/api/stock-counts/${started.id}`)).lines.find((l) => l.product_id === soap.id).expected_qty).toBe(20);

    // 3 soaps are sold while the keeper counts: 17 on the shelf is correct, not a shortage
    ok(await s.c.post('/api/sales').send({ payment_method: 'cash', items: [{ product_id: soap.id, quantity: 3 }] }), 201);
    ok(await enter(s.k, count, 'front_shelf', { [soap.id]: 17, [rice.id]: 7 }));
    expect((await s.k.post(`/api/stock-counts/${started.id}/submit`)).status).toBe(422); // rice is 3 short: a reason is required
    ok(await enter(s.k, count, 'front_shelf', { [rice.id]: 7 }, { [rice.id]: { reason: 'theft', note: 'Bag missing' } }));
    const submitted = ok(await s.k.post(`/api/stock-counts/${started.id}/submit`));
    expect(submitted).toMatchObject({ status: 'submitted', lines_with_difference: 1 });
    expect(Number(submitted.shortage_value)).toBe(12000);
    count = ok(await s.k.get(`/api/stock-counts/${started.id}`));
    expect(count.lines.find((l) => l.product_id === soap.id)).toMatchObject({ expected_qty: 17, variance: 0 });
    expect(count.lines.find((l) => l.product_id === rice.id)).toMatchObject({ expected_qty: 10, counted_qty: 7, variance: -3, variance_value: -12000 });
    const [alert] = await eventsOfType('STOCK_DISCREPANCY');
    expect(alert.severity).toBe('warning'); // under RWF 50,000

    // lines are frozen once submitted
    expect((await enter(s.k, count, 'front_shelf', { [rice.id]: 10 })).status).toBe(409);
    await expect(ownerDb()('stock_count_lines').where({ count_id: started.id }).update({ counted_qty: 10 })).rejects.toThrow(/ledger_protected/);

    // the keeper cannot decide; a manager who did not count approves
    expect((await s.k.post(`/api/stock-counts/${started.id}/decision`).send({ decision: 'approve' })).status).toBe(403);
    ok(await s.m.post(`/api/stock-counts/${started.id}/decision`).send({ decision: 'approve', note: 'Checked the CCTV' }));
    expect((await stockOf(rice.id)).front_shelf).toBe(7);
    expect((await stockOf(soap.id)).front_shelf).toBe(17);
    const movement = await ownerDb()('stock_movements').where({ type: 'adjustment', product_id: rice.id }).first();
    expect(movement).toMatchObject({ quantity: 3, reference_type: 'stock_count' });
    expect(await ownerDb()('shrinkage_records').where({ product_id: rice.id }).first()).toMatchObject({ quantity: 3, cause: 'theft' });
    expect((await inbox(s.keeper.id)).map((x) => x.type)).toContain('STOCK_COUNT_DECIDED');
    expect((await s.m2.post(`/api/stock-counts/${started.id}/decision`).send({ decision: 'approve' })).status).toBe(409); // decided once
    await expect(ownerDb()('stock_counts').where({ id: started.id }).del()).rejects.toThrow(/ledger_protected/);
  });

  test('a big difference is critical; the counting manager needs another manager; rejection changes nothing', async () => {
    const s = await staff();
    const loc = await locations();
    const tv = await createProduct({ name: 'TV', price: 150000, cost: 100000, storeRoom: 5 });
    const started = ok(await s.m.post('/api/stock-counts').send({ location_id: loc.store_room, scope: 'products', product_ids: [tv.id], blind: false }), 201);
    const count = ok(await s.m.get(`/api/stock-counts/${started.id}`));
    expect(count.system_hidden).toBe(false);
    ok(await enter(s.m, count, 'store_room', { [tv.id]: 4 }, { [tv.id]: { reason: 'miscount' } }));
    ok(await s.m.post(`/api/stock-counts/${started.id}/submit`));
    expect((await eventsOfType('STOCK_DISCREPANCY'))[0].severity).toBe('critical'); // RWF 100,000 short

    expect((await s.m.post(`/api/stock-counts/${started.id}/decision`).send({ decision: 'approve' })).status).toBe(403); // counted it themselves
    expect((await s.m2.post(`/api/stock-counts/${started.id}/decision`).send({ decision: 'reject', note: '' })).status).toBe(422);
    ok(await s.m2.post(`/api/stock-counts/${started.id}/decision`).send({ decision: 'reject', note: 'Recount the back shelf' }));
    expect((await stockOf(tv.id)).store_room).toBe(5);
    expect(await ownerDb()('shrinkage_records')).toHaveLength(0);
    // a new count can start for the location now
    ok(await s.k.post('/api/stock-counts').send({ location_id: loc.store_room, scope: 'products', product_ids: [tv.id] }), 201);
  });

  test('no differences closes by itself; uncounted lines block submission; cancelling posts nothing', async () => {
    const s = await staff();
    const loc = await locations();
    const pen = await createProduct({ name: 'Pen', shelf: 12, storeRoom: 30 });
    const started = ok(await s.k.post('/api/stock-counts').send({ scope: 'products', product_ids: [pen.id] }), 201); // both locations
    expect(started.lines).toBe(2);
    const count = ok(await s.k.get(`/api/stock-counts/${started.id}`));
    ok(await enter(s.k, count, 'front_shelf', { [pen.id]: 12 }));
    expect((await s.k.post(`/api/stock-counts/${started.id}/submit`)).status).toBe(422); // store room not counted
    ok(await enter(s.k, count, 'store_room', { [pen.id]: 30 }));
    expect(ok(await s.k.post(`/api/stock-counts/${started.id}/submit`))).toMatchObject({ status: 'approved', lines_with_difference: 0 });
    expect(await eventsOfType('STOCK_DISCREPANCY')).toHaveLength(0);

    const other = ok(await s.k.post('/api/stock-counts').send({ location_id: loc.front_shelf, scope: 'all' }), 201);
    expect((await s.k.post(`/api/stock-counts/${other.id}/cancel`).send({ reason: '' })).status).toBe(422);
    ok(await s.k.post(`/api/stock-counts/${other.id}/cancel`).send({ reason: 'Started by mistake' }));
    expect((await stockOf(pen.id)).front_shelf).toBe(12);

    const sheet = await s.k.get(`/api/stock-counts/${started.id}?format=pdf&kind=sheet`).buffer(true).parse((res, cb) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(sheet.status).toBe(200);
    expect(sheet.body.subarray(0, 5).toString()).toBe('%PDF-');
  });
});
