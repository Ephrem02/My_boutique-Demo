const db = require('../config/db');
const { handleServiceError } = require('../utils/handleServiceError');
const { processReturn } = require('../models/salesService');
const { ownSalesOnly } = require('./salesController');
const { audit } = require('../audit/auditService');

// GET /api/returns - users without sales.view_all only see returns on their
// own sales or returns they processed themselves.
async function list(req, res) {
  const query = db('returns')
    .select(
      'returns.*', 'sale_items.sale_id', 'products.name as product_name', 'products.sku',
      'users.full_name as processed_by_name'
    )
    .join('sale_items', 'sale_items.id', 'returns.sale_item_id')
    .join('sales', 'sales.id', 'sale_items.sale_id')
    .join('products', 'products.id', 'sale_items.product_id')
    .join('users', 'users.id', 'returns.processed_by')
    .orderBy('returns.created_at', 'desc');
  if (ownSalesOnly(req)) {
    query.where((qb) => qb.where('sales.cashier_id', req.user.id).orWhere('returns.processed_by', req.user.id));
  }
  res.json(await query);
}

// POST /api/returns { sale_item_id, quantity, reason, reason_code, restocked }
async function create(req, res) {
  const { sale_item_id, quantity, reason, reason_code, restocked } = req.body;
  if (!sale_item_id || !quantity) {
    return res.status(400).json({ error: 'sale_item_id and quantity are required' });
  }
  try {
    const returnRecord = await processReturn({
      saleItemId: sale_item_id,
      quantity,
      reason,
      reasonCode: reason_code,
      restocked,
      processedBy: req.user.id,
      restrictToCashierId: ownSalesOnly(req) ? req.user.id : null,
    });
    await audit(req, {
      action: 'sale.refund',
      entityType: 'return',
      entityId: returnRecord.id,
      newValues: { sale_item_id: returnRecord.sale_item_id, quantity: returnRecord.quantity, restocked: returnRecord.restocked, reason: returnRecord.reason, reason_code: returnRecord.reason_code },
    });
    res.status(201).json(returnRecord);
  } catch (err) {
    handleServiceError(err, res);
  }
}

module.exports = { list, create };
