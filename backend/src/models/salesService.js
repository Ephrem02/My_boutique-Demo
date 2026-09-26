const db = require('../config/db');
const { AppError } = require('../utils/AppError');
const { applyMovement, inLockOrder, toPositiveInt } = require('./stockService');
const { emit, emitIfOver, actorName, hourBucket } = require('../notifications/notificationService');
const { getRule } = require('../notifications/rules');

// Required lazily inside functions: businessDayService depends on the
// notification service, which is loaded after this module in some paths.
const businessDay = () => require('../businessDay/businessDayService');

// ---------- Sales ----------

const FRONT_SHELF_NAME = 'front_shelf';
// MTN and Airtel are reported separately. 'mobile_money'/'bank_transfer'
// exist only on sales recorded before this change and are no longer accepted.
const PAYMENT_METHODS = ['cash', 'mtn_mobile_money', 'airtel_money', 'card'];

/**
 * items: [{ product_id, quantity, location_id? }] - unit_price is never taken
 * from the caller; it's always looked up server-side from the product's
 * current selling_price, so a cashier can't sell at an arbitrary price by
 * tampering with the request. location_id defaults to the front shelf, since
 * that's where walk-in sales are made from.
 */
async function createSale({ cashierId, items, paymentMethod }) {
  if (!items || !items.length) throw new AppError('A sale needs at least one item');
  if (!PAYMENT_METHODS.includes(paymentMethod)) throw new AppError('Unknown payment method');

  const frontShelf = await db('stock_locations').where({ name: FRONT_SHELF_NAME }).first();

  return db.transaction(async (trx) => {
    // No sales without an OPEN business day (never auto-opened)
    const day = await businessDay().requireOpenDay(trx);
    const productIds = [...new Set(items.map((i) => i.product_id))];
    const products = await trx('products').whereIn('id', productIds);
    const productById = new Map(products.map((p) => [p.id, p]));

    const pricedItems = inLockOrder(items).map((item) => {
      const product = productById.get(item.product_id);
      if (!product || !product.is_active) throw new AppError(`Unknown product_id: ${item.product_id}`);
      return { ...item, quantity: toPositiveInt(item.quantity), unit_price: Number(product.selling_price) };
    });

    const totalAmount = pricedItems.reduce((sum, i) => sum + i.quantity * i.unit_price, 0);

    const [sale] = await trx('sales')
      .insert({
        cashier_id: cashierId,
        total_amount: totalAmount,
        payment_method: paymentMethod,
        status: 'completed',
        business_day_id: day.id,
      })
      .returning('*');

    const saleItems = [];
    for (const item of pricedItems) {
      const locationId = item.location_id || frontShelf.id;

      const [saleItem] = await trx('sale_items')
        .insert({
          sale_id: sale.id,
          product_id: item.product_id,
          quantity: item.quantity,
          unit_price: item.unit_price,
          location_id: locationId,
        })
        .returning('*');
      saleItems.push(saleItem);

      // This throws (and rolls back the whole sale) if stock is insufficient
      await applyMovement(
        {
          productId: item.product_id,
          locationId,
          type: 'sold',
          quantity: item.quantity,
          referenceType: 'sale',
          referenceId: sale.id,
          performedBy: cashierId,
        },
        trx
      );
    }

    await emitIfOver(trx, 'HIGH_VALUE_SALE', 'min_amount_rwf', totalAmount, {
      entityType: 'sale',
      entityId: sale.id,
      dedupKey: `HIGH_VALUE_SALE:sale:${sale.id}`,
      actorUserId: cashierId,
      params: {
        sale_id: sale.id,
        amount_rwf: totalAmount,
        cashier_name: await actorName(trx, cashierId),
        payment_method: paymentMethod.replace('_', ' '),
      },
    });

    return { ...sale, items: saleItems };
  });
}

/** Quantity already returned per sale_item id, for the given sale items. */
async function returnedQuantities(trx, saleItemIds) {
  if (!saleItemIds.length) return new Map();
  const rows = await trx('returns')
    .whereIn('sale_item_id', saleItemIds)
    .groupBy('sale_item_id')
    .select('sale_item_id', trx.raw('SUM(quantity)::int as returned'));
  return new Map(rows.map((r) => [r.sale_item_id, r.returned]));
}

/**
 * Voids a completed sale and restocks whatever is still out with the
 * customer. Items already returned were either restocked by the return or
 * written off as damaged - restocking them again would inflate stock.
 * The sale row is locked so a concurrent void/return can't interleave.
 */
async function voidSale({ saleId, voidedBy }) {
  return db.transaction(async (trx) => {
    const sale = await trx('sales').where({ id: saleId }).forUpdate().first();
    if (!sale) throw new AppError('Sale not found', 404);
    if (sale.status === 'voided') throw new AppError('This sale is already voided');
    // A void rewrites the day's figures, so it's only possible while the
    // sale's own business day is still OPEN. After that: refund or correction.
    const open = await businessDay().requireOpenDay(trx);
    if (sale.business_day_id !== open.id) {
      throw new AppError("This sale belongs to a closed business day and can't be voided - process a refund or request a correction instead", 409);
    }

    const items = inLockOrder(await trx('sale_items').where({ sale_id: saleId }));
    const returned = await returnedQuantities(trx, items.map((i) => i.id));
    for (const item of items) {
      const outstanding = item.quantity - (returned.get(item.id) || 0);
      if (outstanding <= 0) continue;
      await applyMovement(
        {
          productId: item.product_id,
          locationId: item.location_id,
          type: 'returned',
          quantity: outstanding,
          referenceType: 'sale_void',
          referenceId: sale.id,
          performedBy: voidedBy,
          notes: 'Sale voided',
        },
        trx
      );
    }

    const [updated] = await trx('sales').where({ id: sale.id }).update({ status: 'voided' }).returning('*');

    await emit(trx, {
      type: 'SALE_VOIDED',
      dedupKey: `SALE_VOIDED:sale:${sale.id}`,
      entityType: 'sale',
      entityId: sale.id,
      actorUserId: voidedBy,
      targetUserIds: [sale.cashier_id],
      params: {
        sale_id: sale.id,
        amount_rwf: Number(sale.total_amount),
        cashier_name: await actorName(trx, sale.cashier_id),
        actor_name: await actorName(trx, voidedBy),
      },
    });
    return { sale: updated, before: sale };
  });
}

// ---------- Returns ----------

/**
 * Processes a return for one sale item. If restocked=true, the quantity goes
 * back onto the shelf (customer changed their mind, item is resellable). If
 * false, it's a write-off (damaged/opened item) - stock stays deducted, no
 * shrinkage record is created since this is an expected retail cost, not a
 * loss to investigate.
 *
 * The total returned across *all* returns for the item can never exceed what
 * was sold, and voided sales can't be refunded (the void already restocked
 * everything). The sale and item rows are locked so two concurrent returns
 * can't both pass the check.
 *
 * restrictToCashierId: when set (callers without sales.view_all), the sale
 * must belong to that cashier - otherwise it's reported as not found.
 */
const RETURN_REASONS = ['defective', 'damaged', 'wrong_item', 'expired', 'poor_quality', 'changed_mind', 'other'];

async function processReturn({ saleItemId, quantity, reason, reasonCode = null, restocked, processedBy, restrictToCashierId = null }) {
  const qty = toPositiveInt(quantity);
  if (reasonCode !== null && reasonCode !== undefined && reasonCode !== '' && !RETURN_REASONS.includes(reasonCode)) {
    throw new AppError(`reason_code must be one of: ${RETURN_REASONS.join(', ')}`, 422);
  }
  return db.transaction(async (trx) => {
    // Refunds are today's transactions (even for an older sale) and need an OPEN day
    const day = await businessDay().requireOpenDay(trx);
    const itemRef = await trx('sale_items').where({ id: saleItemId }).first('sale_id');
    if (!itemRef) throw new AppError('Sale item not found', 404);
    const sale = await trx('sales').where({ id: itemRef.sale_id }).forUpdate().first();
    if (restrictToCashierId !== null && sale.cashier_id !== restrictToCashierId) {
      throw new AppError('Sale item not found', 404);
    }
    if (sale.status === 'voided') throw new AppError('This sale was voided - its items were already returned to stock');

    const saleItem = await trx('sale_items').where({ id: saleItemId }).forUpdate().first();
    const alreadyReturned = (await returnedQuantities(trx, [saleItem.id])).get(saleItem.id) || 0;
    if (alreadyReturned + qty > saleItem.quantity) {
      const remaining = saleItem.quantity - alreadyReturned;
      throw new AppError(
        remaining > 0
          ? `Only ${remaining} of this item can still be returned`
          : 'This item has already been fully returned'
      );
    }

    const [returnRecord] = await trx('returns')
      .insert({
        sale_item_id: saleItem.id,
        quantity: qty,
        reason,
        reason_code: reasonCode || null,
        restocked: !!restocked,
        processed_by: processedBy,
        business_day_id: day.id,
        // V1: refunds go back through the sale's own payment method
        refund_amount: qty * Number(saleItem.unit_price),
        refund_method: sale.payment_method,
      })
      .returning('*');

    if (restocked) {
      await applyMovement(
        {
          productId: saleItem.product_id,
          locationId: saleItem.location_id,
          type: 'returned',
          quantity: qty,
          referenceType: 'return',
          referenceId: returnRecord.id,
          performedBy: processedBy,
          notes: reason,
        },
        trx
      );
    }

    const product = await trx('products').where({ id: saleItem.product_id }).first('name');
    const processedByName = await actorName(trx, processedBy);
    await emitIfOver(trx, 'REFUND_PROCESSED', 'min_amount_rwf', qty * Number(saleItem.unit_price), {
      entityType: 'sale',
      entityId: sale.id,
      dedupKey: `REFUND_PROCESSED:return:${returnRecord.id}`,
      actorUserId: processedBy,
      params: {
        sale_id: sale.id,
        product_name: product.name,
        quantity: qty,
        amount_rwf: qty * Number(saleItem.unit_price),
        restocked: !!restocked,
        actor_name: processedByName,
      },
    });
    await checkRefundVelocity(trx, processedBy, processedByName);

    return returnRecord;
  });
}

/** SUSPICIOUS_ACTIVITY when one user processes many refunds within an hour. */
async function checkRefundVelocity(trx, userId, userName) {
  const rule = await getRule(trx, 'SUSPICIOUS_ACTIVITY');
  const limit = Number(rule.thresholds.refunds_per_hour);
  if (!limit) return;
  const { count } = await trx('returns')
    .where('processed_by', userId)
    .where('created_at', '>', trx.raw("now() - interval '60 minutes'"))
    .count('* as count')
    .first();
  if (Number(count) < limit) return;
  await emit(trx, {
    type: 'SUSPICIOUS_ACTIVITY',
    dedupKey: `SUSPICIOUS_ACTIVITY:refunds:user:${userId}:${hourBucket()}`,
    group: true,
    entityType: 'user',
    entityId: userId,
    actorUserId: userId,
    params: { user_name: userName, refund_count: Number(count), window_minutes: 60 },
  });
}

module.exports = { createSale, voidSale, processReturn, returnedQuantities, PAYMENT_METHODS };
