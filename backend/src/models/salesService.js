const db = require('../config/db');
const { applyMovement } = require('./stockService');

// ---------- Sales ----------

const FRONT_SHELF_NAME = 'front_shelf';

/**
 * items: [{ product_id, quantity, unit_price, location_id? }]
 * location_id defaults to the front shelf, since that's where walk-in sales
 * are made from.
 */
async function createSale({ cashierId, items, paymentMethod }) {
  if (!items || !items.length) throw new Error('A sale needs at least one item');

  const frontShelf = await db('stock_locations').where({ name: FRONT_SHELF_NAME }).first();

  return db.transaction(async (trx) => {
    const totalAmount = items.reduce((sum, i) => sum + Number(i.quantity) * Number(i.unit_price), 0);

    const [sale] = await trx('sales')
      .insert({
        cashier_id: cashierId,
        total_amount: totalAmount,
        payment_method: paymentMethod,
        status: 'completed',
      })
      .returning('*');

    const saleItems = [];
    for (const item of items) {
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

    return { ...sale, items: saleItems };
  });
}

/** Voids a completed sale and restocks every item it contained. */
async function voidSale({ saleId, voidedBy }) {
  return db.transaction(async (trx) => {
    const sale = await trx('sales').where({ id: saleId }).first();
    if (!sale) throw new Error('Sale not found');
    if (sale.status === 'voided') throw new Error('This sale is already voided');

    const items = await trx('sale_items').where({ sale_id: saleId });
    for (const item of items) {
      await applyMovement(
        {
          productId: item.product_id,
          locationId: item.location_id,
          type: 'returned',
          quantity: item.quantity,
          referenceType: 'sale_void',
          referenceId: saleId,
          performedBy: voidedBy,
          notes: 'Sale voided',
        },
        trx
      );
    }

    const [updated] = await trx('sales').where({ id: saleId }).update({ status: 'voided' }).returning('*');
    return updated;
  });
}

// ---------- Returns ----------

/**
 * Processes a return for one sale item. If restocked=true, the quantity goes
 * back onto the shelf (customer changed their mind, item is resellable). If
 * false, it's a write-off (damaged/opened item) - stock stays deducted, no
 * shrinkage record is created since this is an expected retail cost, not a
 * loss to investigate.
 */
async function processReturn({ saleItemId, quantity, reason, restocked, processedBy }) {
  return db.transaction(async (trx) => {
    const saleItem = await trx('sale_items').where({ id: saleItemId }).first();
    if (!saleItem) throw new Error('Sale item not found');
    if (quantity > saleItem.quantity) throw new Error('Return quantity exceeds the quantity originally sold');

    const [returnRecord] = await trx('returns')
      .insert({
        sale_item_id: saleItemId,
        quantity,
        reason,
        restocked: !!restocked,
        processed_by: processedBy,
      })
      .returning('*');

    if (restocked) {
      await applyMovement(
        {
          productId: saleItem.product_id,
          locationId: saleItem.location_id,
          type: 'returned',
          quantity,
          referenceType: 'return',
          referenceId: returnRecord.id,
          performedBy: processedBy,
          notes: reason,
        },
        trx
      );
    }

    return returnRecord;
  });
}

module.exports = { createSale, voidSale, processReturn };
