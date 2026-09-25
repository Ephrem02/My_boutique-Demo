const db = require('../config/db');
const { handleServiceError } = require('../utils/handleServiceError');
const { createDelivery, recordPayment, getUnpaidSummary } = require('../models/supplierService');

// GET /api/supplier-deliveries?supplier_id=&status=
async function list(req, res) {
  const { supplier_id, status } = req.query;
  const query = db('supplier_deliveries')
    .select('supplier_deliveries.*', 'suppliers.name as supplier_name')
    .join('suppliers', 'suppliers.id', 'supplier_deliveries.supplier_id')
    .orderBy('supplier_deliveries.delivery_date', 'desc');

  if (supplier_id) query.where('supplier_deliveries.supplier_id', supplier_id);
  if (status) query.where('supplier_deliveries.status', status);

  res.json(await query);
}

// GET /api/supplier-deliveries/:id
async function getOne(req, res) {
  const { id } = req.params;
  const delivery = await db('supplier_deliveries')
    .select('supplier_deliveries.*', 'suppliers.name as supplier_name')
    .join('suppliers', 'suppliers.id', 'supplier_deliveries.supplier_id')
    .where('supplier_deliveries.id', id)
    .first();
  if (!delivery) return res.status(404).json({ error: 'Delivery not found' });

  const items = await db('supplier_delivery_items')
    .select('supplier_delivery_items.*', 'products.name as product_name', 'products.sku')
    .join('products', 'products.id', 'supplier_delivery_items.product_id')
    .where('delivery_id', id);

  const payments = await db('supplier_payments').where({ delivery_id: id }).orderBy('paid_date');

  res.json({ ...delivery, items, payments });
}

// POST /api/supplier-deliveries
// { supplier_id, delivery_date, payment_due_date, items: [{ product_id, quantity, unit_cost }] }
async function create(req, res) {
  const { supplier_id, delivery_date, payment_due_date, items } = req.body;
  if (!supplier_id || !delivery_date || !items || !items.length) {
    return res.status(400).json({ error: 'supplier_id, delivery_date and at least one item are required' });
  }
  try {
    const delivery = await createDelivery({
      supplierId: supplier_id,
      deliveryDate: delivery_date,
      paymentDueDate: payment_due_date,
      items,
      recordedBy: req.user.id,
    });
    res.status(201).json(delivery);
  } catch (err) {
    handleServiceError(err, res);
  }
}

// POST /api/supplier-deliveries/:id/payments
// { amount, paid_date, method }
async function pay(req, res) {
  const { id } = req.params;
  const { amount, paid_date, method } = req.body;
  if (!amount || !paid_date) {
    return res.status(400).json({ error: 'amount and paid_date are required' });
  }
  try {
    const result = await recordPayment({
      deliveryId: id,
      amount,
      paidDate: paid_date,
      method,
      recordedBy: req.user.id,
    });
    res.status(201).json(result);
  } catch (err) {
    handleServiceError(err, res);
  }
}

// GET /api/supplier-deliveries/unpaid-summary
async function unpaidSummary(req, res) {
  res.json(await getUnpaidSummary());
}

module.exports = { list, getOne, create, pay, unpaidSummary };
