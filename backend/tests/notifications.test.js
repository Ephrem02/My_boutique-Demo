const app = require('../src/app');
const { resetDb, createUser, loginAs, createProduct, ownerDb, locations, inbox, eventsOfType } = require('./helpers');
const { emit } = require('../src/notifications/notificationService');
const db = require('../src/config/db');

beforeEach(resetDb);

async function staff() {
  const cashier = await createUser('cashier');
  const keeper = await createUser('store_keeper');
  const manager = await createUser('store_manager');
  return { cashier, keeper, manager };
}

async function sell(agent, productId, quantity = 1) {
  const res = await agent.post('/api/sales').send({ payment_method: 'cash', items: [{ product_id: productId, quantity }] });
  expect(res.status).toBe(201);
  return res.body;
}

describe('stock alerts', () => {
  test('LOW_STOCK fires once on crossing, not on every sale while low', async () => {
    const { cashier, keeper, manager } = await staff();
    const agent = await loginAs(app, cashier);
    const product = await createProduct({ shelf: 8, reorder: 5 });

    await sell(agent, product.id, 2); // 8 -> 6, above
    expect(await eventsOfType('LOW_STOCK')).toHaveLength(0);
    await sell(agent, product.id, 1); // 6 -> 5, crosses
    await sell(agent, product.id, 1); // 5 -> 4, still low
    await sell(agent, product.id, 1); // 4 -> 3

    expect(await eventsOfType('LOW_STOCK')).toHaveLength(1);
    expect((await inbox(keeper.id)).filter((n) => n.type === 'LOW_STOCK')).toHaveLength(1);
    expect((await inbox(manager.id)).filter((n) => n.type === 'LOW_STOCK')).toHaveLength(1);
    // Least privilege: cashiers are not in the default audience for stock alerts
    expect((await inbox(cashier.id)).filter((n) => n.type === 'LOW_STOCK')).toHaveLength(0);
  });

  test('OUT_OF_STOCK and SHELF_EMPTY at zero; replenishment resolves and notifies', async () => {
    const { cashier, keeper } = await staff();
    const agent = await loginAs(app, cashier);
    const keeperAgent = await loginAs(app, keeper);
    const product = await createProduct({ shelf: 2, reorder: 5 });
    const loc = await locations();

    await sell(agent, product.id, 2);
    expect(await eventsOfType('OUT_OF_STOCK')).toHaveLength(1);
    expect(await eventsOfType('SHELF_EMPTY')).toHaveLength(1);

    await keeperAgent.post('/api/stock/intake').send({ product_id: product.id, location_id: loc.store_room, quantity: 3 });
    const low = await eventsOfType('LOW_STOCK'); // partially refilled, still low
    expect(low).toHaveLength(1);
    expect((await eventsOfType('OUT_OF_STOCK'))[0].resolved_at).not.toBeNull();

    await keeperAgent.post('/api/stock/intake').send({ product_id: product.id, location_id: loc.store_room, quantity: 10 });
    expect(await eventsOfType('STOCK_REPLENISHED')).toHaveLength(1);
    expect((await eventsOfType('LOW_STOCK'))[0].resolved_at).not.toBeNull();

    // SHELF_EMPTY stays open until the shelf itself is refilled
    expect((await eventsOfType('SHELF_EMPTY'))[0].resolved_at).toBeNull();
    await keeperAgent.post('/api/stock/transfer').send({ product_id: product.id, from_location_id: loc.store_room, to_location_id: loc.front_shelf, quantity: 4 });
    expect((await eventsOfType('SHELF_EMPTY'))[0].resolved_at).not.toBeNull();
  });

  test('a new LOW_STOCK episode after recovery respects the cooldown', async () => {
    const { cashier, keeper } = await staff();
    const agent = await loginAs(app, cashier);
    const keeperAgent = await loginAs(app, keeper);
    const product = await createProduct({ shelf: 6, reorder: 5 });
    const loc = await locations();
    await sell(agent, product.id, 1); // low
    await keeperAgent.post('/api/stock/intake').send({ product_id: product.id, location_id: loc.front_shelf, quantity: 5 }); // recovers
    await sell(agent, product.id, 6); // low again within the 60-minute cooldown
    expect(await eventsOfType('LOW_STOCK')).toHaveLength(1);
  });

  test('a rolled-back sale produces no notifications', async () => {
    const { cashier } = await staff();
    const agent = await loginAs(app, cashier);
    const low = await createProduct({ shelf: 6, reorder: 5 });
    const scarce = await createProduct({ shelf: 0 });
    const res = await agent.post('/api/sales').send({
      payment_method: 'cash',
      items: [{ product_id: low.id, quantity: 2 }, { product_id: scarce.id, quantity: 1 }],
    });
    expect(res.status).toBe(400);
    expect(await ownerDb()('notification_events')).toHaveLength(0);
  });
});

describe('sales notifications and thresholds', () => {
  test('HIGH_VALUE_SALE uses the admin-configurable RWF threshold', async () => {
    const { cashier, manager } = await staff();
    const agent = await loginAs(app, cashier);
    const admin = await loginAs(app, manager);
    const product = await createProduct({ shelf: 100, price: 100000 });

    await sell(agent, product.id, 4); // 400,000 RWF < default 500,000
    expect(await eventsOfType('HIGH_VALUE_SALE')).toHaveLength(0);

    const rule = await admin.put('/api/admin/notification-rules/HIGH_VALUE_SALE').send({ thresholds: { min_amount_rwf: 300000 } });
    expect(rule.status).toBe(200);
    await sell(agent, product.id, 4);
    const [event] = await eventsOfType('HIGH_VALUE_SALE');
    expect(event.params.amount_rwf).toBe('400,000 RWF');
    const [n] = (await inbox(manager.id)).filter((x) => x.type === 'HIGH_VALUE_SALE');
    expect(n.title).toContain('400,000 RWF');
  });

  test('SALE_VOIDED reaches the cashier whose sale it was, but not the voiding manager', async () => {
    const { cashier, manager } = await staff();
    const otherManager = await createUser('store_manager');
    const agent = await loginAs(app, cashier);
    const admin = await loginAs(app, manager);
    const product = await createProduct({ shelf: 10 });
    const sale = await sell(agent, product.id, 1);
    await admin.post(`/api/sales/${sale.id}/void`);

    expect((await inbox(cashier.id)).map((n) => n.type)).toContain('SALE_VOIDED');
    expect((await inbox(otherManager.id)).map((n) => n.type)).toContain('SALE_VOIDED');
    expect((await inbox(manager.id)).map((n) => n.type)).not.toContain('SALE_VOIDED');
  });

  test('refund velocity raises one grouped SUSPICIOUS_ACTIVITY alert', async () => {
    const { cashier, manager } = await staff();
    const agent = await loginAs(app, cashier);
    const product = await createProduct({ shelf: 100 });
    const sale = await sell(agent, product.id, 10);
    for (let i = 0; i < 7; i += 1) {
      expect((await agent.post('/api/returns').send({ sale_item_id: sale.items[0].id, quantity: 1, restocked: true })).status).toBe(201);
    }
    const events = await eventsOfType('SUSPICIOUS_ACTIVITY');
    expect(events).toHaveLength(1);
    expect(events[0].occurrence_count).toBe(3); // 5th, 6th, 7th refund
    expect((await inbox(manager.id)).filter((n) => n.type === 'SUSPICIOUS_ACTIVITY')).toHaveLength(1);
  });
});

describe('recipient resolution enforces the permission ceiling', () => {
  test('an admin cannot route financial alerts to roles lacking the permission', async () => {
    const { manager } = await staff();
    const admin = await loginAs(app, manager);
    const res = await admin.put('/api/admin/notification-rules/OVERPAYMENT').send({ recipient_roles: ['store_manager', 'cashier'] });
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/cashier cannot receive OVERPAYMENT/);
  });

  test('mandatory alerts cannot be disabled', async () => {
    const { manager } = await staff();
    const admin = await loginAs(app, manager);
    const res = await admin.put('/api/admin/notification-rules/FAILED_LOGIN_BURST').send({ enabled: false });
    expect(res.status).toBe(422);
  });

  test('disabled / inactive users receive nothing', async () => {
    await createUser('store_manager', { status: 'disabled' });
    const active = await createUser('store_manager');
    const event = await emit(db, { type: 'DELIVERY_RECEIVED', dedupKey: 'x:1', params: { supplier_name: 'S' } });
    expect(event).not.toBeNull();
    const recipients = await ownerDb()('notifications').where({ event_id: event.id }).pluck('recipient_user_id');
    expect(recipients).toEqual([active.id]);
  });

  test('duplicate emits with the same dedup key create one event', async () => {
    await createUser('store_manager');
    const results = await Promise.all(Array.from({ length: 5 }, () => emit(db, { type: 'DELIVERY_RECEIVED', dedupKey: 'dup:1', params: {} })));
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await eventsOfType('DELIVERY_RECEIVED')).toHaveLength(1);
  });

  test('user preferences can mute optional types but not mandatory ones', async () => {
    const { keeper } = await staff();
    const agent = await loginAs(app, keeper);
    const prefs = await agent.get('/api/notifications/preferences');
    const types = prefs.body.map((p) => p.type);
    expect(types).toContain('LOW_STOCK');
    expect(types).not.toContain('OVERPAYMENT'); // not something a store keeper can receive
    expect(prefs.body.find((p) => p.type === 'ACCOUNT_ROLE_CHANGED').mandatory).toBe(true);

    const put = await agent.put('/api/notifications/preferences').send({
      preferences: [{ type: 'LOW_STOCK', in_app_enabled: false, email_enabled: false }, { type: 'ACCOUNT_ROLE_CHANGED', in_app_enabled: false, email_enabled: false }],
    });
    expect(put.status).toBe(200);
    expect(put.body.find((p) => p.type === 'LOW_STOCK').in_app_enabled).toBe(false);
    expect(put.body.find((p) => p.type === 'ACCOUNT_ROLE_CHANGED').in_app_enabled).toBe(true);

    const bad = await agent.put('/api/notifications/preferences').send({ preferences: [{ type: 'OVERPAYMENT', in_app_enabled: true, email_enabled: true }] });
    expect(bad.status).toBe(400);
  });
});

describe('inbox API: ownership (IDOR) and state', () => {
  async function seededInbox() {
    const { cashier, keeper, manager } = await staff();
    await emit(db, { type: 'MANUAL', dedupKey: 'm:1', explicitUserIds: [keeper.id], params: { title: 'For keeper', message: 'hi', sender_name: 'x' } });
    await emit(db, { type: 'MANUAL', dedupKey: 'm:2', explicitUserIds: [cashier.id], params: { title: 'For cashier', message: 'hi', sender_name: 'x' } });
    return { cashier, keeper, manager };
  }

  test("users only ever see and change their own notifications", async () => {
    const { cashier, keeper } = await seededInbox();
    const keeperAgent = await loginAs(app, keeper);
    const cashierAgent = await loginAs(app, cashier);

    const keeperList = await keeperAgent.get('/api/notifications');
    expect(keeperList.body.items.map((n) => n.title)).toEqual(['For keeper']);
    const cashierNotificationId = (await inbox(cashier.id))[0].id;

    expect((await keeperAgent.patch(`/api/notifications/${cashierNotificationId}/read`).send({})).status).toBe(404);
    expect((await keeperAgent.patch(`/api/notifications/${cashierNotificationId}/archive`).send({})).status).toBe(404);
    expect((await ownerDb()('notifications').where({ id: cashierNotificationId }).first()).read_at).toBeNull();

    expect((await cashierAgent.get('/api/notifications/unread-count')).body.count).toBe(1);
    expect((await cashierAgent.patch(`/api/notifications/${cashierNotificationId}/read`).send({})).body.unread).toBe(0);
  });

  test('mark all read, archive and filters', async () => {
    const { keeper } = await seededInbox();
    await emit(db, { type: 'MANUAL', dedupKey: 'm:3', explicitUserIds: [keeper.id], params: { title: 'Second', message: 'x', sender_name: 'x' } });
    const agent = await loginAs(app, keeper);
    expect((await agent.get('/api/notifications?status=unread')).body.total).toBe(2);
    await agent.post('/api/notifications/read-all');
    expect((await agent.get('/api/notifications/unread-count')).body.count).toBe(0);
    const id = (await agent.get('/api/notifications')).body.items[0].id;
    await agent.patch(`/api/notifications/${id}/archive`).send({});
    expect((await agent.get('/api/notifications')).body.total).toBe(1);
    expect((await agent.get('/api/notifications?archived=true')).body.total).toBe(1);
  });

  test('unauthenticated requests are rejected', async () => {
    const request = require('supertest');
    expect((await request(app).get('/api/notifications')).status).toBe(401);
    expect((await request(app).get('/api/notifications/stream')).status).toBe(401);
  });
});

describe('account notifications', () => {
  test('role change and password reset notify the affected user, never with the password', async () => {
    const { cashier, manager } = await staff();
    const admin = await loginAs(app, manager);
    await admin.patch(`/api/auth/employees/${cashier.id}`).send({ role_name: 'store_keeper', password: 'new-password-123' });
    const mine = await inbox(cashier.id);
    expect(mine.map((n) => n.type).sort()).toEqual(['ACCOUNT_PASSWORD_RESET', 'ACCOUNT_ROLE_CHANGED']);
    const all = JSON.stringify(await ownerDb()('notifications')) + JSON.stringify(await ownerDb()('notification_events'));
    expect(all).not.toContain('new-password-123');
  });

  test('USER_CREATED goes to the new user and other managers, without the password', async () => {
    const { manager } = await staff();
    const other = await createUser('store_manager');
    const admin = await loginAs(app, manager);
    const res = await admin.post('/api/auth/employees').send({ full_name: 'New Person', email: 'new@test.local', password: 'initial-pass-99', role_name: 'cashier' });
    expect(res.status).toBe(201);
    expect((await inbox(res.body.id)).map((n) => n.type)).toEqual(['USER_CREATED']);
    expect((await inbox(other.id)).map((n) => n.type)).toContain('USER_CREATED');
    expect(JSON.stringify(await ownerDb()('notifications'))).not.toContain('initial-pass-99');
  });
});
