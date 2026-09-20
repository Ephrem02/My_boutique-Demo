const db = require('../config/db');
const { processReturn } = require('../models/salesService');

// GET /api/returns
async function list(req, res) {
  const returns = await db('returns')
    .select(
      'returns.*', 'sale_items.sale_id', 'products.name as product_name', 'products.sku',
      'users.full_name as processed_by_name'
    )
    .join('sale_items', 'sale_items.id', 'returns.sale_item_id')
    .join('products', 'products.id', 'sale_items.product_id')
    .join('users', 'users.id', 'returns.processed_by')
    .orderBy('returns.created_at', 'desc');
  res.json(returns);
}

// POST /api/returns { sale_item_id, quantity, reason, restocked }
async function create(req, res) {
  const { sale_item_id, quantity, reason, restocked } = req.body;
  if (!sale_item_id || !quantity) {
    return res.status(400).json({ error: 'sale_item_id and quantity are required' });
  }
  try {
    const returnRecord = await processReturn({
      saleItemId: sale_item_id,
      quantity,
      reason,
      restocked,
      processedBy: req.user.id,
    });
    res.status(201).json(returnRecord);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

module.exports = { list, create };
