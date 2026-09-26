const { handleServiceError } = require('../utils/handleServiceError');
const { can } = require('../middleware/rbac');
const { createOrder, markDelivered } = require('../models/institutionService');
const { SIDES } = require('../finance/sides');
const ledger = require('../finance/ledger');

const s = SIDES.customer;

// GET /api/institution-orders?institution_id=&delivery_status=&payment_status=&overdue=1
async function list(req, res) {
  const { institution_id, delivery_status, payment_status, overdue } = req.query;
  let rows = await ledger.listInvoices({ s, partyId: institution_id, status: payment_status, overdue: overdue === '1' || overdue === 'true' });
  if (delivery_status) rows = rows.filter((r) => r.delivery_status === delivery_status);
  res.json(rows);
}

// GET /api/institution-orders/:id - lines, balance breakdown, transactions and returns
async function getOne(req, res) {
  const detail = await ledger.invoiceDetail({ s, invoiceId: req.params.id });
  if (!detail) return res.status(404).json({ error: 'Order not found' });
  res.json(detail);
}

// POST /api/institution-orders
// { institution_id, order_date, delivery_date, due_date, discount_amount, notes,
//   items: [{ product_id, quantity, unit_price }],
//   payment: { amount, method, reference_no } }   <- optional, paid at the sale
async function create(req, res) {
  const { institution_id, order_date, delivery_date, due_date, discount_amount, notes, items, payment } = req.body;
  if (!institution_id || !order_date || !items || !items.length) {
    return res.status(400).json({ error: 'institution_id, order_date and at least one item are required' });
  }
  if (payment && Number(payment.amount) > 0 && !can(req, 'institution_payments.manage')) {
    return res.status(403).json({ error: 'You do not have permission to record customer payments', required: ['institution_payments.manage'] });
  }
  try {
    const order = await createOrder({
      req, institutionId: institution_id, orderDate: order_date, deliveryDate: delivery_date, dueDate: due_date,
      discountAmount: discount_amount, notes, items, payment,
    });
    res.status(201).json(order);
  } catch (err) {
    handleServiceError(err, res);
  }
}

// POST /api/institution-orders/:id/deliver
async function deliver(req, res) {
  try {
    res.json(await markDelivered({ orderId: req.params.id, performedBy: req.user.id }));
  } catch (err) {
    handleServiceError(err, res);
  }
}

// GET /api/institution-orders/unpaid-summary - customers who owe us (or hold credit)
async function unpaidSummary(req, res) {
  res.json((await ledger.balancesByParty({ s })).map((r) => ({ ...r, institution_id: r.party_id, institution_name: r.party_name })));
}

module.exports = { list, getOne, create, deliver, unpaidSummary };
