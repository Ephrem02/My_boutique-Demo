const request = require('supertest');
const app = require('../src/app');
const db = require('../src/config/db');
const worker = require('../src/notifications/worker');
const { resetDb, createUser, loginAs, createProduct, ownerDb, stockOf, eventsOfType, inbox, locations } = require('./helpers');

const today = () => new Date().toISOString().slice(0, 10);

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

const ok = (res, status = 201) => {
  expect([res.status, res.body.error]).toEqual([status, undefined]);
  return res.body;
};

async function supplierWithTvs(s, { payment } = {}) {
  const supplier = ok(await s.m.post('/api/suppliers').send({ name: 'Kigali Electronics' }));
  const tv = await createProduct({ name: 'TV', price: 150000, cost: 100000 });
  const agent = payment ? s.m : s.k;
  const delivery = ok(await agent.post('/api/supplier-deliveries').send({
    supplier_id: supplier.id, delivery_date: today(), payment_due_date: today(), reference_no: 'INV-2026-001',
    items: [{ product_id: tv.id, quantity: 20, unit_cost: 100000, batch_no: 'B-77', expiry_date: '2030-12-31' }],
    payment,
  }));
  return { supplier, tv, delivery };
}

async function customerInvoice(s, { discount = 0, payment, qty = 10, price = 100000, agent } = {}) {
  const customer = ok(await s.m.post('/api/institutions').send({ name: 'Green Hills School', type: 'school' }));
  const laptop = await createProduct({ name: 'Laptop', price, cost: 60000, storeRoom: 50 });
  const invoice = ok(await (agent || s.c).post('/api/institution-orders').send({
    institution_id: customer.id, order_date: today(), due_date: today(), discount_amount: discount,
    items: [{ product_id: laptop.id, quantity: qty, unit_price: price }], payment,
  }));
  return { customer, laptop, invoice };
}

const pay = (agent, side, id, body) => agent.post(`/api/finance/${side}/invoices/${id}/payments`).send(body);
const detail = async (agent, side, id) => ok(await agent.get(`/api/finance/${side}/invoices/${id}`), 200);

describe('supplier ledger', () => {
  beforeEach(() => resetDb());

  test('goods received on credit: reference, batch, expiry, received-by; stock in; outstanding balance', async () => {
    const s = await staff();
    const { delivery, tv } = await supplierWithTvs(s);
    expect(delivery).toMatchObject({ total_amount: 2000000, balance: 2000000, status: 'unpaid', reference_no: 'INV-2026-001' });
    const d = await detail(s.k, 'supplier', delivery.id);
    expect(d.items[0]).toMatchObject({ batch_no: 'B-77', quantity: 20, returnable_quantity: 20 });
    expect(d.items[0].expiry_date).toBeTruthy();
    expect(d.received_by_name).toBe('Kevin Keeper');
    expect((await stockOf(tv.id)).store_room).toBe(20);
  });

  test('instalments with different methods; each is its own row; balance reaches zero', async () => {
    const s = await staff();
    const { delivery } = await supplierWithTvs(s);
    ok(await pay(s.m, 'supplier', delivery.id, { amount: 600000, method: 'mtn_mobile_money', reference_no: 'MP123' }));
    const second = ok(await pay(s.m, 'supplier', delivery.id, { amount: 400000, method: 'airtel_money' }));
    expect(second.invoice).toMatchObject({ amount_paid: 1000000, balance: 1000000, status: 'partial' });
    const last = ok(await pay(s.m, 'supplier', delivery.id, { amount: 1000000, method: 'bank_transfer', reference_no: 'BK-9' }));
    expect(last.invoice).toMatchObject({ balance: 0, status: 'paid' });
    const d = await detail(s.m, 'supplier', delivery.id);
    expect(d.transactions.map((t) => [t.type, t.amount, t.method])).toEqual([
      ['payment', 600000, 'mtn_mobile_money'], ['payment', 400000, 'airtel_money'], ['payment', 1000000, 'bank_transfer'],
    ]);
    expect(d.transactions[0]).toMatchObject({ reference_no: 'MP123', recorded_by_name: 'Grace Manager' });
    expect(await ownerDb()('audit_logs').where({ action: 'supplier_payment.create' })).toHaveLength(3);
  });

  test('paid immediately on receipt (manager) -> balance 0; store keepers cannot pay suppliers at all', async () => {
    const s = await staff();
    const { delivery } = await supplierWithTvs(s, { payment: { amount: 2000000, method: 'bank_transfer', reference_no: 'BK-1' } });
    expect(delivery).toMatchObject({ balance: 0, status: 'paid' });

    const supplier = ok(await s.m.post('/api/suppliers').send({ name: 'Other' }));
    const p = await createProduct();
    const denied = await s.k.post('/api/supplier-deliveries').send({
      supplier_id: supplier.id, delivery_date: today(), items: [{ product_id: p.id, quantity: 1, unit_cost: 10 }], payment: { amount: 10, method: 'cash' },
    });
    expect(denied.status).toBe(403);
    expect((await pay(s.k, 'supplier', delivery.id, { amount: 1, method: 'cash' })).status).toBe(403);
    expect((await pay(s.c, 'supplier', delivery.id, { amount: 1, method: 'cash' })).status).toBe(403);
  });

  test('overpayment is recorded as supplier credit and alerts managers', async () => {
    const s = await staff();
    const { delivery } = await supplierWithTvs(s);
    const res = ok(await pay(s.m, 'supplier', delivery.id, { amount: 2100000, method: 'bank_transfer' }));
    expect(res.invoice).toMatchObject({ balance: -100000, status: 'credit' });
    expect(await eventsOfType('OVERPAYMENT')).toHaveLength(1);
  });

  test('return 2 of 20 TVs (damaged): stock 18, payable 1,800,000, never more than received', async () => {
    const s = await staff();
    const { delivery, tv } = await supplierWithTvs(s);
    const d = await detail(s.k, 'supplier', delivery.id);
    expect((await s.c.post(`/api/finance/supplier/invoices/${delivery.id}/returns`).send({})).status).toBe(403); // cashiers can't
    const res = ok(await s.k.post(`/api/finance/supplier/invoices/${delivery.id}/returns`).send({
      items: [{ item_id: d.items[0].id, quantity: 2 }], reason: 'damaged', notes: 'Cracked screens',
    }));
    expect(res.invoice).toMatchObject({ returns_total: 200000, balance: 1800000 });
    expect((await stockOf(tv.id)).store_room).toBe(18);
    expect((await detail(s.m, 'supplier', delivery.id)).items[0].returnable_quantity).toBe(18);
    const tooMany = await s.k.post(`/api/finance/supplier/invoices/${delivery.id}/returns`).send({ items: [{ item_id: d.items[0].id, quantity: 19 }], reason: 'damaged' });
    expect(tooMany.status).toBe(422);
    expect((await s.k.post(`/api/finance/supplier/invoices/${delivery.id}/returns`).send({ items: [{ item_id: d.items[0].id, quantity: 1 }], reason: 'nope' })).status).toBe(422);
    expect(await eventsOfType('SUPPLIER_RETURN_RECORDED')).toHaveLength(1);
    const movement = await ownerDb()('stock_movements').where({ type: 'returned_to_supplier' }).first();
    expect(movement.quantity).toBe(2);

    // Supplier response: managers only
    const returnId = res.return.id;
    expect((await s.k.post(`/api/finance/supplier/returns/${returnId}/response`).send({ response: 'accepted' })).status).toBe(403);
    expect(ok(await s.m.post(`/api/finance/supplier/returns/${returnId}/response`).send({ response: 'disputed', note: 'Says it was fine' }), 200))
      .toMatchObject({ supplier_response: 'disputed' });
  });

  test('credit from a return after payment: apply to the next invoice, or record the supplier refund (cash counts in the till)', async () => {
    const s = await staff();
    const { delivery, supplier, tv } = await supplierWithTvs(s, { payment: { amount: 2000000, method: 'bank_transfer' } });
    const d = await detail(s.m, 'supplier', delivery.id);
    ok(await s.k.post(`/api/finance/supplier/invoices/${delivery.id}/returns`).send({ items: [{ item_id: d.items[0].id, quantity: 3 }], reason: 'defective' }));
    expect((await detail(s.m, 'supplier', delivery.id)).balance).toBe(-300000); // supplier owes us 300,000

    const next = ok(await s.k.post('/api/supplier-deliveries').send({
      supplier_id: supplier.id, delivery_date: today(), items: [{ product_id: tv.id, quantity: 2, unit_cost: 100000 }],
    }));
    expect((await s.k.post(`/api/finance/supplier/invoices/${next.id}/credits`).send({ source_invoice_id: delivery.id, amount: 1 })).status).toBe(403);
    const tooMuch = await s.m.post(`/api/finance/supplier/invoices/${next.id}/credits`).send({ source_invoice_id: delivery.id, amount: 300001 });
    expect(tooMuch.status).toBe(422);
    const applied = ok(await s.m.post(`/api/finance/supplier/invoices/${next.id}/credits`).send({ source_invoice_id: delivery.id, amount: 200000 }));
    expect(applied.invoice.balance).toBe(0);
    expect(applied.source.balance).toBe(-100000);

    const refund = ok(await s.m.post(`/api/finance/supplier/invoices/${delivery.id}/refunds`).send({ amount: 100000, method: 'cash' }));
    expect(refund.invoice).toMatchObject({ balance: 0, refunds_total: 100000 });
    expect((await s.m.post(`/api/finance/supplier/invoices/${delivery.id}/refunds`).send({ amount: 1, method: 'cash' })).status).toBe(409);

    const board = (await s.m.get('/api/business-days/dashboard')).body.today;
    expect(board.figures.cash).toMatchObject({ account_cash_in: 100000, account_cash_out: 0 });

    const statement = ok(await s.m.get(`/api/finance/supplier/parties/${supplier.id}/statement`), 200);
    expect(statement.summary).toMatchObject({ invoiced: 2200000, returns: 300000, paid: 2000000, refunds: 100000, owed: 0, credit: 0, balance: 0 });
    expect(statement.entries[0].balance).toBe(0); // newest first, running balance
  });

  test('reversal is the only correction: manager-only, reason required, once, audited and alerted', async () => {
    const s = await staff();
    const { delivery } = await supplierWithTvs(s);
    const { transaction } = ok(await pay(s.m, 'supplier', delivery.id, { amount: 500000, method: 'card' }));
    expect((await s.k.post(`/api/finance/supplier/transactions/${transaction.id}/reverse`).send({ reason: 'Wrong invoice' })).status).toBe(403);
    expect((await s.m.post(`/api/finance/supplier/transactions/${transaction.id}/reverse`).send({ reason: 'x' })).status).toBe(422);
    const res = ok(await s.m.post(`/api/finance/supplier/transactions/${transaction.id}/reverse`).send({ reason: 'Recorded on the wrong invoice' }));
    expect(res.invoice).toMatchObject({ balance: 2000000, amount_paid: 0, status: 'unpaid' });
    expect((await s.m2.post(`/api/finance/supplier/transactions/${transaction.id}/reverse`).send({ reason: 'Again please' })).status).toBe(409);
    expect((await s.m.post(`/api/finance/supplier/transactions/${res.reversal.id}/reverse`).send({ reason: 'Undo the undo' })).status).toBe(409);
    const d = await detail(s.m, 'supplier', delivery.id);
    expect(d.transactions.find((t) => t.id === transaction.id)).toMatchObject({ reversed_by: res.reversal.id, reversal_reason: 'Recorded on the wrong invoice' });
    expect(await ownerDb()('audit_logs').where({ action: 'supplier_transaction.reverse' })).toHaveLength(1);
    expect(await eventsOfType('LEDGER_REVERSAL')).toHaveLength(1);
  });

  test('the database refuses edits and deletes of financial history, even for the API role', async () => {
    const s = await staff();
    const { delivery } = await supplierWithTvs(s);
    const { transaction } = ok(await pay(s.m, 'supplier', delivery.id, { amount: 1000, method: 'card' }));
    await expect(db('supplier_transactions').where({ id: transaction.id }).update({ amount: 1 })).rejects.toThrow(/permission denied/);
    await expect(db('supplier_transactions').where({ id: transaction.id }).del()).rejects.toThrow(/permission denied/);
    await expect(ownerDb()('supplier_transactions').where({ id: transaction.id }).update({ amount: 1 })).rejects.toThrow(/append-only/);
    await expect(db('supplier_deliveries').where({ id: delivery.id }).update({ total_amount: 1 })).rejects.toThrow(/ledger_protected/);
    await expect(db('supplier_deliveries').where({ id: delivery.id }).del()).rejects.toThrow(/ledger_protected/);
    await expect(db('supplier_delivery_items').where({ delivery_id: delivery.id }).update({ quantity: 1 })).rejects.toThrow(/permission denied/);
    // Non-financial fields stay editable
    await db('supplier_deliveries').where({ id: delivery.id }).update({ payment_due_date: '2030-01-01' });
    expect((await s.m.delete(`/api/suppliers/${delivery.supplier_id}`)).status).toBe(409);
  });

  test('due and overdue supplier invoices use the ledger balance', async () => {
    const s = await staff();
    const { delivery } = await supplierWithTvs(s);
    await db('supplier_deliveries').where({ id: delivery.id }).update({ payment_due_date: ownerDb().raw("current_date - interval '3 days'") });
    await worker.checkSupplierPayments();
    expect(await eventsOfType('SUPPLIER_PAYMENT_OVERDUE')).toHaveLength(1);
    ok(await pay(s.m, 'supplier', delivery.id, { amount: 2000000, method: 'bank_transfer' }));
    const list = ok(await s.m.get('/api/finance/supplier/invoices?overdue=1'), 200);
    expect(list).toEqual([]);
  });
});

describe('customer ledger', () => {
  beforeEach(() => resetDb());

  test('cashier records a discounted sale with part payment, then instalments; full history', async () => {
    const s = await staff();
    const { invoice, customer, laptop } = await customerInvoice(s, { discount: 50000, payment: { amount: 300000, method: 'mtn_mobile_money', reference_no: 'MTN-1' } });
    expect(invoice).toMatchObject({ total_amount: 950000, discount_amount: 50000, amount_paid: 300000, balance: 650000, status: 'partial' });
    expect((await stockOf(laptop.id)).store_room).toBe(40);
    ok(await pay(s.c, 'customer', invoice.id, { amount: 150000, method: 'cash' }));
    const done = ok(await pay(s.c, 'customer', invoice.id, { amount: 500000, method: 'airtel_money' }));
    expect(done.invoice).toMatchObject({ balance: 0, status: 'paid', amount_paid: 950000 });

    const statement = ok(await s.c.get(`/api/finance/customer/parties/${customer.id}/statement`), 200);
    expect(statement.summary).toMatchObject({ invoiced: 950000, paid: 950000, owed: 0 });
    expect(statement.entries.map((e) => e.kind).reverse()).toEqual(['invoice', 'payment', 'payment', 'payment']);
    expect(statement.entries.map((e) => e.balance).reverse()).toEqual([950000, 650000, 500000, 0]);
    // cash taken for an account counts in the till
    expect((await s.m.get('/api/business-days/dashboard')).body.today.figures.cash.account_cash_in).toBe(150000);
    expect(await eventsOfType('INSTITUTION_PAYMENT_RECEIVED')).toHaveLength(3);
  });

  test('a credit sale stays owed and becomes overdue', async () => {
    const s = await staff();
    const { invoice } = await customerInvoice(s, {});
    expect(invoice).toMatchObject({ balance: 1000000, status: 'unpaid' });
    await db('institution_orders').where({ id: invoice.id }).update({ due_date: ownerDb().raw("current_date - interval '1 day'") });
    await worker.checkCustomerPayments();
    await worker.checkCustomerPayments();
    expect(await eventsOfType('CUSTOMER_PAYMENT_OVERDUE')).toHaveLength(1);
    const summary = ok(await s.m.get('/api/institution-orders/unpaid-summary'), 200);
    expect(summary[0]).toMatchObject({ institution_name: 'Green Hills School', owed: 1000000, overdue: 1000000 });
  });

  test('small return is processed at once: restocked, value pro-rated for the discount, refunded by MTN', async () => {
    const s = await staff();
    const { invoice, laptop } = await customerInvoice(s, { qty: 2, price: 50000, discount: 10000, payment: { amount: 90000, method: 'card' } });
    const d = await detail(s.c, 'customer', invoice.id);
    const loc = await locations();
    const res = ok(await s.c.post(`/api/finance/customer/invoices/${invoice.id}/returns`).send({
      items: [{ item_id: d.items[0].id, quantity: 1, restock: true, location_id: loc.front_shelf }], reason: 'defective',
      refund: { amount: 45000, method: 'mtn_mobile_money', reference_no: 'MTN-R1' },
    }));
    expect(res.pending_approval).toBe(false);
    expect(res.return).toMatchObject({ status: 'approved', approval: 'auto', total_value: '45000.00' });
    expect(res.invoice).toMatchObject({ returns_total: 45000, refunds_total: 45000, balance: 0 });
    expect((await stockOf(laptop.id)).front_shelf).toBe(1);
  });

  test('a refund can never exceed what the customer paid; the rest stays as credit', async () => {
    const s = await staff();
    const { invoice } = await customerInvoice(s, { qty: 2, price: 40000 }); // unpaid
    const d = await detail(s.c, 'customer', invoice.id);
    const res = await s.c.post(`/api/finance/customer/invoices/${invoice.id}/returns`).send({
      items: [{ item_id: d.items[0].id, quantity: 1, restock: false }], reason: 'damaged', refund: { amount: 40000, method: 'cash' },
    });
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/has not paid/);
    // without a refund the return simply reduces what they owe
    const ok2 = ok(await s.c.post(`/api/finance/customer/invoices/${invoice.id}/returns`).send({ items: [{ item_id: d.items[0].id, quantity: 1, restock: false }], reason: 'damaged' }));
    expect(ok2.invoice.balance).toBe(40000);
  });

  test('large returns wait for a manager (never the requester); nothing moves until approved', async () => {
    const s = await staff();
    const { invoice, laptop } = await customerInvoice(s, { qty: 3, price: 200000, payment: { amount: 600000, method: 'bank_transfer' } });
    const d = await detail(s.c, 'customer', invoice.id);
    const res = ok(await s.c.post(`/api/finance/customer/invoices/${invoice.id}/returns`).send({
      items: [{ item_id: d.items[0].id, quantity: 2, restock: true }], reason: 'changed_mind', refund: { amount: 400000, method: 'bank_transfer' },
    }));
    expect(res.pending_approval).toBe(true);
    expect(res.invoice.balance).toBe(0);
    expect((await stockOf(laptop.id)).store_room).toBe(47);
    expect(await eventsOfType('CUSTOMER_RETURN_APPROVAL_NEEDED')).toHaveLength(1);
    // can't over-return while one is waiting
    expect((await s.c.post(`/api/finance/customer/invoices/${invoice.id}/returns`).send({ items: [{ item_id: d.items[0].id, quantity: 2 }], reason: 'other' })).status).toBe(422);

    const id = res.return.id;
    expect((await s.c.post(`/api/finance/customer/returns/${id}/decision`).send({ decision: 'approve' })).status).toBe(403);
    expect((await s.m.post(`/api/finance/customer/returns/${id}/decision`).send({ decision: 'reject' })).status).toBe(422);
    const approved = ok(await s.m.post(`/api/finance/customer/returns/${id}/decision`).send({ decision: 'approve', note: 'Unopened' }), 200);
    expect(approved.return).toMatchObject({ status: 'approved', approval: 'manager', decided_by: s.manager.id });
    expect(approved.invoice).toMatchObject({ returns_total: 400000, refunds_total: 400000, balance: 0 });
    expect((await stockOf(laptop.id)).store_room).toBe(49);
    expect((await inbox(s.cashier.id)).map((x) => x.type)).toContain('CUSTOMER_RETURN_DECIDED');
    await expect(ownerDb()('customer_returns').where({ id }).update({ decided_by: s.cashier.id })).rejects.toThrow(/customer_return_not_self_approved/);
  });

  test('managers record large returns without waiting; the approval limit is configurable', async () => {
    const s = await staff();
    const { invoice } = await customerInvoice(s, { qty: 2, price: 200000 });
    const d = await detail(s.m, 'customer', invoice.id);
    const res = ok(await s.m.post(`/api/finance/customer/invoices/${invoice.id}/returns`).send({ items: [{ item_id: d.items[0].id, quantity: 1, restock: true }], reason: 'defective' }));
    expect(res.pending_approval).toBe(false);
    expect((await s.c.put('/api/finance/settings').send({ customer_return_approval_rwf: 1 })).status).toBe(403);
    expect(ok(await s.m.put('/api/finance/settings').send({ customer_return_approval_rwf: 500000 }), 200).customer_return_approval_rwf).toBe(500000);
    const small = ok(await s.c.post(`/api/finance/customer/invoices/${invoice.id}/returns`).send({ items: [{ item_id: d.items[0].id, quantity: 1, restock: true }], reason: 'defective' }));
    expect(small.pending_approval).toBe(false);
  });
});

describe('till, permissions and overview', () => {
  beforeEach(() => resetDb({ openDay: false }));

  test('cash account payments need an open business day; other methods do not', async () => {
    const s = await staff();
    await s.m.post('/api/business-days/open').send({ opening_float: 0 });
    const { invoice } = await customerInvoice(s, {});
    await s.m.post('/api/business-days/current/closing/start');
    await s.m.post('/api/business-days/current/closing/submit').send({ counted_cash: 0 });
    const cash = await pay(s.c, 'customer', invoice.id, { amount: 1000, method: 'cash' });
    expect(cash.status).toBe(409);
    expect(cash.body.error).toMatch(/Business day is not open/);
    ok(await pay(s.c, 'customer', invoice.id, { amount: 1000, method: 'mtn_mobile_money' }));
  });

  test('closing expects sales cash + account cash in - account cash out', async () => {
    const s = await staff();
    await s.m.post('/api/business-days/open').send({ opening_float: 10000 });
    const { invoice } = await customerInvoice(s, {});
    const { delivery } = await supplierWithTvs(s);
    ok(await pay(s.c, 'customer', invoice.id, { amount: 50000, method: 'cash' }));
    ok(await pay(s.m, 'supplier', delivery.id, { amount: 20000, method: 'cash' }));
    const mistake = ok(await pay(s.c, 'customer', invoice.id, { amount: 7000, method: 'cash' }));
    ok(await s.m.post(`/api/finance/customer/transactions/${mistake.transaction.id}/reverse`).send({ reason: 'Typed twice' })); // same day: out of the till
    await s.c.post('/api/business-days/current/closing/start');
    const preview = ok(await s.c.get('/api/business-days/current/closing/preview'), 200);
    expect(preview.figures.cash).toEqual({ opening_float: 10000, cash_sales: 0, cash_refunds: 0, account_cash_in: 50000, account_cash_out: 20000, expected_cash: 40000 });
    const closed = ok(await s.c.post('/api/business-days/current/closing/submit').send({ counted_cash: 40000 }));
    expect(closed.closing.variance).toBe(0);
  });

  test('overview for managers only: payables, receivables, returns and money by method', async () => {
    const s = await staff();
    await s.m.post('/api/business-days/open').send({ opening_float: 0 });
    const { delivery } = await supplierWithTvs(s);
    ok(await pay(s.m, 'supplier', delivery.id, { amount: 500000, method: 'airtel_money' }));
    const { invoice } = await customerInvoice(s, { payment: { amount: 200000, method: 'mtn_mobile_money' } });
    ok(await pay(s.c, 'customer', invoice.id, { amount: 100000, method: 'mtn_mobile_money' }));

    expect((await s.c.get('/api/finance/overview')).status).toBe(403);
    expect((await s.k.get('/api/finance/overview')).status).toBe(403);
    const o = ok(await s.m.get('/api/finance/overview'), 200);
    expect(o.payables).toMatchObject({ purchases: 2000000, paid: 500000, outstanding: 1500000, returns: 0 });
    expect(o.receivables).toMatchObject({ credit_sales: 1000000, payments: 300000, outstanding: 700000 });
    expect(o.by_method.customer_payments.mtn_mobile_money).toBe(300000);
    expect(o.by_method.supplier_payments.airtel_money).toBe(500000);
    expect(o.top.customers_owing[0]).toMatchObject({ party_name: 'Green Hills School', amount: 700000 });

    // cashiers see customer balances but nothing on the supplier side
    expect((await s.c.get('/api/finance/customer/parties')).status).toBe(200);
    expect((await s.c.get('/api/finance/supplier/parties')).status).toBe(403);
    expect((await s.c.get('/api/finance/nonsense/parties')).status).toBe(404);
  });

  test('unauthenticated access is refused', async () => {
    expect((await request(app).get('/api/finance/overview')).status).toBe(401);
    expect((await request(app).post('/api/finance/customer/invoices/1/payments')).status).toBe(401);
  });
});
