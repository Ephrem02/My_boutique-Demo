const db = require('../config/db');
const { SIDES } = require('../finance/sides');
const ledger = require('../finance/ledger');

async function list(req, res) {
  const suppliers = await db('suppliers').select('*').orderBy('name');
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
  const { name, contact_phone, contact_email, address, payment_terms } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });

  const [supplier] = await db('suppliers')
    .insert({ name, contact_phone, contact_email, address, payment_terms })
    .returning('*');
  res.status(201).json(supplier);
}

async function update(req, res) {
  const { id } = req.params;
  const { name, contact_phone, contact_email, address, payment_terms } = req.body;

  const [supplier] = await db('suppliers')
    .where({ id })
    .update({ name, contact_phone, contact_email, address, payment_terms })
    .returning('*');
  if (!supplier) return res.status(404).json({ error: 'Supplier not found' });
  res.json(supplier);
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
