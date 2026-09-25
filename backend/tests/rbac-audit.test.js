const request = require('supertest');
const app = require('../src/app');
const db = require('../src/config/db');
const { resetDb, createUser, loginAs, createProduct, ownerDb, eventsOfType } = require('./helpers');

beforeEach(resetDb);

const ADMIN_ROUTES = [
  ['get', '/api/admin/monitoring'],
  ['get', '/api/admin/notification-types'],
  ['get', '/api/admin/notification-events'],
  ['post', '/api/admin/notifications/manual'],
  ['get', '/api/admin/notification-rules'],
  ['put', '/api/admin/notification-rules/LOW_STOCK'],
  ['post', '/api/admin/notification-rules/LOW_STOCK/reset'],
  ['get', '/api/admin/notification-templates'],
  ['put', '/api/admin/notification-templates/LOW_STOCK'],
  ['post', '/api/admin/notification-templates/LOW_STOCK/reset'],
  ['post', '/api/admin/notification-templates/LOW_STOCK/preview'],
  ['get', '/api/admin/email-settings'],
  ['put', '/api/admin/email-settings'],
  ['post', '/api/admin/email-settings/test'],
  ['get', '/api/admin/deliveries'],
  ['post', '/api/admin/deliveries/1/resend'],
  ['get', '/api/admin/closing-settings'],
  ['put', '/api/admin/closing-settings'],
  ['get', '/api/admin/audit-logs'],
  ['get', '/api/admin/audit-logs/export'],
];

describe('admin endpoints are enforced on the backend', () => {
  test.each(['cashier', 'store_keeper'])('%s gets 403 on every admin route', async (role) => {
    const agent = await loginAs(app, await createUser(role));
    for (const [method, path] of ADMIN_ROUTES) {
      const res = await agent[method](path).send({});
      expect([path, res.status]).toEqual([path, 403]);
    }
  });

  test('anonymous requests get 401 on every admin route', async () => {
    for (const [method, path] of ADMIN_ROUTES) {
      expect((await request(app)[method](path).send({})).status).toBe(401);
    }
  });

  test('store manager can reach every admin read route', async () => {
    const agent = await loginAs(app, await createUser('store_manager'));
    for (const [method, path] of ADMIN_ROUTES.filter(([m]) => m === 'get')) {
      expect([path, (await agent.get(path)).status]).toEqual([path, 200]);
    }
  });

  test('denials are audited and a burst raises one grouped alert', async () => {
    const cashier = await createUser('cashier');
    const manager = await createUser('store_manager');
    const agent = await loginAs(app, cashier);
    for (let i = 0; i < 12; i += 1) await agent.get('/api/admin/audit-logs');
    await new Promise((r) => setTimeout(r, 300)); // denials are recorded without delaying the response
    const denied = await ownerDb()('audit_logs').where({ action: 'access.denied', actor_user_id: cashier.id });
    expect(denied.length).toBe(12);
    const events = await eventsOfType('ACCESS_DENIED_BURST');
    expect(events).toHaveLength(1);
    const managerInbox = await ownerDb()('notifications').where({ recipient_user_id: manager.id, event_id: events[0].id });
    expect(managerInbox).toHaveLength(1);
  });
});

describe('cashier least privilege', () => {
  async function twoCashiersWithSales() {
    const a = await createUser('cashier');
    const b = await createUser('cashier');
    const product = await createProduct({ shelf: 50, price: 2000, cost: 1200 });
    const agentA = await loginAs(app, a);
    const agentB = await loginAs(app, b);
    const saleA = (await agentA.post('/api/sales').send({ payment_method: 'cash', items: [{ product_id: product.id, quantity: 2 }] })).body;
    const saleB = (await agentB.post('/api/sales').send({ payment_method: 'mtn_mobile_money', items: [{ product_id: product.id, quantity: 1 }] })).body;
    return { a, b, agentA, agentB, saleA, saleB, product };
  }

  test('sees only own sales; other sales are 404 (not probeable)', async () => {
    const { a, agentA, saleA, saleB } = await twoCashiersWithSales();
    const list = await agentA.get('/api/sales').query({ cashier_id: saleB.cashier_id });
    expect(list.body.map((s) => s.id)).toEqual([saleA.id]);
    expect(list.body.every((s) => s.cashier_id === a.id)).toBe(true);
    expect((await agentA.get(`/api/sales/${saleB.id}`)).status).toBe(404);
    expect((await agentA.get(`/api/sales/${saleA.id}`)).status).toBe(200);
  });

  test("cannot refund another cashier's sale", async () => {
    const { agentA, saleB } = await twoCashiersWithSales();
    const res = await agentA.post('/api/returns').send({ sale_item_id: saleB.items[0].id, quantity: 1, restocked: true });
    expect(res.status).toBe(404);
  });

  test('store keeper and manager see all sales', async () => {
    await twoCashiersWithSales();
    for (const role of ['store_keeper', 'store_manager']) {
      const agent = await loginAs(app, await createUser(role));
      expect((await agent.get('/api/sales')).body).toHaveLength(2);
    }
  });

  test('no cost price, no movement history, no shop financial reports', async () => {
    const { agentA, product } = await twoCashiersWithSales();
    const products = await agentA.get('/api/products');
    expect(products.body[0]).not.toHaveProperty('cost_price');
    expect(products.body[0].selling_price).toBeDefined();
    expect((await agentA.get(`/api/products/${product.id}`)).body).not.toHaveProperty('cost_price');
    expect((await agentA.get('/api/stock/movements')).status).toBe(403);
    expect((await agentA.get('/api/stock/levels')).status).toBe(200);
    expect((await agentA.get('/api/reports/sales-summary')).status).toBe(403);
    expect((await agentA.get('/api/reports/financial-summary')).status).toBe(403);
  });

  test('my-summary shows own figures plus non-financial shop counts', async () => {
    const { agentA } = await twoCashiersWithSales();
    const res = await agentA.get('/api/reports/my-summary');
    expect(res.status).toBe(200);
    expect(res.body.my_sale_count).toBe(1);
    expect(res.body.my_revenue).toBe(4000);
    expect(res.body).toHaveProperty('shop_low_stock_count');
    expect(res.body).not.toHaveProperty('revenue');
  });
});

describe('audit trail', () => {
  test('login success/failure are audited without the password', async () => {
    const user = await createUser('cashier');
    await request(app).post('/api/auth/login').send({ email: user.email, password: 'Wrong-Password-1' });
    await request(app).post('/api/auth/login').send({ email: 'nobody@test.local', password: 'Wrong-Password-2' });
    await loginAs(app, user);
    const rows = await ownerDb()('audit_logs').whereIn('action', ['auth.login', 'auth.login_failed']).orderBy('id');
    expect(rows.map((r) => [r.action, r.metadata?.reason ?? null])).toEqual([
      ['auth.login_failed', 'bad_password'],
      ['auth.login_failed', 'unknown_account'],
      ['auth.login', null],
    ]);
    expect(rows[2].request_id).toBeTruthy();
    expect(JSON.stringify(rows)).not.toMatch(/Wrong-Password/);
  });

  test('repeated failures for one account raise one grouped FAILED_LOGIN_BURST', async () => {
    const user = await createUser('cashier');
    await createUser('store_manager');
    for (let i = 0; i < 7; i += 1) {
      await request(app).post('/api/auth/login').send({ email: user.email, password: 'nope-nope-nope' });
    }
    const events = await eventsOfType('FAILED_LOGIN_BURST');
    expect(events).toHaveLength(1);
    expect(events[0].occurrence_count).toBe(3);
  });

  test('employee changes record before/after with secrets redacted', async () => {
    const manager = await loginAs(app, await createUser('store_manager'));
    const cashier = await createUser('cashier');
    await manager.patch(`/api/auth/employees/${cashier.id}`).send({ role_name: 'store_keeper', password: 'another-pass-123' });
    const [row] = await ownerDb()('audit_logs').where({ action: 'user.role_change' });
    expect(row.old_values).toEqual({ role: 'cashier', password: '[REDACTED]' });
    expect(row.new_values).toEqual({ role: 'store_keeper', password: '[REDACTED]' });
    expect(JSON.stringify(row)).not.toContain('another-pass-123');
  });

  test('product price change and CRUD routes are audited', async () => {
    const manager = await loginAs(app, await createUser('store_manager'));
    const product = await createProduct({ price: 1000 });
    await manager.put(`/api/products/${product.id}`).send({ selling_price: 1500 });
    await manager.post('/api/suppliers').send({ name: 'Acme' });
    const [price] = await ownerDb()('audit_logs').where({ action: 'product.price_change' });
    expect(price.old_values.selling_price).toBe('1000.00');
    expect(price.new_values.selling_price).toBe(1500);
    expect(await ownerDb()('audit_logs').where({ action: 'supplier.create' })).toHaveLength(1);
  });

  test('the API role cannot modify or delete audit rows', async () => {
    await db('audit_logs').insert({ action: 'test.row' });
    await expect(db('audit_logs').update({ action: 'tampered' })).rejects.toThrow(/permission denied/);
    await expect(db('audit_logs').del()).rejects.toThrow(/permission denied/);
    await expect(ownerDb()('audit_logs').del()).rejects.toThrow(/append-only/);
  });

  test('audit search filters and CSV export neutralises formulas (and is itself audited)', async () => {
    const manager = await loginAs(app, await createUser('store_manager'));
    await request(app).post('/api/auth/login').send({ email: '=HYPERLINK("http://evil")', password: 'x-x-x-x-x' });
    const list = await manager.get('/api/admin/audit-logs').query({ action: 'auth.login_failed' });
    expect(list.body.items).toHaveLength(1);
    const csv = await manager.get('/api/admin/audit-logs/export').query({ action: 'auth.login_failed' });
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.text).not.toMatch(/(^|,)"=HYPERLINK/m);
    expect(await ownerDb()('audit_logs').where({ action: 'audit.export' })).toHaveLength(1);
  });

  test('manual notifications are validated, delivered and audited', async () => {
    const manager = await loginAs(app, await createUser('store_manager'));
    const keeper = await createUser('store_keeper');
    const bad = await manager.post('/api/admin/notifications/manual').send({ title: '<b>x</b>', message: 'y', recipient_roles: ['store_keeper'] });
    expect(bad.status).toBe(422);
    const ok = await manager.post('/api/admin/notifications/manual').send({ title: 'Stock count Friday', message: 'Please stay late.', recipient_roles: ['store_keeper'] });
    expect(ok.status).toBe(201);
    const [n] = await ownerDb()('notifications').where({ recipient_user_id: keeper.id });
    expect(n.title).toBe('Stock count Friday');
    expect(await ownerDb()('audit_logs').where({ action: 'notification.manual_send' })).toHaveLength(1);
  });
});
