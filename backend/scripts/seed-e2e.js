// Seeds the TEST database (never dev/prod) with realistic demo data for the
// frontend's Playwright checks: every role, a closed "yesterday" with a
// variance, an open "today" with sales, low stock, suppliers, clients and
// notifications. Password for every account: correct-horse-battery
//
// Usage: npm run seed:e2e
process.env.NODE_ENV = 'test';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const h = require('../tests/helpers');

async function main() {
  await require('../tests/globalSetup')();
  await h.resetDb({ openDay: false });

  const manager = await h.createUser('store_manager', { full_name: 'Grace Uwase', email: 'manager@demo.local' });
  await h.createUser('store_manager', { full_name: 'Paul Mugisha', email: 'manager2@demo.local' });
  const keeper = await h.createUser('store_keeper', { full_name: 'Kevin Habimana', email: 'keeper@demo.local' });
  const alice = await h.createUser('cashier', { full_name: 'Alice Mukamana', email: 'cashier@demo.local' });
  const bob = await h.createUser('cashier', { full_name: 'Bob Nkurunziza', email: 'cashier2@demo.local' });

  const owner = h.ownerDb();
  const [food, home] = await owner('categories').insert([{ name: 'Food' }, { name: 'Household' }]).returning('*');
  const products = [];
  for (const [name, sku, price, cost, reorder, shelf, room, cat] of [
    ['Rice 5kg', 'RICE-5', 9000, 7000, 5, 30, 20, food],
    ['Cooking oil 1L', 'OIL-1', 3500, 2800, 10, 12, 6, food],
    ['Sugar 1kg', 'SUG-1', 1800, 1400, 10, 8, 0, food],
    ['Soap bar', 'SOAP-1', 800, 500, 10, 40, 60, home],
    ['Toothpaste', 'TP-100', 1500, 1000, 6, 3, 0, home],
    ['Milk 500ml', 'MILK-5', 700, 500, 12, 0, 0, food],
  ]) {
    const p = await h.createProduct({ name, sku, price, cost, reorder, shelf, storeRoom: room });
    await owner('products').where({ id: p.id }).update({ category_id: cat.id });
    products.push(p);
  }
  const [supplier] = await owner('suppliers').insert({ name: 'Kigali Wholesale Ltd', contact_phone: '+250788000111' }).returning('*');
  const [institution] = await owner('institutions').insert({ name: 'Green Hills School', type: 'school', contact_person: 'Jean' }).returning('*');

  const app = require('../src/app');
  const a = await h.loginAs(app, alice);
  const b = await h.loginAs(app, bob);
  const m = await h.loginAs(app, manager);
  const k = await h.loginAs(app, keeper);
  const sell = (agent, p, qty, method) => agent.post('/api/sales').send({ payment_method: method, items: [{ product_id: p.id, quantity: qty }] });

  const yesterday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Kigali' }).format(new Date(Date.now() - 86400000));
  await h.openBusinessDay({ date: yesterday, openingFloat: 20000, openedBy: bob.id });
  await sell(a, products[0], 3, 'cash');
  await sell(b, products[3], 10, 'mtn_mobile_money');
  await sell(a, products[0], 2, 'airtel_money');
  await sell(b, products[1], 1, 'card');
  await a.post('/api/business-days/current/closing/start');
  await a.post('/api/business-days/current/closing/submit').send({ counted_cash: 44000, explanation: 'Gave change twice to one customer' });

  await b.post('/api/business-days/open').send({ opening_float: 20000 });
  await sell(b, products[0], 2, 'cash');
  await sell(a, products[3], 3, 'airtel_money');
  await sell(a, products[1], 2, 'mtn_mobile_money');
  await sell(b, products[4], 2, 'card');

  await k.post('/api/supplier-deliveries').send({
    supplier_id: supplier.id, delivery_date: new Date().toISOString().slice(0, 10), payment_due_date: new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10),
    items: [{ product_id: products[2].id, quantity: 20, unit_cost: 1400 }],
  });
  await k.post('/api/institution-orders').send({
    institution_id: institution.id, order_date: new Date().toISOString().slice(0, 10), items: [{ product_id: products[3].id, quantity: 5, unit_price: 750 }],
  });
  await m.post('/api/admin/notifications/manual').send({ title: 'Stock count on Friday', message: 'Please stay 30 minutes after closing.', recipient_roles: ['cashier', 'store_keeper'] });

  console.log('E2E demo data ready in the test database (password: correct-horse-battery).');
  await require('../src/config/db').destroy();
  await h.closeOwner();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
