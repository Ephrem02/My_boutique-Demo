const { handleServiceError } = require('../utils/handleServiceError');
const { can } = require('../middleware/rbac');
const { createDelivery } = require('../models/supplierService');
const { SIDES } = require('../finance/sides');
const ledger = require('../finance/ledger');

const s = SIDES.supplier;

// GET /api/supplier-deliveries?supplier_id=&status=&overdue=1
async function list(req, res) {
  const { supplier_id, status, overdue } = req.query;
  res.json(await ledger.listInvoices({ s, partyId: supplier_id, status, overdue: overdue === '1' || overdue === 'true' }));
}

// GET /api/supplier-deliveries/:id - lines, balance breakdown, transactions and returns
async function getOne(req, res) {
  const detail = await ledger.invoiceDetail({ s, invoiceId: req.params.id });
  if (!detail) return res.status(404).json({ error: 'Delivery not found' });
  res.json(detail);
}

// POST /api/supplier-deliveries
// { supplier_id, delivery_date, payment_due_date, reference_no, notes,
//   items: [{ product_id, quantity, unit_cost, batch_no, expiry_date }],
//   payment: { amount, method, reference_no } }   <- optional, paid on receipt
async function create(req, res) {
  const { supplier_id, delivery_date, payment_due_date, reference_no, notes, items, payment } = req.body;
  if (!supplier_id || !delivery_date || !items || !items.length) {
    return res.status(400).json({ error: 'supplier_id, delivery_date and at least one item are required' });
  }
  if (payment && Number(payment.amount) > 0 && !can(req, 'supplier_payments.manage')) {
    return res.status(403).json({ error: 'Only a store manager can record supplier payments', required: ['supplier_payments.manage'] });
  }
  try {
    const delivery = await createDelivery({
      req, supplierId: supplier_id, deliveryDate: delivery_date, paymentDueDate: payment_due_date, referenceNo: reference_no, notes, items, payment,
    });
    res.status(201).json(delivery);
  } catch (err) {
    handleServiceError(err, res);
  }
}

// GET /api/supplier-deliveries/unpaid-summary - suppliers we owe (or who owe us credit)
async function unpaidSummary(req, res) {
  res.json((await ledger.balancesByParty({ s })).map((r) => ({ ...r, supplier_id: r.party_id, supplier_name: r.party_name })));
}

module.exports = { list, getOne, create, unpaidSummary };
