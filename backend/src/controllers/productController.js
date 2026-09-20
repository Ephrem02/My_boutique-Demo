const db = require('../config/db');

// GET /api/products?search=&category_id=&low_stock=true&include_inactive=true
async function list(req, res) {
  const { search, category_id, low_stock, include_inactive } = req.query;

  const query = db('products')
    .select(
      'products.*', 'categories.name as category_name',
      db.raw('COALESCE(SUM(stock_levels.quantity), 0) as total_quantity')
    )
    .leftJoin('categories', 'categories.id', 'products.category_id')
    .leftJoin('stock_levels', 'stock_levels.product_id', 'products.id')
    .groupBy('products.id', 'categories.name')
    .orderBy('products.name');

  // Only a manager needs to see deactivated products (e.g. to reactivate one)
  if (!(include_inactive === 'true' && req.user.permissions.includes('products.manage'))) {
    query.where('products.is_active', true);
  }

  if (search) {
    query.andWhere((qb) => {
      qb.whereILike('products.name', `%${search}%`).orWhereILike('products.sku', `%${search}%`);
    });
  }
  if (category_id) query.andWhere('products.category_id', category_id);

  let products = await query;

  if (low_stock === 'true') {
    products = products.filter((p) => Number(p.total_quantity) <= p.reorder_level);
  }

  res.json(products);
}

// GET /api/products/:id - includes per-location breakdown
async function getOne(req, res) {
  const { id } = req.params;
  const product = await db('products')
    .select('products.*', 'categories.name as category_name')
    .leftJoin('categories', 'categories.id', 'products.category_id')
    .where('products.id', id)
    .first();

  if (!product) return res.status(404).json({ error: 'Product not found' });

  const stockByLocation = await db('stock_levels')
    .select('stock_locations.name as location', 'stock_levels.quantity')
    .join('stock_locations', 'stock_locations.id', 'stock_levels.location_id')
    .where('stock_levels.product_id', id);

  res.json({ ...product, stock_by_location: stockByLocation });
}

// POST /api/products
async function create(req, res) {
  const { sku, name, category_id, unit, cost_price, selling_price, reorder_level, image_url } = req.body;
  if (!sku || !name) return res.status(400).json({ error: 'sku and name are required' });

  const existing = await db('products').where({ sku }).first();
  if (existing) return res.status(409).json({ error: 'A product with this SKU already exists' });

  const [product] = await db('products')
    .insert({
      sku,
      name,
      category_id: category_id || null,
      unit: unit || 'pcs',
      cost_price: cost_price || 0,
      selling_price: selling_price || 0,
      reorder_level: reorder_level || 0,
      image_url: image_url || null,
    })
    .returning('*');

  res.status(201).json(product);
}

// PUT /api/products/:id
// Only users with 'pricing.manage' may change selling_price - store keepers can
// update everything else (name, category, reorder level, cost price) but not
// the customer-facing price.
async function update(req, res) {
  const { id } = req.params;
  const updates = { ...req.body };
  delete updates.id;
  delete updates.sku; // SKU is immutable once created to avoid breaking historical references

  const current = await db('products').where({ id }).first();
  if (!current) return res.status(404).json({ error: 'Product not found' });

  if (
    updates.selling_price !== undefined &&
    Number(updates.selling_price) !== Number(current.selling_price) &&
    !req.user.permissions.includes('pricing.manage')
  ) {
    return res.status(403).json({ error: 'Only a store manager can change selling price' });
  }

  const [product] = await db('products').where({ id }).update(updates).returning('*');
  res.json(product);
}

// DELETE /api/products/:id - soft delete, preserves history in movements/sales
async function remove(req, res) {
  const { id } = req.params;
  const [product] = await db('products').where({ id }).update({ is_active: false }).returning('*');
  if (!product) return res.status(404).json({ error: 'Product not found' });
  res.status(204).send();
}

module.exports = { list, getOne, create, update, remove };
