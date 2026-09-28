const db = require('../config/db');
const { SIDES } = require('../finance/sides');
const ledger = require('../finance/ledger');
const parties = require('../finance/parties');
const { handleServiceError } = require('../utils/handleServiceError');

async function list(req, res) {
  const query = db('suppliers').select('*').orderBy('name');
  if (req.query.status) query.where({ status: req.query.status });
  const suppliers = await query;
  res.json(suppliers);
}

async function getOne(req, res) {
  const { id } = req.params;
  const supplier = await db('suppliers').where({ id }).first();
  if (!supplier) return res.status(404).json({ error: 'Supplier not found' });

  const deliveries = await ledger.listInvoices({ s: SIDES.supplier, partyId: supplier.id });

  res.json({ ...supplier, deliveries });
}

async function create(req, res) {
  try {
    res.status(201).json(await parties.createParty({ req, side: 'supplier', body: req.body }));
  } catch (err) {
    handleServiceError(err, res);
  }
}

async function update(req, res) {
  try {
    res.json(await parties.updateParty({ req, side: 'supplier', id: req.params.id, body: req.body }));
  } catch (err) {
    handleServiceError(err, res);
  }
}

async function remove(req, res) {
  const { id } = req.params;
  const hasDeliveries = await db('supplier_deliveries').where({ supplier_id: id }).first();
  if (hasDeliveries) {
    return res.status(409).json({ error: 'Cannot delete a supplier with recorded deliveries; this preserves payment history' });
  }
  const deleted = await db('suppliers').where({ id }).del();
  if (!deleted) return res.status(404).json({ error: 'Supplier not found' });
  res.status(204).send();
}

module.exports = { list, getOne, create, update, remove };
