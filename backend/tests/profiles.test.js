const request = require('supertest');
const app = require('../src/app');
const { resetDb, createUser, loginAs, createProduct, ownerDb } = require('./helpers');

const iso = (offsetDays = 0) => {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

async function staff() {
  const cashier = await createUser('cashier', { full_name: 'Alice Cashier' });
  const keeper = await createUser('store_keeper', { full_name: 'Kevin Keeper' });
  const manager = await createUser('store_manager', { full_name: 'Grace Manager' });
  return { cashier, keeper, manager, c: await loginAs(app, cashier), k: await loginAs(app, keeper), m: await loginAs(app, manager) };
}

const ok = (res, status = 200) => {
  expect([res.status, res.body.error]).toEqual([status, undefined]);
  return res.body;
};

describe('client and supplier profiles', () => {
  beforeEach(() => resetDb());

  test('identity fields are validated; edits are audited with exactly what changed', async () => {
    const s = await staff();
    const client = ok(await s.m.post('/api/institutions').send({
      name: 'Green Hills School', type: 'school', contact_email: 'bursar@greenhills.rw', district: 'Gasabo', sector: 'Kimironko',
      id_number: '102345678', assigned_user_id: s.cashier.id, notes: 'Pays at month end', not_a_field: 'ignored',
    }), 201);
    expect(client).toMatchObject({ status: 'active', district: 'Gasabo', assigned_user_id: s.cashier.id });
    expect(client.not_a_field).toBeUndefined();

    expect((await s.m.post('/api/institutions').send({ name: '' })).status).toBe(422);
    expect((await s.m.post('/api/institutions').send({ name: 'X', contact_email: 'nope' })).status).toBe(422);
    expect((await s.m.post('/api/institutions').send({ name: 'X', status: 'vip' })).status).toBe(422);
    expect((await s.m.post('/api/institutions').send({ name: 'X', assigned_user_id: 99999 })).status).toBe(422);
    expect((await s.c.put(`/api/institutions/${client.id}`).send({ status: 'blocked' })).status).toBe(403);

    const edited = ok(await s.m.put(`/api/institutions/${client.id}`).send({ status: 'inactive', sector: 'Remera', district: 'Gasabo' }));
    expect(edited).toMatchObject({ status: 'inactive', sector: 'Remera', name: 'Green Hills School' });
    const row = await ownerDb()('audit_logs').where({ action: 'institution.update' }).first();
    expect(row.old_values).toEqual({ status: 'active', sector: 'Kimironko' });
    expect(row.new_values).toEqual({ status: 'inactive', sector: 'Remera' });

    const got = ok(await s.c.get(`/api/institutions/${client.id}`));
    expect(got.assigned_user_name).toBe('Alice Cashier');
    expect(ok(await s.c.get('/api/institutions?status=inactive'))).toHaveLength(1);

    const supplier = ok(await s.m.post('/api/suppliers').send({ name: 'Kigali Electronics', category: 'Electronics', tin: '100200300', status: 'under_review' }), 201);
    expect(supplier).toMatchObject({ category: 'Electronics', tin: '100200300', status: 'under_review' });
    expect((await s.m.post('/api/suppliers').send({ name: 'Y', status: 'blocked' })).status).toBe(422); // suppliers are never "blocked"
  });

  test('a blocked client gets no new sales on account but can still pay what they owe', async () => {
    const s = await staff();
    const client = ok(await s.m.post('/api/institutions').send({ name: 'Late Payer Ltd', type: 'company' }), 201);
    const p = await createProduct({ price: 1000, storeRoom: 10 });
    const invoice = ok(await s.c.post('/api/institution-orders').send({ institution_id: client.id, order_date: iso(), items: [{ product_id: p.id, quantity: 2, unit_price: 1000 }] }), 201);
    ok(await s.m.put(`/api/institutions/${client.id}`).send({ status: 'blocked' }));
    const denied = await s.c.post('/api/institution-orders').send({ institution_id: client.id, order_date: iso(), items: [{ product_id: p.id, quantity: 1, unit_price: 1000 }] });
    expect(denied.status).toBe(409);
    expect(denied.body.error).toMatch(/blocked/);
    ok(await s.c.post(`/api/finance/customer/invoices/${invoice.id}/payments`).send({ amount: 2000, method: 'mtn_mobile_money' }), 201);
  });

  test('client insights: on-time vs late, days to pay, instalments, top products, overdue', async () => {
    const s = await staff();
    const client = ok(await s.m.post('/api/institutions').send({ name: 'Green Hills School', type: 'school' }), 201);
    const laptop = await createProduct({ name: 'Laptop', price: 100000, storeRoom: 50 });
    const mouse = await createProduct({ name: 'Mouse', price: 5000, storeRoom: 50 });
    const sell = (body) => s.c.post('/api/institution-orders').send({ institution_id: client.id, ...body });
    // paid late: sold 10 days ago, due 5 days ago, paid today in two instalments
    const late = ok(await sell({ order_date: iso(-10), due_date: iso(-5), items: [{ product_id: laptop.id, quantity: 2, unit_price: 100000 }] }), 201);
    ok(await s.c.post(`/api/finance/customer/invoices/${late.id}/payments`).send({ amount: 50000, method: 'airtel_money' }), 201);
    ok(await s.c.post(`/api/finance/customer/invoices/${late.id}/payments`).send({ amount: 150000, method: 'airtel_money' }), 201);
    // paid on time at the sale
    ok(await sell({ order_date: iso(), due_date: iso(7), items: [{ product_id: mouse.id, quantity: 4, unit_price: 5000 }], payment: { amount: 20000, method: 'mtn_mobile_money' } }), 201);
    // still open and overdue
    const open = ok(await sell({ order_date: iso(-3), due_date: iso(-1), items: [{ product_id: mouse.id, quantity: 2, unit_price: 5000 }] }), 201);

    const ins = ok(await s.m.get(`/api/finance/customer/parties/${client.id}/insights`));
    expect(ins.financial).toMatchObject({ lifetime_purchases: 230000, invoice_count: 3, owed: 10000, paid: 220000 });
    expect(ins.behaviour.paid_on_time).toEqual({ count: 1, amount: 20000 });
    expect(ins.behaviour.paid_late).toEqual({ count: 1, amount: 200000 });
    expect(ins.behaviour.avg_days_late).toBe(5);
    expect(ins.behaviour.paid_in_instalments).toBe(1);
    expect(ins.behaviour.overdue_invoices).toEqual([expect.objectContaining({ id: open.id, balance: 10000, days_overdue: 1 })]);
    expect(ins.purchasing.top_products[0]).toMatchObject({ product_name: 'Mouse', quantity: 6 });
    expect(ins.purchasing.last_purchase_date).toBe(iso());
    expect(ins.purchasing.inactive).toBe(false);
    // the period filter narrows purchasing, not balances
    const recent = ok(await s.m.get(`/api/finance/customer/parties/${client.id}/insights?from=${iso(-4)}`));
    expect(recent.purchasing.purchases).toBe(2);
    expect(recent.financial.owed).toBe(10000);
    // money insights follow the money permission
    expect((await s.k.get(`/api/finance/customer/parties/${client.id}/insights`)).status).toBe(200);
  });

  test('supplier insights: cost changes, return rate by reason, payables', async () => {
    const s = await staff();
    const supplier = ok(await s.m.post('/api/suppliers').send({ name: 'Kigali Electronics' }), 201);
    const tv = await createProduct({ name: 'TV', price: 150000 });
    const receive = (date, cost, qty) => s.k.post('/api/supplier-deliveries').send({ supplier_id: supplier.id, delivery_date: date, items: [{ product_id: tv.id, quantity: qty, unit_cost: cost }] });
    ok(await receive(iso(-30), 100000, 10), 201);
    const second = ok(await receive(iso(), 110000, 10), 201);
    const d = ok(await s.k.get(`/api/finance/supplier/invoices/${second.id}`));
    ok(await s.k.post(`/api/finance/supplier/invoices/${second.id}/returns`).send({ items: [{ item_id: d.items[0].id, quantity: 2 }], reason: 'damaged' }), 201);

    const ins = ok(await s.m.get(`/api/finance/supplier/parties/${supplier.id}/insights`));
    expect(ins.products[0]).toMatchObject({ product_name: 'TV', first_cost: 100000, last_cost: 110000, change_pct: 10, quantity: 20 });
    expect(ins.performance).toMatchObject({ deliveries: 2, units_received: 20, units_returned: 2, return_rate_units: 0.1, quality_issue_units: 2 });
    expect(ins.performance.returns_by_reason).toEqual([{ reason: 'damaged', returns: 1, quantity: 2, value: 220000 }]);
    expect(ins.financial).toMatchObject({ owed: 1880000, fully_paid: 0, unpaid: 1, partially_paid: 1 }); // a return lowers the balance like a part payment
    expect((await s.c.get(`/api/finance/supplier/parties/${supplier.id}/insights`)).status).toBe(403);
  });

  test('activity trail is manager-only; notes are append-only; statement exports as CSV', async () => {
    const s = await staff();
    const client = ok(await s.m.post('/api/institutions').send({ name: 'Green Hills School' }), 201);
    const p = await createProduct({ price: 1000, storeRoom: 10 });
    const invoice = ok(await s.c.post('/api/institution-orders').send({ institution_id: client.id, order_date: iso(), items: [{ product_id: p.id, quantity: 3, unit_price: 1000 }] }), 201);
    ok(await s.c.post(`/api/finance/customer/invoices/${invoice.id}/payments`).send({ amount: 1000, method: 'cash', reference_no: 'R-1' }), 201);

    // notes: cashiers take payments, so they can log follow-ups; keepers can only read
    const note = ok(await s.c.post(`/api/finance/customer/parties/${client.id}/notes`).send({ body: 'Promised the rest on Friday', follow_up_date: iso(3) }), 201);
    expect((await s.k.post(`/api/finance/customer/parties/${client.id}/notes`).send({ body: 'x' })).status).toBe(403);
    expect((await s.c.post(`/api/finance/customer/parties/${client.id}/notes`).send({ body: '  ' })).status).toBe(422);
    expect(ok(await s.k.get(`/api/finance/customer/parties/${client.id}/notes`))[0]).toMatchObject({ body: 'Promised the rest on Friday', created_by_name: 'Alice Cashier' });
    const { default: knex } = { default: require('../src/config/db') };
    await expect(knex('party_notes').where({ id: note.id }).update({ body: 'edited' })).rejects.toThrow(/permission denied/);

    expect((await s.c.get(`/api/finance/customer/parties/${client.id}/activity`)).status).toBe(403);
    const trail = ok(await s.m.get(`/api/finance/customer/parties/${client.id}/activity`));
    expect(trail.map((a) => a.action)).toEqual(expect.arrayContaining(['institution.create', 'institution.note', 'customer_payment.create']));
    expect(trail.find((a) => a.action === 'customer_payment.create')).toMatchObject({ invoice_id: invoice.id, actor_name: 'Alice Cashier' });

    const csv = await s.c.get(`/api/finance/customer/parties/${client.id}/statement?format=csv`);
    expect(csv.status).toBe(200);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    const lines = csv.text.replace(/^﻿/, '').split('\r\n');
    expect(lines[0]).toMatch(/^Date,Supplier \/ customer,Entry,Invoice/);
    expect(lines).toHaveLength(3); // header, invoice, payment
    expect(lines[2]).toMatch(/payment.*R-1.*-1000.*2000/);
  });

  test('the inactivity period is a manager setting', async () => {
    const s = await staff();
    expect((await s.m.put('/api/finance/settings').send({ inactive_customer_days: 0 })).status).toBe(422);
    expect(ok(await s.m.put('/api/finance/settings').send({ inactive_customer_days: 30 })).inactive_customer_days).toBe(30);
    expect(request).toBeDefined();
  });
});
