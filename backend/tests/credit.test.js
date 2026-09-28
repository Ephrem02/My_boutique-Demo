const app = require('../src/app');
const db = require('../src/config/db');
const { resetDb, createUser, loginAs, createProduct, ownerDb, eventsOfType } = require('./helpers');

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

async function staff() {
  const cashier = await createUser('cashier', { full_name: 'Alice Cashier' });
  const keeper = await createUser('store_keeper', { full_name: 'Kevin Keeper' });
  const manager = await createUser('store_manager', { full_name: 'Grace Manager' });
  const manager2 = await createUser('store_manager', { full_name: 'Paul Manager' });
  return {
    cashier, manager, manager2,
    c: await loginAs(app, cashier), k: await loginAs(app, keeper), m: await loginAs(app, manager), m2: await loginAs(app, manager2),
  };
}

const ok = (res, status = 200) => {
  expect([res.status, res.body.error]).toEqual([status, undefined]);
  return res.body;
};

async function clientWithLimit(s, limit) {
  const client = ok(await s.m.post('/api/institutions').send({ name: 'Green Hills School', type: 'school' }), 201);
  if (limit !== undefined) ok(await s.m.put(`/api/institutions/${client.id}/credit`).send({ credit_limit: limit }));
  const product = await createProduct({ name: 'Laptop', price: 1000, storeRoom: 100 });
  const sell = (agent, qty, extra = {}) => agent.post('/api/institution-orders').send({
    institution_id: client.id, order_date: today(), items: [{ product_id: product.id, quantity: qty, unit_price: 1000 }], ...extra,
  });
  return { client, product, sell };
}

describe('Step 0: idempotency keys', () => {
  beforeEach(() => resetDb());

  test('the same key records a payment once and replays the first answer', async () => {
    const s = await staff();
    const { sell } = await clientWithLimit(s);
    const invoice = ok(await sell(s.c, 5), 201);
    const url = `/api/finance/customer/invoices/${invoice.id}/payments`;
    const body = { amount: 1000, method: 'mtn_mobile_money', reference_no: 'MP-1' };
    const first = ok(await s.c.post(url).set('Idempotency-Key', 'pay-key-0001').send(body), 201);
    const again = await s.c.post(url).set('Idempotency-Key', 'pay-key-0001').send(body);
    expect(again.status).toBe(201);
    expect(again.headers['idempotent-replay']).toBe('true');
    expect(again.body.transaction.id).toBe(first.transaction.id);
    expect(await ownerDb()('customer_transactions').where({ type: 'payment' })).toHaveLength(1);

    // same key, different body: refused; another user may use the same key
    expect((await s.c.post(url).set('Idempotency-Key', 'pay-key-0001').send({ ...body, amount: 2000 })).status).toBe(422);
    ok(await s.m.post(url).set('Idempotency-Key', 'pay-key-0001').send(body), 201);
    expect((await s.c.post(url).set('Idempotency-Key', 'bad key!').send(body)).status).toBe(422);
  });

  test('parallel double submits record one sale; a failed attempt frees the key for a retry', async () => {
    const s = await staff();
    const { sell } = await clientWithLimit(s);
    const results = await Promise.all([
      sell(s.c, 1).set('Idempotency-Key', 'sale-key-0001'),
      sell(s.c, 1).set('Idempotency-Key', 'sale-key-0001'),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual(expect.arrayContaining([201]));
    expect(results.every((r) => [201, 409].includes(r.status))).toBe(true);
    expect(await ownerDb()('institution_orders')).toHaveLength(1);

    const bad = await s.c.post('/api/institution-orders').set('Idempotency-Key', 'sale-key-0002').send({ institution_id: 999999, order_date: today(), items: [{ product_id: 1, quantity: 1, unit_price: 1 }] });
    expect(bad.status).toBe(404);
    expect(await ownerDb()('idempotency_keys').where({ key: 'sale-key-0002' })).toHaveLength(0);
  });

  test('"overdue" follows the shop timezone', async () => {
    const { rows } = await db.raw('SELECT shop_today() AS d');
    const shop = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Kigali', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const d = rows[0].d;
    expect(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`).toBe(shop);
  });
});

describe('credit limits', () => {
  beforeEach(() => resetDb());

  test('only managers set limits; each change is audited with before and after', async () => {
    const s = await staff();
    const { client } = await clientWithLimit(s);
    expect((await s.c.put(`/api/institutions/${client.id}/credit`).send({ credit_limit: 5000 })).status).toBe(403);
    expect((await s.m.put(`/api/institutions/${client.id}/credit`).send({ credit_limit: -1 })).status).toBe(422);
    // the general edit endpoint ignores credit fields
    ok(await s.m.put(`/api/institutions/${client.id}`).send({ credit_limit: 1, credit_enabled: false }));
    expect(await ownerDb()('institutions').where({ id: client.id }).first()).toMatchObject({ credit_enabled: true, credit_limit: null });

    ok(await s.m.put(`/api/institutions/${client.id}/credit`).send({ credit_limit: 5000 }));
    const row = await ownerDb()('audit_logs').where({ action: 'institution.credit_update' }).first();
    expect(row.old_values).toEqual({ credit_enabled: true, credit_limit: null });
    expect(row.new_values).toEqual({ credit_enabled: true, credit_limit: 5000 });
  });

  test('sales within the limit pass; over it are refused with the numbers; payments and returns free up credit', async () => {
    const s = await staff();
    const { client, sell } = await clientWithLimit(s, 5000);
    const first = ok(await sell(s.c, 4), 201); // exposure 4,000
    const refused = await sell(s.c, 2); // would be 6,000
    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({ code: 'CREDIT_LIMIT_EXCEEDED', limit: 5000, exposure: 4000, requested: 2000, available: 1000, excess: 1000 });
    expect(await ownerDb()('institution_orders')).toHaveLength(1); // nothing half-recorded

    // paying now counts: 2,000 sale with 1,000 paid puts only 1,000 on credit
    ok(await sell(s.c, 2, { payment: { amount: 1000, method: 'cash' } }), 201);
    const status = ok(await s.c.get(`/api/finance/customer/parties/${client.id}/credit`));
    expect(status).toMatchObject({ credit_limit: 5000, exposure: 5000, available: 0 });

    ok(await s.c.post(`/api/finance/customer/invoices/${first.id}/payments`).send({ amount: 3000, method: 'airtel_money' }), 201);
    expect(ok(await s.c.get(`/api/finance/customer/parties/${client.id}/credit`)).available).toBe(3000);

    // no limit = old behaviour; credit disabled = nothing on account, cash sales still fine
    ok(await s.m.put(`/api/institutions/${client.id}/credit`).send({ credit_enabled: false }));
    const disabled = await sell(s.c, 1);
    expect(disabled.body).toMatchObject({ code: 'CREDIT_NOT_ALLOWED' });
    ok(await sell(s.c, 1, { payment: { amount: 1000, method: 'cash' } }), 201);
  });

  test('two sales at the same moment cannot both slip under the limit', async () => {
    const s = await staff();
    const { sell } = await clientWithLimit(s, 5000);
    const results = await Promise.all([sell(s.c, 3), sell(s.m, 3)]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    const { rows } = await ownerDb().raw('SELECT COALESCE(SUM(balance), 0)::int AS total FROM customer_invoice_balances');
    expect(rows[0].total).toBe(3000);
  });

  test('a cashier asks, another manager approves once for today; the requester cannot approve', async () => {
    const s = await staff();
    const { client, sell } = await clientWithLimit(s, 1000);
    const asked = ok(await s.c.post('/api/credit-exceptions').send({ institution_id: client.id, amount: 2000, reason: 'Term fees arrive next week' }), 201);
    expect(asked).toMatchObject({ status: 'pending', business_date: today() });
    expect(await eventsOfType('CREDIT_EXCEPTION_REQUESTED')).toHaveLength(1);
    expect((await s.c.post(`/api/credit-exceptions/${asked.id}/decision`).send({ decision: 'approve' })).status).toBe(403);

    // a manager's own request needs the other manager
    const own = ok(await s.m.post('/api/credit-exceptions').send({ institution_id: client.id, amount: 500, reason: 'Own request test' }), 201);
    expect((await s.m.post(`/api/credit-exceptions/${own.id}/decision`).send({ decision: 'approve' })).status).toBe(403);
    await expect(ownerDb()('credit_exceptions').where({ id: own.id }).update({ status: 'approved', decided_by: s.manager.id })).rejects.toThrow(/not_self_approved/);

    // not usable while pending
    expect((await sell(s.c, 3, { credit_exception_id: asked.id })).status).toBe(409);
    ok(await s.m.post(`/api/credit-exceptions/${asked.id}/decision`).send({ decision: 'approve', note: 'OK this once' }));
    expect(await eventsOfType('CREDIT_EXCEPTION_DECIDED')).toHaveLength(1);

    // too far over for this approval, then used once, then spent
    expect((await sell(s.c, 4, { credit_exception_id: asked.id })).status).toBe(409); // 3,000 over
    const invoice = ok(await sell(s.c, 3, { credit_exception_id: asked.id }), 201); // 2,000 over
    expect(await ownerDb()('credit_exceptions').where({ id: asked.id }).first()).toMatchObject({ status: 'used', order_id: invoice.id });
    expect((await sell(s.c, 1, { credit_exception_id: asked.id })).status).toBe(409);
    await expect(ownerDb()('credit_exceptions').where({ id: asked.id }).del()).rejects.toThrow(/ledger_protected/);
  });

  test('a manager can approve inline with a reason; others cannot; managers are alerted', async () => {
    const s = await staff();
    const { sell } = await clientWithLimit(s, 1000);
    expect((await sell(s.c, 2, { credit_override: { reason: 'I say so' } })).status).toBe(403);
    expect((await sell(s.m, 2, { credit_override: { reason: '' } })).status).toBe(422);
    ok(await sell(s.m, 2, { credit_override: { reason: 'Long-standing school, fees due Friday' } }), 201);
    expect(await ownerDb()('credit_exceptions').where({ approval: 'inline', status: 'used' })).toHaveLength(1);
    expect(await eventsOfType('CREDIT_LIMIT_OVERRIDDEN')).toHaveLength(1);
    expect(await ownerDb()('audit_logs').where({ action: 'credit_exception.override' })).toHaveLength(1);
  });

  test('the till "on account" path enforces the same limit', async () => {
    const s = await staff();
    const { client, product } = await clientWithLimit(s, 500);
    await ownerDb()('stock_levels').where({ product_id: product.id }).update({ quantity: 50 });
    const res = await s.c.post('/api/sales').send({ payment_method: 'account', customer_id: client.id, items: [{ product_id: product.id, quantity: 1 }] });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('CREDIT_LIMIT_EXCEEDED');
  });

  test('yesterday\'s approvals expire', async () => {
    const s = await staff();
    const { client } = await clientWithLimit(s, 1000);
    const asked = ok(await s.c.post('/api/credit-exceptions').send({ institution_id: client.id, amount: 500, reason: 'Needs it today' }), 201);
    await ownerDb().transaction(async (trx) => {
      await trx.raw('SET LOCAL session_replication_role = replica'); // past the row guard, to fake an old request
      await trx.raw('UPDATE credit_exceptions SET business_date = business_date - 1 WHERE id = ?', [asked.id]);
    });
    await require('../src/finance/credit').expireOld();
    expect((await ownerDb()('credit_exceptions').where({ id: asked.id }).first()).status).toBe('expired');
  });
});

describe('day figures: sold on account', () => {
  beforeEach(() => resetDb());

  test('invoices of the day show as "sold on account", apart from till sales and takings', async () => {
    const s = await staff();
    const { client, product, sell } = await clientWithLimit(s);
    ok(await sell(s.c, 3, { payment: { amount: 1000, method: 'cash' } }), 201); // 3,000: 1,000 cash now, 2,000 on credit
    await ownerDb()('stock_levels').where({ product_id: product.id }).update({ quantity: 50 });
    ok(await s.c.post('/api/sales').send({ payment_method: 'account', customer_id: client.id, items: [{ product_id: product.id, quantity: 1 }] }), 201);

    const f = ok(await s.m.get('/api/business-days/dashboard')).today.figures;
    expect(f.sales.on_account).toEqual({ count: 2, total: 4000, paid_now: 1000, on_credit: 3000 });
    expect(f.sales.gross).toBe(0); // no till takings
    expect(f.cash.account_cash_in).toBe(1000); // the cash part is in the drawer count, once
  });
});
