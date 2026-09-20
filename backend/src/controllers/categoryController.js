const db = require('../config/db');

async function list(req, res) {
  const categories = await db('categories').select('*').orderBy('name');
  res.json(categories);
}

async function create(req, res) {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });

  const existing = await db('categories').where({ name }).first();
  if (existing) return res.status(409).json({ error: 'A category with this name already exists' });

  const [category] = await db('categories').insert({ name }).returning('*');
  res.status(201).json(category);
}

async function update(req, res) {
  const { id } = req.params;
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });

  const [category] = await db('categories').where({ id }).update({ name }).returning('*');
  if (!category) return res.status(404).json({ error: 'Category not found' });
  res.json(category);
}

async function remove(req, res) {
  const { id } = req.params;
  const inUse = await db('products').where({ category_id: id }).first();
  if (inUse) {
    return res.status(409).json({ error: 'Cannot delete a category that still has products assigned to it' });
  }
  const deleted = await db('categories').where({ id }).del();
  if (!deleted) return res.status(404).json({ error: 'Category not found' });
  res.status(204).send();
}

module.exports = { list, create, update, remove };
