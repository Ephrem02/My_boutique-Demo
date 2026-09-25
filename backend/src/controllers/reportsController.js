const db = require('../config/db');

function applyDateRange(query, column, from, to) {
  if (from) query.where(column, '>=', from);
  if (to) query.where(column, '<=', `${to} 23:59:59`);
  return query;
}

// GET /api/reports/sales-summary?from=&to=
async function salesSummary(req, res) {
  const { from, to } = req.query;

  const totals = await applyDateRange(
    db('sales').where('status', 'completed'),
    'created_at',
    from,
    to
  )
    .select(db.raw('COUNT(*) as sale_count'), db.raw('COALESCE(SUM(total_amount), 0) as revenue'))
    .first();

  const byPaymentMethod = await applyDateRange(
    db('sales').where('status', 'completed'),
    'created_at',
    from,
    to
  )
    .select('payment_method')
    .select(db.raw('COUNT(*) as sale_count'), db.raw('COALESCE(SUM(total_amount), 0) as revenue'))
    .groupBy('payment_method')
    .orderBy('revenue', 'desc');

  const byDay = await applyDateRange(
    db('sales').where('status', 'completed'),
    'created_at',
    from,
    to
  )
    .select(db.raw("DATE(created_at) as day"))
    .select(db.raw('COUNT(*) as sale_count'), db.raw('COALESCE(SUM(total_amount), 0) as revenue'))
    .groupBy(db.raw('DATE(created_at)'))
    .orderBy('day', 'asc');

  const voidedCount = await applyDateRange(
    db('sales').where('status', 'voided'),
    'created_at',
    from,
    to
  )
    .count('* as count')
    .first();

  res.json({
    sale_count: Number(totals.sale_count),
    revenue: Number(totals.revenue),
    voided_count: Number(voidedCount.count),
    by_payment_method: byPaymentMethod.map((r) => ({ ...r, sale_count: Number(r.sale_count), revenue: Number(r.revenue) })),
    by_day: byDay.map((r) => ({ ...r, sale_count: Number(r.sale_count), revenue: Number(r.revenue) })),
  });
}

// GET /api/reports/top-products?from=&to=&limit=
async function topProducts(req, res) {
  const { from, to, limit } = req.query;

  const query = db('sale_items')
    .join('sales', 'sales.id', 'sale_items.sale_id')
    .join('products', 'products.id', 'sale_items.product_id')
    .where('sales.status', 'completed')
    .select('products.id as product_id', 'products.name', 'products.sku')
    .select(
      db.raw('SUM(sale_items.quantity) as quantity_sold'),
      db.raw('SUM(sale_items.quantity * sale_items.unit_price) as revenue')
    )
    .groupBy('products.id', 'products.name', 'products.sku')
    .orderBy('revenue', 'desc')
    .limit(limit ? Number(limit) : 10);

  applyDateRange(query, 'sales.created_at', from, to);

  const rows = await query;
  res.json(rows.map((r) => ({ ...r, quantity_sold: Number(r.quantity_sold), revenue: Number(r.revenue) })));
}

// GET /api/reports/shrinkage?from=&to=
async function shrinkage(req, res) {
  const { from, to } = req.query;

  const query = db('shrinkage_records')
    .join('products', 'products.id', 'shrinkage_records.product_id')
    .select('shrinkage_records.cause')
    .select(
      db.raw('SUM(shrinkage_records.quantity) as quantity'),
      db.raw('SUM(shrinkage_records.quantity * products.cost_price) as value')
    )
    .groupBy('shrinkage_records.cause')
    .orderBy('value', 'desc');

  if (from) query.where('shrinkage_records.recorded_date', '>=', from);
  if (to) query.where('shrinkage_records.recorded_date', '<=', to);

  const byCause = await query;

  const totals = byCause.reduce(
    (acc, r) => ({
      quantity: acc.quantity + Number(r.quantity),
      value: acc.value + Number(r.value),
    }),
    { quantity: 0, value: 0 }
  );

  res.json({
    ...totals,
    by_cause: byCause.map((r) => ({ ...r, quantity: Number(r.quantity), value: Number(r.value) })),
  });
}

// GET /api/reports/financial-summary?from=&to=
async function financialSummary(req, res) {
  const { from, to } = req.query;

  const revenueRow = await applyDateRange(
    db('sales').where('status', 'completed'),
    'created_at',
    from,
    to
  )
    .select(db.raw('COALESCE(SUM(total_amount), 0) as revenue'))
    .first();

  const cogsQuery = db('sale_items')
    .join('sales', 'sales.id', 'sale_items.sale_id')
    .join('products', 'products.id', 'sale_items.product_id')
    .where('sales.status', 'completed')
    .select(db.raw('COALESCE(SUM(sale_items.quantity * products.cost_price), 0) as cogs'));
  applyDateRange(cogsQuery, 'sales.created_at', from, to);
  const cogsRow = await cogsQuery.first();

  // Institution orders are a second revenue stream (bulk/credit sales), tracked
  // separately from walk-in POS sales but still real revenue for this report.
  const institutionRevenueQuery = db('institution_orders').select(
    db.raw('COALESCE(SUM(total_amount), 0) as revenue')
  );
  if (from) institutionRevenueQuery.where('order_date', '>=', from);
  if (to) institutionRevenueQuery.where('order_date', '<=', to);
  const institutionRevenueRow = await institutionRevenueQuery.first();

  const institutionCogsQuery = db('institution_order_items')
    .join('institution_orders', 'institution_orders.id', 'institution_order_items.order_id')
    .join('products', 'products.id', 'institution_order_items.product_id')
    .select(db.raw('COALESCE(SUM(institution_order_items.quantity * products.cost_price), 0) as cogs'));
  if (from) institutionCogsQuery.where('institution_orders.order_date', '>=', from);
  if (to) institutionCogsQuery.where('institution_orders.order_date', '<=', to);
  const institutionCogsRow = await institutionCogsQuery.first();

  const shrinkageQuery = db('shrinkage_records')
    .join('products', 'products.id', 'shrinkage_records.product_id')
    .select(db.raw('COALESCE(SUM(shrinkage_records.quantity * products.cost_price), 0) as shrinkage_value'));
  if (from) shrinkageQuery.where('shrinkage_records.recorded_date', '>=', from);
  if (to) shrinkageQuery.where('shrinkage_records.recorded_date', '<=', to);
  const shrinkageRow = await shrinkageQuery.first();

  const supplierPayables = await db('supplier_deliveries')
    .whereIn('status', ['unpaid', 'partial'])
    .select(db.raw('COALESCE(SUM(total_amount - amount_paid), 0) as amount'))
    .first();

  const institutionReceivables = await db('institution_orders')
    .whereIn('payment_status', ['unpaid', 'partial'])
    .select(db.raw('COALESCE(SUM(total_amount - amount_paid), 0) as amount'))
    .first();

  const posRevenue = Number(revenueRow.revenue);
  const posCogs = Number(cogsRow.cogs);
  const institutionRevenue = Number(institutionRevenueRow.revenue);
  const institutionCogs = Number(institutionCogsRow.cogs);

  const revenue = posRevenue + institutionRevenue;
  const cogs = posCogs + institutionCogs;
  const shrinkageValue = Number(shrinkageRow.shrinkage_value);
  const grossProfit = revenue - cogs;

  res.json({
    revenue,
    pos_revenue: posRevenue,
    institution_revenue: institutionRevenue,
    cogs,
    gross_profit: grossProfit,
    shrinkage_value: shrinkageValue,
    net_profit: grossProfit - shrinkageValue,
    supplier_payables_outstanding: Number(supplierPayables.amount),
    institution_receivables_outstanding: Number(institutionReceivables.amount),
  });
}

// GET /api/reports/my-summary?from=&to=
// For anyone who sells (cashiers included): figures for their *own* sales,
// plus shop-wide stock counts that carry no financial data. No other
// cashier's figures and no revenue/cost for the shop as a whole.
async function mySummary(req, res) {
  const { from, to } = req.query;
  const own = () => applyDateRange(db('sales').where('cashier_id', req.user.id), 'created_at', from, to);

  const totals = await own()
    .where('status', 'completed')
    .select(db.raw('COUNT(*) as sale_count'), db.raw('COALESCE(SUM(total_amount), 0) as revenue'))
    .first();
  const voided = await own().where('status', 'voided').count('* as count').first();
  const byPaymentMethod = await own()
    .where('status', 'completed')
    .select('payment_method', db.raw('COUNT(*) as sale_count'), db.raw('COALESCE(SUM(total_amount), 0) as revenue'))
    .groupBy('payment_method')
    .orderBy('revenue', 'desc');

  const stock = await db('products')
    .leftJoin('stock_levels', 'stock_levels.product_id', 'products.id')
    .where('products.is_active', true)
    .groupBy('products.id', 'products.reorder_level')
    .select('products.reorder_level', db.raw('COALESCE(SUM(stock_levels.quantity), 0)::int as total'));

  res.json({
    my_sale_count: Number(totals.sale_count),
    my_revenue: Number(totals.revenue),
    my_voided_count: Number(voided.count),
    my_by_payment_method: byPaymentMethod.map((r) => ({ ...r, sale_count: Number(r.sale_count), revenue: Number(r.revenue) })),
    shop_active_products: stock.length,
    shop_low_stock_count: stock.filter((p) => p.total > 0 && p.total <= p.reorder_level).length,
    shop_out_of_stock_count: stock.filter((p) => p.total === 0).length,
  });
}

module.exports = { salesSummary, topProducts, shrinkage, financialSummary, mySummary };
