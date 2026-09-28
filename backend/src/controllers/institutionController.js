const db = require('../config/db');
const { SIDES } = require('../finance/sides');
const ledger = require('../finance/ledger');
const parties = require('../finance/parties');
const { handleServiceError } = require('../utils/handleServiceError');

async function list(req, res) {
  const { type, status } = req.query;
  const query = db('institutions').select('*').orderBy('name');
  if (type) query.where({ type });
  if (status) query.where({ status });
  res.json(await query);
}

async function getOne(req, res) {
  const { id } = req.params;
  const institution = await db('institutions').where({ id }).first();
  if (!institution) return res.status(404).json({ error: 'Institution not found' });

  const orders = await ledger.listInvoices({ s: SIDES.customer, partyId: institution.id });
  // Paid till sales where the cashier named this customer (their purchase history)
  const tillSales = await db('sales')
    .where({ institution_id: institution.id })
    .join('users', 'users.id', 'sales.cashier_id')
    .select('sales.id', 'sales.created_at', 'sales.total_amount', 'sales.payment_method', 'sales.status', 'users.full_name as cashier_name')
    .orderBy('sales.id', 'desc')
    .limit(100);
  res.json({ ...(await parties.withAssignee(institution)), orders, till_sales: tillSales.map((s) => ({ ...s, total_amount: Number(s.total_amount) })) });
}

async function create(req, res) {
  try {
    res.status(201).json(await parties.createParty({ req, side: 'customer', body: req.body }));
  } catch (err) {
    handleServiceError(err, res);
  }
}

async function update(req, res) {
  try {
    res.json(await parties.updateParty({ req, side: 'customer', id: req.params.id, body: req.body }));
  } catch (err) {
    handleServiceError(err, res);
  }
}

async function remove(req, res) {
  const { id } = req.params;
  const hasOrders = await db('institution_orders').where({ institution_id: id }).first();
  if (hasOrders) {
    return res.status(409).json({ error: 'Cannot delete an institution with recorded orders; this preserves payment history' });
  }
  const deleted = await db('institutions').where({ id }).del();
  if (!deleted) return res.status(404).json({ error: 'Institution not found' });
  res.status(204).send();
}

async function updateCredit(req, res) {
  try {
    res.json(await require('../finance/credit').setCredit({ req, institutionId: req.params.id, body: req.body }));
  } catch (err) {
    handleServiceError(err, res);
  }
}

module.exports = { list, getOne, create, update, updateCredit, remove };
