// Business-day figures. The same builder produces today's live board and the
// frozen closing snapshot, so the two always mean the same thing.
//
// Everything is scoped by business_day_id (never by timestamp ranges), so a
// sale belongs to exactly the day it was rung up in.
//
// `per_cashier` is management-only data; presenters strip it for anyone
// without day.history.view.

const PAYMENT_METHODS = ['cash', 'mtn_mobile_money', 'airtel_money', 'card'];
const n = (v) => Math.round(Number(v || 0) * 100) / 100;

async function userNames(trx, ids) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return new Map();
  const rows = await trx('users').whereIn('id', unique).select('id', 'full_name');
  return new Map(rows.map((r) => [r.id, r.full_name]));
}

async function buildFigures(trx, day, settings) {
  const dayId = day.id;

  const sales = await trx('sales')
    .where({ business_day_id: dayId })
    .select('status', 'payment_method')
    .count('* as count')
    .sum('total_amount as total')
    .groupBy('status', 'payment_method');

  const byMethod = Object.fromEntries(PAYMENT_METHODS.map((m) => [m, 0]));
  let gross = 0;
  let transactions = 0;
  let voidCount = 0;
  let voidTotal = 0;
  for (const r of sales) {
    if (r.status === 'completed') {
      byMethod[r.payment_method] = n((byMethod[r.payment_method] || 0) + n(r.total));
      gross += n(r.total);
      transactions += Number(r.count);
    } else {
      voidCount += Number(r.count);
      voidTotal += n(r.total);
    }
  }

  const refundRows = await trx('returns')
    .where({ business_day_id: dayId })
    .select('refund_method')
    .count('* as count')
    .sum('refund_amount as total')
    .groupBy('refund_method');
  const refundsByMethod = Object.fromEntries(PAYMENT_METHODS.map((m) => [m, 0]));
  let refundsTotal = 0;
  let refundCount = 0;
  for (const r of refundRows) {
    refundsByMethod[r.refund_method] = n((refundsByMethod[r.refund_method] || 0) + n(r.total));
    refundsTotal += n(r.total);
    refundCount += Number(r.count);
  }

  const openingFloat = n(day.opening_float);
  const cashSales = n(byMethod.cash);
  const cashRefunds = n(refundsByMethod.cash);
  const expectedCash = n(openingFloat + cashSales - cashRefunds);

  // Per-cashier (management only)
  const perCashierSales = await trx('sales')
    .where({ business_day_id: dayId })
    .select('cashier_id', 'status')
    .count('* as count')
    .sum('total_amount as total')
    .groupBy('cashier_id', 'status');
  const perCashierRefunds = await trx('returns')
    .where({ business_day_id: dayId })
    .select('processed_by')
    .count('* as count')
    .sum('refund_amount as total')
    .groupBy('processed_by');

  const movements = await trx('stock_movements')
    .where({ business_day_id: dayId })
    .select('type', 'performed_by')
    .count('* as count')
    .sum('quantity as quantity')
    .groupBy('type', 'performed_by');

  const workerIds = [
    day.opened_by, day.closing_started_by,
    ...perCashierSales.map((r) => r.cashier_id),
    ...perCashierRefunds.map((r) => r.processed_by),
    ...movements.map((r) => r.performed_by),
  ];
  const names = await userNames(trx, workerIds);

  const perCashier = {};
  for (const r of perCashierSales) {
    const row = perCashier[r.cashier_id] || { user_id: r.cashier_id, name: names.get(r.cashier_id), sales: 0, transactions: 0, voids: 0, refunds: 0 };
    if (r.status === 'completed') {
      row.sales = n(row.sales + n(r.total));
      row.transactions += Number(r.count);
    } else {
      row.voids += Number(r.count);
    }
    perCashier[r.cashier_id] = row;
  }
  for (const r of perCashierRefunds) {
    const row = perCashier[r.processed_by] || { user_id: r.processed_by, name: names.get(r.processed_by), sales: 0, transactions: 0, voids: 0, refunds: 0 };
    row.refunds = n(row.refunds + n(r.total));
    perCashier[r.processed_by] = row;
  }

  const movementsByType = {};
  for (const r of movements) {
    const row = movementsByType[r.type] || { count: 0, quantity: 0 };
    row.count += Number(r.count);
    row.quantity += Number(r.quantity);
    movementsByType[r.type] = row;
  }

  const stock = await trx('products')
    .leftJoin('stock_levels', 'stock_levels.product_id', 'products.id')
    .where('products.is_active', true)
    .groupBy('products.id')
    .select('products.id', 'products.name', 'products.sku', 'products.reorder_level',
      trx.raw('COALESCE(SUM(stock_levels.quantity), 0)::int as total'));
  const lowStock = stock.filter((p) => p.total > 0 && p.total <= p.reorder_level);
  const outOfStock = stock.filter((p) => p.total === 0);

  // Cumulative sales per 15-minute slot of shop-local clock time, for
  // "today at 14:30 vs yesterday at 14:30" comparisons.
  const slots = await trx('sales')
    .where({ business_day_id: dayId, status: 'completed' })
    .select(trx.raw(
      `to_char(date_trunc('hour', created_at AT TIME ZONE ?) + floor(extract(minute from created_at AT TIME ZONE ?) / 15) * interval '15 minutes', 'HH24:MI') as slot`,
      [settings.timezone, settings.timezone]
    ))
    .count('* as count')
    .sum('total_amount as total')
    .groupBy('slot')
    .orderBy('slot');
  let runningSales = 0;
  let runningCount = 0;
  const cumulative = slots.map((s) => {
    runningSales = n(runningSales + n(s.total));
    runningCount += Number(s.count);
    return { slot: s.slot, sales: runningSales, transactions: runningCount };
  });

  const workers = [...new Set(workerIds.filter(Boolean))]
    .map((id) => names.get(id))
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));

  return {
    business_date: typeof day.business_date === 'string' ? day.business_date.slice(0, 10) : day.business_date,
    sales: {
      gross: n(gross),
      refunds: n(refundsTotal),
      net: n(gross - refundsTotal),
      transactions,
      refund_count: refundCount,
      void_count: voidCount,
      void_total: n(voidTotal),
    },
    payment_methods: byMethod,
    refunds_by_method: refundsByMethod,
    cash: { opening_float: openingFloat, cash_sales: cashSales, cash_refunds: cashRefunds, expected_cash: expectedCash },
    inventory: {
      movements: movementsByType,
      low_stock_count: lowStock.length,
      out_of_stock_count: outOfStock.length,
      low_stock: lowStock.slice(0, 50),
      out_of_stock: outOfStock.slice(0, 50),
    },
    people: {
      opened_by: day.opened_by ? { id: day.opened_by, name: names.get(day.opened_by) || null, at: day.opened_at } : null,
      closing_requested_by: day.closing_started_by
        ? { id: day.closing_started_by, name: names.get(day.closing_started_by) || null, at: day.closing_started_at }
        : null,
      worked: workers,
    },
    cumulative,
    per_cashier: Object.values(perCashier).sort((a, b) => b.sales - a.sales),
  };
}

/**
 * Cumulative figures for all 15-minute slots that ended before `slotStart`
 * (HH:MM). Both days are cut at the same completed slot, so neither side
 * includes a partial quarter-hour the other doesn't.
 */
function atClockTime(cumulative, slotStart) {
  let last = { sales: 0, transactions: 0 };
  for (const point of cumulative || []) {
    if (point.slot < slotStart) last = point;
    else break;
  }
  return { sales: last.sales, transactions: last.transactions };
}

module.exports = { buildFigures, atClockTime, PAYMENT_METHODS };
