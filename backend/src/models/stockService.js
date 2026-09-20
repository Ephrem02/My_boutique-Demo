const db = require('../config/db');

const INCREASING_TYPES = ['stock_in', 'returned', 'transfer_in'];
const DECREASING_TYPES = ['sold', 'damaged', 'transfer_out'];

/**
 * Records a stock movement and updates the cached stock_levels total in one
 * transaction, so the audit trail (stock_movements) and the fast-read
 * snapshot (stock_levels) never drift apart.
 *
 * For 'adjustment', pass a signed delta via options.delta (can be negative).
 */
async function applyMovement({
  productId,
  locationId,
  type,
  quantity,
  referenceType = null,
  referenceId = null,
  notes = null,
  performedBy,
  delta = null,
}, trx = db) {
  if (quantity <= 0 && type !== 'adjustment') {
    throw new Error('quantity must be positive');
  }

  let signedChange;
  if (type === 'adjustment') {
    if (delta === null) throw new Error('adjustment requires a signed delta');
    signedChange = delta;
  } else if (INCREASING_TYPES.includes(type)) {
    signedChange = quantity;
  } else if (DECREASING_TYPES.includes(type)) {
    signedChange = -quantity;
  } else {
    throw new Error(`Unknown movement type: ${type}`);
  }

  return trx.transaction(async (t) => {
    const existing = await t('stock_levels')
      .where({ product_id: productId, location_id: locationId })
      .first();

    const currentQty = existing ? existing.quantity : 0;
    const newQty = currentQty + signedChange;

    if (newQty < 0) {
      throw new Error('Insufficient stock at this location for this operation');
    }

    if (existing) {
      await t('stock_levels').where({ product_id: productId, location_id: locationId }).update({ quantity: newQty });
    } else {
      await t('stock_levels').insert({ product_id: productId, location_id: locationId, quantity: newQty });
    }

    const [movement] = await t('stock_movements')
      .insert({
        product_id: productId,
        location_id: locationId,
        type,
        quantity: Math.abs(quantity || signedChange),
        reference_type: referenceType,
        reference_id: referenceId,
        notes,
        performed_by: performedBy,
      })
      .returning('*');

    return movement;
  });
}

/** Moves stock from one location to another (e.g. store room -> front shelf) as one atomic operation. */
async function transferStock({ productId, fromLocationId, toLocationId, quantity, performedBy, notes }) {
  return db.transaction(async (t) => {
    await applyMovement(
      { productId, locationId: fromLocationId, type: 'transfer_out', quantity, performedBy, notes, referenceType: 'transfer' },
      t
    );
    await applyMovement(
      { productId, locationId: toLocationId, type: 'transfer_in', quantity, performedBy, notes, referenceType: 'transfer' },
      t
    );
  });
}

module.exports = { applyMovement, transferStock };
