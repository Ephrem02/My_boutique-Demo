const db = require('../config/db');
const { AppError } = require('../utils/AppError');

const INCREASING_TYPES = ['stock_in', 'returned', 'transfer_in'];
const DECREASING_TYPES = ['sold', 'damaged', 'transfer_out', 'returned_to_supplier'];

function toPositiveInt(value, field = 'quantity') {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new AppError(`${field} must be a positive whole number`);
  return n;
}

/**
 * Locks the stock_levels row for (product, location) for the rest of the
 * transaction, creating it at zero first if needed. Without the lock two
 * concurrent sales could both read the same quantity and one decrement would
 * be lost (or stock would go negative).
 */
async function lockLevel(t, productId, locationId) {
  await t('stock_levels')
    .insert({ product_id: productId, location_id: locationId, quantity: 0 })
    .onConflict(['product_id', 'location_id'])
    .ignore();
  return t('stock_levels').where({ product_id: productId, location_id: locationId }).forUpdate().first();
}

/**
 * Records a stock movement and updates the cached stock_levels total in one
 * transaction, so the audit trail (stock_movements) and the fast-read
 * snapshot (stock_levels) never drift apart.
 *
 * For 'adjustment', pass a signed delta via options.delta (can be negative).
 *
 * options.onLevelChange(t, change) is called inside the transaction after the
 * level is updated - used for stock alerts (see notifications/stockAlerts.js).
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
  let signedChange;
  if (type === 'adjustment') {
    if (delta === null || !Number.isInteger(Number(delta)) || Number(delta) === 0) {
      throw new AppError('adjustment requires a non-zero whole-number delta');
    }
    signedChange = Number(delta);
  } else if (INCREASING_TYPES.includes(type)) {
    signedChange = toPositiveInt(quantity);
  } else if (DECREASING_TYPES.includes(type)) {
    signedChange = -toPositiveInt(quantity);
  } else {
    throw new AppError(`Unknown movement type: ${type}`);
  }

  return trx.transaction(async (t) => {
    const existing = await lockLevel(t, productId, locationId);
    const currentQty = existing.quantity;
    const newQty = currentQty + signedChange;

    if (newQty < 0) {
      throw new AppError('Insufficient stock at this location for this operation');
    }

    await t('stock_levels').where({ id: existing.id }).update({ quantity: newQty });

    // Every stock movement belongs to a business day: with no day open, stock
    // work (intake, transfers, damage, deliveries) is refused like sales. It
    // is not paused while the closing is in progress.
    const { activeDayId } = require('../businessDay/businessDayService');
    const businessDayId = await activeDayId(t);

    const [movement] = await t('stock_movements')
      .insert({
        business_day_id: businessDayId,
        product_id: productId,
        location_id: locationId,
        type,
        quantity: Math.abs(signedChange),
        reference_type: referenceType,
        reference_id: referenceId,
        notes,
        performed_by: performedBy,
      })
      .returning('*');

    // Required lazily: stockAlerts depends on the notification service, which
    // depends on db - a top-level require here would be circular.
    const { onStockLevelChanged } = require('../notifications/stockAlerts');
    await onStockLevelChanged(t, { productId, locationId, before: currentQty, after: newQty, actorUserId: performedBy });

    return movement;
  });
}

/**
 * Moves stock from one location to another (e.g. store room -> front shelf)
 * as one atomic operation. Both rows are locked in a fixed (location id)
 * order first, so two opposite transfers can't deadlock each other.
 */
async function transferStock({ productId, fromLocationId, toLocationId, quantity, performedBy, notes }) {
  const qty = toPositiveInt(quantity);
  if (Number(fromLocationId) === Number(toLocationId)) throw new AppError('Source and destination must differ');
  return db.transaction(async (t) => {
    for (const locationId of [fromLocationId, toLocationId].map(Number).sort((a, b) => a - b)) {
      await lockLevel(t, productId, locationId);
    }
    await applyMovement(
      { productId, locationId: fromLocationId, type: 'transfer_out', quantity: qty, performedBy, notes, referenceType: 'transfer' },
      t
    );
    await applyMovement(
      { productId, locationId: toLocationId, type: 'transfer_in', quantity: qty, performedBy, notes, referenceType: 'transfer' },
      t
    );
  });
}

/**
 * Records damaged stock and the matching shrinkage record in one transaction,
 * so analytics can never show shrinkage without the stock actually leaving
 * (or vice versa). Returns { movement, shrinkage }.
 */
async function recordDamage({ productId, locationId, quantity, notes, performedBy }) {
  const qty = toPositiveInt(quantity);
  return db.transaction(async (t) => {
    const movement = await applyMovement(
      { productId, locationId, type: 'damaged', quantity: qty, notes, performedBy, referenceType: 'manual' },
      t
    );
    const [shrinkage] = await t('shrinkage_records')
      .insert({
        product_id: productId,
        quantity: qty,
        cause: 'spoilage',
        notes,
        recorded_by: performedBy,
        recorded_date: new Date().toISOString().slice(0, 10),
      })
      .returning('*');

    const product = await t('products').where({ id: productId }).first();
    const value = qty * Number(product.cost_price);
    const { emitIfOver } = require('../notifications/notificationService');
    await emitIfOver(t, 'LARGE_DAMAGE', 'min_value_rwf', value, {
      entityType: 'product',
      entityId: productId,
      dedupKey: `LARGE_DAMAGE:shrinkage:${shrinkage.id}`,
      actorUserId: performedBy,
      params: { product_name: product.name, quantity: qty, value_rwf: value },
    });
    return { movement, shrinkage };
  });
}

/**
 * Sorts line items by product_id so every multi-item transaction locks
 * stock rows in the same order - two sales touching the same products can
 * then queue behind each other instead of deadlocking.
 */
function inLockOrder(items) {
  return [...items].sort((a, b) => Number(a.product_id) - Number(b.product_id));
}

module.exports = { applyMovement, transferStock, recordDamage, inLockOrder, toPositiveInt };
