const app = require('../src/app');
const { resetDb, createUser, loginAs, createProduct, ownerDb, stockOf } = require('./helpers');

const shopDay = (offset = 0) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Kigali' }).format(new Date(Date.now() + offset * 86400000));

async function staff() {
  const cashier = await createUser('cashier', { full_name: 'Alice Cashier' });
  const keeper = await createUser('store_keeper', { full_name: 'Kevin Keeper' });
  const manager = await createUser('store_manager', { full_name: 'Grace Manager' });
  return { cashier, keeper, manager, c: await loginAs(app, cashier), k: await loginAs(app, keeper), m: await loginAs(app, manager) };
}

const ok = (res, status = 200) => {
  expect([res.status, res.body?.error]).toEqual([status, undefined]);
  return res.body;
};

/** supertest: collect a binary body */
const binary = (req) => req.buffer(true).parse((res, cb) => {
  const chunks = [];
  res.on('data', (c) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
});
const pageCount = (buf) => (buf.toString('latin1').match(/\/Type \/Page\b/g) || []).length;

async function currentDayId() {
  return (await ownerDb()('business_days').whereIn('status', ['open', 'closing_in_progress']).first('id')).id;
}

describe('daily report', () => {
  beforeEach(() => resetDb());

  test('separates till sales, sold on account and collections; staff print only the day in progress', async () => {
    const s = await staff();
    const client = ok(await s.m.post('/api/institutions').send({ name: 'Green Hills School' }), 201);
    const p = await createProduct({ price: 1000, shelf: 20, storeRoom: 20 });
    ok(await s.c.post('/api/sales').send({ payment_method: 'cash', items: [{ product_id: p.id, quantity: 2 }] }), 201); // till 2,000
    ok(await s.c.post('/api/institution-orders').send({
      institution_id: client.id, order_date: shopDay(), items: [{ product_id: p.id, quantity: 3, unit_price: 1000 }], payment: { amount: 1000, method: 'cash' },
    }), 201); // on account 3,000, 1,000 paid now
    // an invoice from an earlier day (no business day stamped), paid today by MoMo
    const [old] = await ownerDb()('institution_orders').insert({ institution_id: client.id, order_date: shopDay(-5), total_amount: 5000, recorded_by: s.manager.id }).returning('*');
    ok(await s.c.post(`/api/finance/customer/invoices/${old.id}/payments`).send({ amount: 4000, method: 'mtn_mobile_money' }), 201);

    const dayId = await currentDayId();
    const report = ok(await s.c.get(`/api/documents/daily/${dayId}`));
    expect(report.kind).toBe('live');
    expect(report.sales).toMatchObject({ gross: 2000, on_account: { count: 1, total: 3000, paid_now: 1000, on_credit: 2000 } });
    expect(report.collections).toMatchObject({ client_payments_at_sale: 1000, client_payments_previous: 4000, client_payments: 5000 });
    expect(report.collections.by_method.mtn_mobile_money.client_payments).toBe(4000);
    expect(report.per_cashier).toBeUndefined(); // staff figures are for managers
    expect(ok(await s.m.get(`/api/documents/daily/${dayId}`)).per_cashier[0]).toMatchObject({ name: 'Alice Cashier', sales: 2000 });

    const res = await binary(s.c.get(`/api/documents/daily/${dayId}?format=pdf`));
    expect(res.status).toBe(200);
    expect(res.headers['x-document-type']).toBe('application/pdf');
    expect(res.body.subarray(0, 5).toString()).toBe('%PDF-');
    expect(await ownerDb()('audit_logs').where({ action: 'document.download' })).toHaveLength(1);

    // once closed, only managers may print it - and it comes from the snapshot
    ok(await s.c.post('/api/business-days/current/closing/start'));
    ok(await s.c.post('/api/business-days/current/closing/submit').send({ counted_cash: 3000, explanation: 'All counted' }), 201);
    expect((await s.c.get(`/api/documents/daily/${dayId}`)).status).toBe(403);
    const closed = ok(await s.m.get(`/api/documents/daily/${dayId}`));
    const snapshot = (await ownerDb()('daily_closings').where({ business_day_id: dayId }).first()).snapshot;
    expect(closed.kind).toBe('closed');
    expect(closed.sales).toEqual(snapshot.sales);
    expect(closed.closing).toMatchObject({ counted_cash: 3000, expected_cash: snapshot.cash.expected_cash });
  });
});

describe('employee 360', () => {
  beforeEach(() => resetDb());

  test('managers see anyone, staff only themselves; figures come from their own records', async () => {
    const s = await staff();
    const p = await createProduct({ price: 500, shelf: 50 });
    for (let i = 0; i < 3; i += 1) ok(await s.c.post('/api/sales').send({ payment_method: i ? 'cash' : 'card', items: [{ product_id: p.id, quantity: 2 }] }), 201);
    ok(await s.m.post('/api/sales').send({ payment_method: 'cash', items: [{ product_id: p.id, quantity: 1 }] }), 201);

    const profile = ok(await s.m.get(`/api/documents/employees/${s.cashier.id}`));
    expect(profile.employee).toMatchObject({ full_name: 'Alice Cashier', role: 'cashier' });
    expect(profile.sales).toMatchObject({ count: 3, total: 3000, by_method: { cash: 2000, card: 1000 } });
    expect(profile.period.to).toBe(shopDay());
    expect(Array.isArray(profile.activity)).toBe(true); // managers with audit.view get the audit trail

    const mine = ok(await s.c.get('/api/documents/employees/me'));
    expect(mine.employee.id).toBe(s.cashier.id);
    expect(mine.activity).toBeUndefined();
    expect((await s.c.get(`/api/documents/employees/${s.manager.id}`)).status).toBe(403);
    expect((await s.m.get(`/api/documents/employees/${s.cashier.id}?from=2026-02-01&to=2026-01-01`)).status).toBe(422);

    const pdf = await binary(s.m.get(`/api/documents/employees/${s.cashier.id}?format=pdf`));
    expect(pdf.status).toBe(200);
    expect(pageCount(pdf.body)).toBeGreaterThanOrEqual(1);
  });
});

describe('business details', () => {
  beforeEach(() => resetDb());

  test('only managers change the header printed on documents; changes are audited', async () => {
    const s = await staff();
    expect((await s.c.put('/api/documents/settings').send({ name: 'X' })).status).toBe(403);
    expect((await s.m.put('/api/documents/settings').send({ name: '' })).status).toBe(422);
    ok(await s.m.put('/api/documents/settings').send({ name: 'Kigali Corner Shop', tin: '100200300', phone: '+250788000000' }));
    expect(ok(await s.c.get('/api/documents/settings'))).toMatchObject({ name: 'Kigali Corner Shop', tin: '100200300' });
    expect(await ownerDb()('audit_logs').where({ action: 'business_settings.update' })).toHaveLength(1);
  });
});

describe('proformas', () => {
  beforeEach(() => resetDb());

  const quote = (agent, extra = {}) => agent.post('/api/proformas').send({ customer_name: 'Walk-in Jean', valid_until: shopDay(7), ...extra });

  test('a price proposal records no sale, no stock and no debt; numbers are sequential and never reused', async () => {
    const s = await staff();
    const p = await createProduct({ name: 'Laptop', price: 100000, storeRoom: 10 });
    const items = [{ product_id: p.id, quantity: 2 }];
    expect((await quote(s.c, { items, valid_until: undefined })).status).toBe(422); // expiry must be chosen
    expect((await quote(s.c, { items, valid_until: shopDay(-1) })).status).toBe(422);
    expect((await quote(s.c, { items, customer_name: '' })).status).toBe(422);

    const first = ok(await quote(s.c, { items, discount_amount: 10000, payment_terms: '50% on order' }), 201);
    expect(first).toMatchObject({ subtotal: 200000, discount_amount: 10000, total_amount: 190000, state: 'issued', valid_until: shopDay(7) });
    expect(first.number).toBe(`PRO-${shopDay().slice(0, 4)}-000001`);
    expect((await stockOf(p.id)).store_room).toBe(10);
    expect(await ownerDb()('institution_orders')).toHaveLength(0);
    expect(await ownerDb()('customer_transactions')).toHaveLength(0);

    const more = await Promise.all([1, 2, 3, 4].map(() => quote(s.c, { items })));
    const numbers = more.map((r) => ok(r, 201).number).sort();
    expect(numbers).toEqual([2, 3, 4, 5].map((n) => `PRO-${shopDay().slice(0, 4)}-00000${n}`));

    // lines and totals can never change after issue
    await expect(ownerDb()('proforma_items').where({ proforma_id: first.id }).update({ unit_price: 1 })).rejects.toThrow(/ledger_protected/);
    await expect(ownerDb()('proformas').where({ id: first.id }).update({ total_amount: 1 })).rejects.toThrow(/ledger_protected/);
    expect((await s.k.post('/api/proformas').send({})).status).toBe(422); // keepers may issue (they make invoices)
  });

  test('converting makes the real sale at the quoted prices, once; cancelled or expired ones cannot be converted', async () => {
    const s = await staff();
    const client = ok(await s.m.post('/api/institutions').send({ name: 'Green Hills School' }), 201);
    const p = await createProduct({ name: 'Laptop', price: 100000, storeRoom: 10 });
    const pro = ok(await quote(s.c, { institution_id: client.id, items: [{ product_id: p.id, quantity: 2, unit_price: 95000 }], discount_amount: 5000 }), 201);
    expect(pro.customer_name).toBe('Green Hills School');

    const converted = ok(await s.c.post(`/api/proformas/${pro.id}/convert`).send({ payment: { amount: 50000, method: 'cash' } }), 201);
    expect(converted.order).toMatchObject({ total_amount: 185000, balance: 135000, institution_id: client.id });
    expect((await stockOf(p.id)).store_room).toBe(8);
    expect(ok(await s.c.get(`/api/proformas/${pro.id}`))).toMatchObject({ state: 'converted', converted_order_id: converted.order.id });
    expect((await s.c.post(`/api/proformas/${pro.id}/convert`).send({})).status).toBe(409);

    // walk-in: a client must be chosen to convert
    const walkIn = ok(await quote(s.c, { items: [{ product_id: p.id, quantity: 1 }] }), 201);
    expect((await s.c.post(`/api/proformas/${walkIn.id}/convert`).send({})).status).toBe(422);

    expect((await s.c.post(`/api/proformas/${walkIn.id}/cancel`).send({ reason: '' })).status).toBe(422);
    ok(await s.c.post(`/api/proformas/${walkIn.id}/cancel`).send({ reason: 'Customer bought elsewhere' }));
    expect((await s.c.post(`/api/proformas/${walkIn.id}/convert`).send({ institution_id: client.id })).status).toBe(409);

    const late = ok(await quote(s.c, { institution_id: client.id, items: [{ product_id: p.id, quantity: 1 }] }), 201);
    await ownerDb().transaction(async (trx) => {
      await trx.raw('SET LOCAL session_replication_role = replica');
      await trx.raw("UPDATE proformas SET issue_date = issue_date - 10, valid_until = valid_until - 9 WHERE id = ?", [late.id]);
    });
    expect(ok(await s.c.get(`/api/proformas/${late.id}`)).state).toBe('expired');
    expect((await s.c.post(`/api/proformas/${late.id}/convert`).send({})).status).toBe(409);
    expect(ok(await s.c.get('/api/proformas?status=expired')).map((x) => x.id)).toEqual([late.id]);

    const pdf = await binary(s.c.get(`/api/proformas/${pro.id}?format=pdf`));
    expect(pdf.status).toBe(200);
    expect(pdf.headers['x-document-filename']).toMatch(/PRO-\d{4}-000001\.pdf/);
  });
});
