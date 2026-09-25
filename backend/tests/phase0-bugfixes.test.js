const request = require('supertest');
const app = require('../src/app');
const { resetDb, createUser, loginAs, createProduct, stockOf, ownerDb, locations } = require('./helpers');

beforeEach(resetDb);

describe('Bug 1: stock race condition', () => {
  test('concurrent sales never oversell or lose updates', async () => {
    const cashier = await createUser('cashier');
    const product = await createProduct({ shelf: 5 });
    const agents = await Promise.all(Array.from({ length: 4 }, () => loginAs(app, cashier)));

    const results = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        agents[i % agents.length].post('/api/sales').send({ payment_method: 'cash', items: [{ product_id: product.id, quantity: 1 }] })
      )
    );

    const ok = results.filter((r) => r.status === 201).length;
    const refused = results.filter((r) => r.status === 400 && /Insufficient stock/.test(r.body.error)).length;
    expect(ok).toBe(5);
    expect(refused).toBe(7);
    expect((await stockOf(product.id)).front_shelf).toBe(0);
    const { sold } = await ownerDb()('stock_movements').where({ product_id: product.id, type: 'sold' }).sum('quantity as sold').first();
    expect(Number(sold)).toBe(5);
  });

  test('opposite transfers at the same time do not deadlock and keep totals', async () => {
    const keeper = await createUser('store_keeper');
    const agent = await loginAs(app, keeper);
    const product = await createProduct({ shelf: 50, storeRoom: 50 });
    const loc = await locations();
    const calls = [];
    for (let i = 0; i < 10; i += 1) {
      const [from, to] = i % 2 ? [loc.front_shelf, loc.store_room] : [loc.store_room, loc.front_shelf];
      calls.push(agent.post('/api/stock/transfer').send({ product_id: product.id, from_location_id: from, to_location_id: to, quantity: 1 }));
    }
    const results = await Promise.all(calls);
    expect(results.every((r) => r.status === 201)).toBe(true);
    const stock = await stockOf(product.id);
    expect(stock.front_shelf + stock.store_room).toBe(100);
  });

  test('string / fractional quantities are rejected instead of corrupting stock', async () => {
    const keeper = await createUser('store_keeper');
    const agent = await loginAs(app, keeper);
    const product = await createProduct({ shelf: 10 });
    const loc = await locations();
    const res = await agent.post('/api/stock/intake').send({ product_id: product.id, location_id: loc.front_shelf, quantity: '1.5' });
    expect(res.status).toBe(400);
    expect((await stockOf(product.id)).front_shelf).toBe(10);
  });
});

describe('Bug 2: repeatable refunds', () => {
  async function saleOf(qty) {
    const cashier = await createUser('cashier');
    const agent = await loginAs(app, cashier);
    const product = await createProduct({ shelf: 20 });
    const sale = await agent.post('/api/sales').send({ payment_method: 'cash', items: [{ product_id: product.id, quantity: qty }] });
    expect(sale.status).toBe(201);
    return { agent, product, sale: sale.body, item: sale.body.items[0], cashier };
  }

  test('cumulative returns cannot exceed the quantity sold', async () => {
    const { agent, item, product } = await saleOf(3);
    expect((await agent.post('/api/returns').send({ sale_item_id: item.id, quantity: 2, restocked: true })).status).toBe(201);
    const second = await agent.post('/api/returns').send({ sale_item_id: item.id, quantity: 2, restocked: true });
    expect(second.status).toBe(400);
    expect(second.body.error).toMatch(/Only 1/);
    expect((await agent.post('/api/returns').send({ sale_item_id: item.id, quantity: 1, restocked: true })).status).toBe(201);
    const third = await agent.post('/api/returns').send({ sale_item_id: item.id, quantity: 1, restocked: true });
    expect(third.body.error).toMatch(/fully returned/);
    expect((await stockOf(product.id)).front_shelf).toBe(20);
  });

  test('concurrent returns of the same item cannot both succeed', async () => {
    const { agent, item } = await saleOf(1);
    const results = await Promise.all([1, 2, 3].map(() => agent.post('/api/returns').send({ sale_item_id: item.id, quantity: 1, restocked: true })));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
  });

  test('a voided sale cannot be refunded, and voiding after a partial return restocks only the remainder', async () => {
    const { agent, item, sale, product } = await saleOf(5);
    const manager = await loginAs(app, await createUser('store_manager'));
    await agent.post('/api/returns').send({ sale_item_id: item.id, quantity: 2, restocked: false }); // written off
    expect((await stockOf(product.id)).front_shelf).toBe(15);

    expect((await manager.post(`/api/sales/${sale.id}/void`)).status).toBe(200);
    expect((await stockOf(product.id)).front_shelf).toBe(18); // only the 3 still with the customer

    const refund = await agent.post('/api/returns').send({ sale_item_id: item.id, quantity: 1, restocked: true });
    expect(refund.status).toBe(400);
    expect(refund.body.error).toMatch(/voided/);
    expect((await manager.post(`/api/sales/${sale.id}/void`)).status).toBe(400);
  });

  test('sale detail reports returned_quantity for the return dialog', async () => {
    const { agent, item, sale } = await saleOf(3);
    await agent.post('/api/returns').send({ sale_item_id: item.id, quantity: 2, restocked: true });
    const detail = await agent.get(`/api/sales/${sale.id}`);
    expect(detail.body.items[0].returned_quantity).toBe(2);
  });
});

describe('Bug 3: product mass assignment', () => {
  test('only allowlisted columns are written', async () => {
    const keeper = await loginAs(app, await createUser('store_keeper'));
    const product = await createProduct({ price: 1000 });
    const res = await keeper.put(`/api/products/${product.id}`).send({ name: 'Renamed', sku: 'HACKED', id: 999, created_at: '2000-01-01' });
    expect(res.status).toBe(200);
    const row = await ownerDb()('products').where({ id: product.id }).first();
    expect(row.name).toBe('Renamed');
    expect(row.sku).toBe(product.sku);
    expect(new Date(row.created_at).getFullYear()).not.toBe(2000);
  });

  test('store keeper still cannot change the selling price; can reactivate', async () => {
    const keeper = await loginAs(app, await createUser('store_keeper'));
    const product = await createProduct({ price: 1000 });
    expect((await keeper.put(`/api/products/${product.id}`).send({ selling_price: 1 })).status).toBe(403);
    await keeper.delete(`/api/products/${product.id}`);
    const reactivated = await keeper.put(`/api/products/${product.id}`).send({ is_active: true });
    expect(reactivated.body.is_active).toBe(true);
  });
});

describe('Bug 4: admin self-lockout and stale sessions', () => {
  test('a manager cannot disable or demote themselves', async () => {
    const me = await createUser('store_manager');
    await createUser('store_manager');
    const agent = await loginAs(app, me);
    expect((await agent.patch(`/api/auth/employees/${me.id}`).send({ status: 'disabled' })).status).toBe(403);
    expect((await agent.patch(`/api/auth/employees/${me.id}`).send({ role_name: 'cashier' })).status).toBe(403);
  });

  test('two managers demoting each other at once cannot leave zero managers', async () => {
    const a = await createUser('store_manager');
    const b = await createUser('store_manager');
    const [agentA, agentB] = [await loginAs(app, a), await loginAs(app, b)];
    const results = await Promise.all([
      agentA.patch(`/api/auth/employees/${b.id}`).send({ role_name: 'cashier' }),
      agentB.patch(`/api/auth/employees/${a.id}`).send({ role_name: 'cashier' }),
    ]);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([200, 409]);
    const managers = await ownerDb()('users').join('roles', 'roles.id', 'users.role_id')
      .where({ 'roles.name': 'store_manager', 'users.status': 'active' });
    expect(managers).toHaveLength(1);
  });

  test('password reset signs out existing sessions of that user', async () => {
    const manager = await loginAs(app, await createUser('store_manager'));
    const cashier = await createUser('cashier');
    const cashierAgent = await loginAs(app, cashier);
    expect((await cashierAgent.get('/api/auth/me')).status).toBe(200);

    expect((await manager.patch(`/api/auth/employees/${cashier.id}`).send({ password: 'a-brand-new-password' })).status).toBe(200);
    expect((await cashierAgent.get('/api/auth/me')).status).toBe(401);
    await loginAs(app, cashier, 'a-brand-new-password');
  });

  test('resetting your own password keeps your current session', async () => {
    const me = await createUser('store_manager');
    const agent = await loginAs(app, me);
    expect((await agent.patch(`/api/auth/employees/${me.id}`).send({ password: 'my-new-password-1' })).status).toBe(200);
    expect((await agent.get('/api/auth/me')).status).toBe(200);
  });

  test('short passwords are rejected', async () => {
    const manager = await loginAs(app, await createUser('store_manager'));
    const res = await manager.post('/api/auth/employees').send({ full_name: 'X', email: 'x@test.local', password: 'short', role_name: 'cashier' });
    expect(res.status).toBe(400);
  });
});

describe('Bug 5: damage is atomic', () => {
  test('damage creates movement + shrinkage together, and neither when stock is insufficient', async () => {
    const keeper = await loginAs(app, await createUser('store_keeper'));
    const product = await createProduct({ shelf: 3 });
    const loc = await locations();
    expect((await keeper.post('/api/stock/damage').send({ product_id: product.id, location_id: loc.front_shelf, quantity: 2 })).status).toBe(201);
    const fail = await keeper.post('/api/stock/damage').send({ product_id: product.id, location_id: loc.front_shelf, quantity: 5 });
    expect(fail.status).toBe(400);
    const shrinkage = await ownerDb()('shrinkage_records').where({ product_id: product.id });
    expect(shrinkage).toHaveLength(1);
    expect((await stockOf(product.id)).front_shelf).toBe(1);
  });
});

describe('Bug 6: client IP handling', () => {
  test('X-Forwarded-For is ignored unless TRUST_PROXY is configured', async () => {
    const user = await createUser('cashier');
    await request(app).post('/api/auth/login').set('X-Forwarded-For', '203.0.113.9').send({ email: user.email, password: 'wrong-password' });
    const row = await ownerDb()('audit_logs').where({ action: 'auth.login_failed' }).first();
    expect(row.ip).not.toBe('203.0.113.9');
  });
});

describe('Malformed input', () => {
  test('non-numeric ids return 400, not 500', async () => {
    const manager = await loginAs(app, await createUser('store_manager'));
    expect((await manager.get('/api/sales/abc')).status).toBe(400);
  });
});

