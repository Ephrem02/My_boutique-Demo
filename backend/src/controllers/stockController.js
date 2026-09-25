const db = require('../config/db');
const { handleServiceError } = require('../utils/handleServiceError');
const { applyMovement, transferStock, recordDamage } = require('../models/stockService');
const { audit } = require('../audit/auditService');

// GET /api/stock/locations
async function getLocations(req, res) {
  const locations = await db('stock_locations').select('*').orderBy('name');
  res.json(locations);
}

// GET /api/stock/levels - current quantity per product per location
async function getLevels(req, res) {
  const levels = await db('stock_levels')
    .select(
      'products.id as product_id', 'products.sku', 'products.name',
      'stock_locations.name as location', 'stock_levels.quantity'
    )
    .join('products', 'products.id', 'stock_levels.product_id')
    .join('stock_locations', 'stock_locations.id', 'stock_levels.location_id')
    .orderBy('products.name');
  res.json(levels);
}

// GET /api/stock/movements?product_id=&type=&from=&to=
async function getMovements(req, res) {
  const { product_id, type, from, to } = req.query;
  const query = db('stock_movements')
    .select(
      'stock_movements.*', 'products.sku', 'products.name as product_name',
      'stock_locations.name as location', 'users.full_name as performed_by_name'
    )
    .join('products', 'products.id', 'stock_movements.product_id')
    .join('stock_locations', 'stock_locations.id', 'stock_movements.location_id')
    .join('users', 'users.id', 'stock_movements.performed_by')
    .orderBy('stock_movements.created_at', 'desc');

  if (product_id) query.where('stock_movements.product_id', product_id);
  if (type) query.where('stock_movements.type', type);
  if (from) query.where('stock_movements.created_at', '>=', from);
  if (to) query.where('stock_movements.created_at', '<=', to);

  res.json(await query);
}

// POST /api/stock/intake { product_id, location_id, quantity, notes }
async function intake(req, res) {
  const { product_id, location_id, quantity, notes } = req.body;
  if (!product_id || !location_id || !quantity) {
    return res.status(400).json({ error: 'product_id, location_id and quantity are required' });
  }
  try {
    const movement = await applyMovement({
      productId: product_id,
      locationId: location_id,
      type: 'stock_in',
      quantity,
      notes,
      performedBy: req.user.id,
      referenceType: 'manual',
    });
    await audit(req, {
      action: 'stock.intake', entityType: 'product', entityId: product_id,
      newValues: { location_id, quantity: movement.quantity, notes }, metadata: { movement_id: movement.id },
    });
    res.status(201).json(movement);
  } catch (err) {
    handleServiceError(err, res);
  }
}

// POST /api/stock/transfer { product_id, from_location_id, to_location_id, quantity, notes }
async function transfer(req, res) {
  const { product_id, from_location_id, to_location_id, quantity, notes } = req.body;
  if (!product_id || !from_location_id || !to_location_id || !quantity) {
    return res.status(400).json({ error: 'product_id, from_location_id, to_location_id and quantity are required' });
  }
  try {
    await transferStock({
      productId: product_id,
      fromLocationId: from_location_id,
      toLocationId: to_location_id,
      quantity,
      performedBy: req.user.id,
      notes,
    });
    await audit(req, {
      action: 'stock.transfer', entityType: 'product', entityId: product_id,
      newValues: { from_location_id, to_location_id, quantity: Number(quantity), notes },
    });
    res.status(201).json({ message: 'Transfer recorded' });
  } catch (err) {
    handleServiceError(err, res);
  }
}

// POST /api/stock/damage { product_id, location_id, quantity, notes }
async function reportDamage(req, res) {
  const { product_id, location_id, quantity, notes } = req.body;
  if (!product_id || !location_id || !quantity) {
    return res.status(400).json({ error: 'product_id, location_id and quantity are required' });
  }
  try {
    // Movement + shrinkage record commit together (see recordDamage)
    const { movement, shrinkage } = await recordDamage({
      productId: product_id,
      locationId: location_id,
      quantity,
      notes,
      performedBy: req.user.id,
    });
    await audit(req, {
      action: 'stock.damage', entityType: 'product', entityId: product_id,
      newValues: { location_id, quantity: movement.quantity, notes }, metadata: { movement_id: movement.id, shrinkage_id: shrinkage.id },
    });
    res.status(201).json(movement);
  } catch (err) {
    handleServiceError(err, res);
  }
}

module.exports = { getLocations, getLevels, getMovements, intake, transfer, reportDamage };
