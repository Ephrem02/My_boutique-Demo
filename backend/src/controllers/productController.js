const db = require('../config/db');
const { can } = require('../middleware/rbac');
const { audit } = require('../audit/auditService');
const { emit } = require('../notifications/notificationService');
const { diffValues } = require('../utils/sanitize');

// Columns a client may ever write. Anything else in the body (id, sku,
// created_at, ...) is ignored rather than passed straight to the UPDATE.
const WRITABLE = ['name', 'category_id', 'unit', 'cost_price', 'selling_price', 'reorder_level', 'image_url', 'is_active'];

// Cost price is margin data - only people who manage products see it.
function present(req, product) {
  if (can(req, 'products.manage')) return product;
  const { cost_price, ...rest } = product;
  return rest;
}

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
  if (!(include_inactive === 'true' && can(req, 'products.manage'))) {
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

  res.json(products.map((p) => present(req, p)));
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

  res.json({ ...present(req, product), stock_by_location: stockByLocation });
}

function validateNumbers(values) {
  for (const key of ['cost_price', 'selling_price']) {
    if (values[key] !== undefined && (!Number.isFinite(Number(values[key])) || Number(values[key]) < 0)) {
      return `${key} must be a non-negative number`;
    }
  }
  if (values.reorder_level !== undefined && (!Number.isInteger(Number(values.reorder_level)) || Number(values.reorder_level) < 0)) {
    return 'reorder_level must be a non-negative whole number';
  }
  return null;
}

// POST /api/products
async function create(req, res) {
  const { sku, name, category_id, unit, cost_price, selling_price, reorder_level, image_url } = req.body;
  if (!sku || !name) return res.status(400).json({ error: 'sku and name are required' });
  const invalid = validateNumbers(req.body);
  if (invalid) return res.status(400).json({ error: invalid });

  const existing = await db('products').where({ sku }).first();
  if (existing) return res.status(409).json({ error: 'A product with this SKU already exists' });

  const product = await db.transaction(async (trx) => {
    const [created] = await trx('products')
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
    await audit(req, { action: 'product.create', entityType: 'product', entityId: created.id, newValues: created }, { trx });
    await emit(trx, {
      type: 'PRODUCT_CREATED',
      dedupKey: `PRODUCT_CREATED:product:${created.id}`,
      entityType: 'product',
      entityId: created.id,
      actorUserId: req.user.id,
      params: { product_name: created.name, sku: created.sku, actor_name: req.user.full_name },
    });
    return created;
  });

  res.status(201).json(present(req, product));
}

// PUT /api/products/:id
// Only users with 'pricing.manage' may change selling_price - store keepers can
// update everything else (name, category, reorder level, cost price) but not
// the customer-facing price.
async function update(req, res) {
  const { id } = req.params;
  const updates = {};
  for (const key of WRITABLE) {
    if (req.body[key] !== undefined) updates[key] = req.body[key];
  }
  if (updates.is_active !== undefined) updates.is_active = updates.is_active === true || updates.is_active === 'true';
  const invalid = validateNumbers(updates);
  if (invalid) return res.status(400).json({ error: invalid });
  if (!Object.keys(updates).length) return res.status(400).json({ error: 'No fields to update' });

  const current = await db('products').where({ id }).first();
  if (!current) return res.status(404).json({ error: 'Product not found' });

  if (
    updates.selling_price !== undefined &&
    Number(updates.selling_price) !== Number(current.selling_price) &&
    !can(req, 'pricing.manage')
  ) {
    return res.status(403).json({ error: 'Only a store manager can change selling price' });
  }

  const product = await db.transaction(async (trx) => {
    const [updated] = await trx('products').where({ id }).update({ ...updates, updated_at: trx.fn.now() }).returning('*');
    const { oldValues, newValues, changed } = diffValues(current, updates);
    if (changed) {
      await audit(req, {
        action: 'selling_price' in newValues ? 'product.price_change' : 'product.update',
        entityType: 'product',
        entityId: updated.id,
        oldValues,
        newValues,
      }, { trx });
    }
    if (Number(updated.selling_price) !== Number(current.selling_price)) {
      await emit(trx, {
        type: 'PRICE_CHANGED',
        dedupKey: `PRICE_CHANGED:product:${updated.id}:${Date.now()}`,
        entityType: 'product',
        entityId: updated.id,
        actorUserId: req.user.id,
        params: {
          product_name: updated.name,
          old_price_rwf: Number(current.selling_price),
          new_price_rwf: Number(updated.selling_price),
          actor_name: req.user.full_name,
        },
      });
    }
    if (current.is_active && !updated.is_active) await emitDeactivated(trx, req, updated);
    return updated;
  });
  res.json(present(req, product));
}

function emitDeactivated(trx, req, product) {
  return emit(trx, {
    type: 'PRODUCT_DEACTIVATED',
    dedupKey: `PRODUCT_DEACTIVATED:product:${product.id}:${Date.now()}`,
    entityType: 'product',
    entityId: product.id,
    actorUserId: req.user.id,
    params: { product_name: product.name, sku: product.sku, actor_name: req.user.full_name },
  });
}

// DELETE /api/products/:id - soft delete, preserves history in movements/sales
async function remove(req, res) {
  const { id } = req.params;
  const done = await db.transaction(async (trx) => {
    const current = await trx('products').where({ id }).first();
    if (!current) return false;
    if (!current.is_active) return true;
    const [product] = await trx('products').where({ id }).update({ is_active: false, updated_at: trx.fn.now() }).returning('*');
    await audit(req, {
      action: 'product.deactivate', entityType: 'product', entityId: product.id,
      oldValues: { is_active: true }, newValues: { is_active: false },
    }, { trx });
    await emitDeactivated(trx, req, product);
    return true;
  });
  if (!done) return res.status(404).json({ error: 'Product not found' });
  res.status(204).send();
}

module.exports = { list, getOne, create, update, remove };
