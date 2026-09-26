const db = require('../config/db');
const { handleServiceError } = require('../utils/handleServiceError');
const { createSale, voidSale, returnedQuantities } = require('../models/salesService');
const { can } = require('../middleware/rbac');
const { audit } = require('../audit/auditService');
const { AppError } = require('../utils/AppError');
const { createOrder } = require('../models/institutionService');

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
    .select('sales.*', 'users.full_name as cashier_name', 'institutions.name as customer_name')
    .join('users', 'users.id', 'sales.cashier_id')
    .leftJoin('institutions', 'institutions.id', 'sales.institution_id')
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

// POST /api/sales { payment_method, customer_id?, items: [{product_id, quantity, location_id?}],
//                   payment?: { amount, method, reference_no } }
// payment_method 'account' sells on the customer's account: it becomes a
// customer invoice (at current selling prices, from the front shelf) with an
// optional part payment - the rest is owed on the customer's ledger.
async function create(req, res) {
  const { payment_method, items, customer_id, payment } = req.body;
  if (!payment_method || !items || !items.length) {
    return res.status(400).json({ error: 'payment_method and at least one item are required' });
  }
  try {
    if (payment_method === 'account') {
      if (!customer_id) return res.status(422).json({ error: 'Choose the customer to sell on account to' });
      if (!can(req, 'institution_orders.manage')) {
        return res.status(403).json({ error: 'You do not have permission to sell on account', required: ['institution_orders.manage'] });
      }
      if (payment && Number(payment.amount) > 0 && !can(req, 'institution_payments.manage')) {
        return res.status(403).json({ error: 'You do not have permission to record customer payments', required: ['institution_payments.manage'] });
      }
      // Same rule as the till: no sales without an OPEN business day
      await db.transaction((trx) => require('../businessDay/businessDayService').requireOpenDay(trx));
      const products = await db('products').whereIn('id', items.map((i) => Number(i.product_id) || 0));
      const priced = items.map((i) => {
        const product = products.find((p) => p.id === Number(i.product_id));
        if (!product || !product.is_active) throw new AppError(`Unknown product_id: ${i.product_id}`, 422);
        return { product_id: product.id, quantity: i.quantity, unit_price: Number(product.selling_price) };
      });
      const shopDate = require('../businessDay/settings').shopDate(await require('../businessDay/settings').getClosingSettings());
      const invoice = await createOrder({
        req, institutionId: customer_id, orderDate: shopDate, items: priced, payment, fromLocation: 'front_shelf', notes: 'Sold at the till on account',
      });
      return res.status(201).json({ kind: 'invoice', ...invoice });
    }
    const sale = await createSale({
      cashierId: req.user.id,
      items,
      paymentMethod: payment_method,
      customerId: customer_id || null,
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
