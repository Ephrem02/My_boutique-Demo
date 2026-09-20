const db = require('../config/db');
const { createSale, voidSale } = require('../models/salesService');

// GET /api/sales?cashier_id=&status=&from=&to=
async function list(req, res) {
  const { cashier_id, status, from, to } = req.query;
  const query = db('sales')
    .select('sales.*', 'users.full_name as cashier_name')
    .join('users', 'users.id', 'sales.cashier_id')
    .orderBy('sales.created_at', 'desc');

  if (cashier_id) query.where('sales.cashier_id', cashier_id);
  if (status) query.where('sales.status', status);
  if (from) query.where('sales.created_at', '>=', from);
  if (to) query.where('sales.created_at', '<=', to);

  res.json(await query);
}

// GET /api/sales/:id
async function getOne(req, res) {
  const { id } = req.params;
  const sale = await db('sales')
    .select('sales.*', 'users.full_name as cashier_name')
    .join('users', 'users.id', 'sales.cashier_id')
    .where('sales.id', id)
    .first();
  if (!sale) return res.status(404).json({ error: 'Sale not found' });

  const items = await db('sale_items')
    .select('sale_items.*', 'products.name as product_name', 'products.sku')
    .join('products', 'products.id', 'sale_items.product_id')
    .where('sale_id', id);

  res.json({ ...sale, items });
}

// POST /api/sales { payment_method, items: [{product_id, quantity, unit_price, location_id?}] }
async function create(req, res) {
  const { payment_method, items } = req.body;
  if (!payment_method || !items || !items.length) {
    return res.status(400).json({ error: 'payment_method and at least one item are required' });
  }
  try {
    const sale = await createSale({
      cashierId: req.user.id,
      items,
      paymentMethod: payment_method,
    });
    res.status(201).json(sale);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

// POST /api/sales/:id/void
async function voidOne(req, res) {
  const { id } = req.params;
  try {
    const sale = await voidSale({ saleId: id, voidedBy: req.user.id });
    res.json(sale);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

module.exports = { list, getOne, create, voidOne };
