const db = require('../config/db');
const { SIDES } = require('../finance/sides');
const ledger = require('../finance/ledger');

async function list(req, res) {
  const { type } = req.query;
  const query = db('institutions').select('*').orderBy('name');
  if (type) query.where({ type });
  res.json(await query);
}

async function getOne(req, res) {
  const { id } = req.params;
  const institution = await db('institutions').where({ id }).first();
  if (!institution) return res.status(404).json({ error: 'Institution not found' });

  const orders = await ledger.listInvoices({ s: SIDES.customer, partyId: institution.id });
  res.json({ ...institution, orders });
}

async function create(req, res) {
  const { name, type, contact_person, contact_phone, address, payment_terms } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });

  const [institution] = await db('institutions')
    .insert({ name, type: type || 'other', contact_person, contact_phone, address, payment_terms })
    .returning('*');
  res.status(201).json(institution);
}

async function update(req, res) {
  const { id } = req.params;
  const { name, type, contact_person, contact_phone, address, payment_terms } = req.body;

  const [institution] = await db('institutions')
    .where({ id })
    .update({ name, type, contact_person, contact_phone, address, payment_terms })
    .returning('*');
  if (!institution) return res.status(404).json({ error: 'Institution not found' });
  res.json(institution);
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

module.exports = { list, getOne, create, update, remove };
