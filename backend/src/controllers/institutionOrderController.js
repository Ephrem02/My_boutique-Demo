const db = require('../config/db');
const { createOrder, markDelivered, recordPayment, getUnpaidSummary } = require('../models/institutionService');

// GET /api/institution-orders?institution_id=&delivery_status=&payment_status=
async function list(req, res) {
  const { institution_id, delivery_status, payment_status } = req.query;
  const query = db('institution_orders')
    .select('institution_orders.*', 'institutions.name as institution_name')
    .join('institutions', 'institutions.id', 'institution_orders.institution_id')
    .orderBy('institution_orders.order_date', 'desc');

  if (institution_id) query.where('institution_orders.institution_id', institution_id);
  if (delivery_status) query.where('institution_orders.delivery_status', delivery_status);
  if (payment_status) query.where('institution_orders.payment_status', payment_status);

  res.json(await query);
}

// GET /api/institution-orders/:id
async function getOne(req, res) {
  const { id } = req.params;
  const order = await db('institution_orders')
    .select('institution_orders.*', 'institutions.name as institution_name')
    .join('institutions', 'institutions.id', 'institution_orders.institution_id')
    .where('institution_orders.id', id)
    .first();
  if (!order) return res.status(404).json({ error: 'Order not found' });

  const items = await db('institution_order_items')
    .select('institution_order_items.*', 'products.name as product_name', 'products.sku')
    .join('products', 'products.id', 'institution_order_items.product_id')
    .where('order_id', id);

  const payments = await db('institution_payments').where({ order_id: id }).orderBy('paid_date');

  res.json({ ...order, items, payments });
}

// POST /api/institution-orders
// { institution_id, order_date, delivery_date, items: [{ product_id, quantity, unit_price }] }
async function create(req, res) {
  const { institution_id, order_date, delivery_date, items } = req.body;
  if (!institution_id || !order_date || !items || !items.length) {
    return res.status(400).json({ error: 'institution_id, order_date and at least one item are required' });
  }
  try {
    const order = await createOrder({
      institutionId: institution_id,
      orderDate: order_date,
      deliveryDate: delivery_date,
      items,
      recordedBy: req.user.id,
    });
    res.status(201).json(order);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

// POST /api/institution-orders/:id/deliver
async function deliver(req, res) {
  const { id } = req.params;
  try {
    const order = await markDelivered({ orderId: id, performedBy: req.user.id });
    res.json(order);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

// POST /api/institution-orders/:id/payments
async function pay(req, res) {
  const { id } = req.params;
  const { amount, paid_date, method } = req.body;
  if (!amount || !paid_date) {
    return res.status(400).json({ error: 'amount and paid_date are required' });
  }
  try {
    const result = await recordPayment({
      orderId: id,
      amount,
      paidDate: paid_date,
      method,
      recordedBy: req.user.id,
    });
    res.status(201).json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

// GET /api/institution-orders/unpaid-summary
async function unpaidSummary(req, res) {
  res.json(await getUnpaidSummary());
}

module.exports = { list, getOne, create, deliver, pay, unpaidSummary };
