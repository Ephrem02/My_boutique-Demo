const db = require('../config/db');
const { handleServiceError } = require('../utils/handleServiceError');
const { createSale, voidSale, returnedQuantities } = require('../models/salesService');
const { can } = require('../middleware/rbac');
const { audit } = require('../audit/auditService');

// Least privilege: without sales.view_all a user only ever sees sales they
// rang up themselves. Other sales are reported as "not found" (not 403) so
// ids can't be probed.
function ownSalesOnly(req) {
  return !can(req, 'sales.view_all');
}

// GET /api/sales?cashier_id=&status=&from=&to=
async function list(req, res) {
  const { cashier_id, status, from, to } = req.query;
  const query = db('sales')
    .select('sales.*', 'users.full_name as cashier_name')
    .join('users', 'users.id', 'sales.cashier_id')
    .orderBy('sales.created_at', 'desc');

  if (ownSalesOnly(req)) query.where('sales.cashier_id', req.user.id);
  else if (cashier_id) query.where('sales.cashier_id', cashier_id);
  if (status) query.where('sales.status', status);
  if (from) query.where('sales.created_at', '>=', from);
  if (to) query.where('sales.created_at', '<=', to);

  res.json(await query);
}

// GET /api/sales/:id
async function getOne(req, res) {
  const { id } = req.params;
  const query = db('sales')
    .select('sales.*', 'users.full_name as cashier_name')
    .join('users', 'users.id', 'sales.cashier_id')
    .where('sales.id', id);
  if (ownSalesOnly(req)) query.where('sales.cashier_id', req.user.id);
  const sale = await query.first();
  if (!sale) return res.status(404).json({ error: 'Sale not found' });

  const items = await db('sale_items')
    .select('sale_items.*', 'products.name as product_name', 'products.sku')
    .join('products', 'products.id', 'sale_items.product_id')
    .where('sale_id', id);
  const returned = await returnedQuantities(db, items.map((i) => i.id));

  res.json({ ...sale, items: items.map((i) => ({ ...i, returned_quantity: returned.get(i.id) || 0 })) });
}

// POST /api/sales { payment_method, items: [{product_id, quantity, location_id?}] }
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
    handleServiceError(err, res);
  }
}

// POST /api/sales/:id/void
async function voidOne(req, res) {
  const { id } = req.params;
  try {
    const { sale, before } = await voidSale({ saleId: id, voidedBy: req.user.id });
    await audit(req, {
      action: 'sale.void',
      entityType: 'sale',
      entityId: sale.id,
      oldValues: { status: before.status },
      newValues: { status: sale.status, total_amount: sale.total_amount, cashier_id: sale.cashier_id },
    });
    res.json(sale);
  } catch (err) {
    handleServiceError(err, res);
  }
}

module.exports = { list, getOne, create, voidOne, ownSalesOnly };
