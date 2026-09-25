// Stock alerts, evaluated inside applyMovement's transaction after every
// stock change. Alerts fire on *crossings* (above -> at/below a line), never
// on every movement while stock stays low, and stay open until stock
// recovers - so a product selling one unit at a time while low produces one
// alert, not one per sale.
//
//  LOW_STOCK          total across locations crosses down to <= reorder_level (> 0)
//  OUT_OF_STOCK       total crosses down to 0
//  STOCK_REPLENISHED  total crosses back above reorder_level (resolves the above)
//  SHELF_EMPTY        front shelf crosses down to 0 (resolved when refilled)
const { emit, resolve } = require('./notificationService');

const FRONT_SHELF = 'front_shelf';
const STORE_ROOM = 'store_room';

async function onStockLevelChanged(t, { productId, locationId, before, after, actorUserId }) {
  if (before === after) return;
  const product = await t('products').where({ id: productId }).first('id', 'name', 'sku', 'reorder_level', 'is_active');
  if (!product || !product.is_active) return;

  const levels = await t('stock_levels')
    .join('stock_locations', 'stock_locations.id', 'stock_levels.location_id')
    .where('stock_levels.product_id', productId)
    .select('stock_locations.id', 'stock_locations.name', 'stock_levels.quantity');
  const totalAfter = levels.reduce((sum, l) => sum + l.quantity, 0);
  const totalBefore = totalAfter - (after - before);
  const reorder = product.reorder_level;
  const base = { entityType: 'product', entityId: product.id, actorUserId };
  const names = { product_name: product.name, sku: product.sku };
  const key = (type) => `${type}:product:${product.id}`;

  if (totalBefore > 0 && totalAfter === 0) {
    await emit(t, { ...base, type: 'OUT_OF_STOCK', dedupKey: key('OUT_OF_STOCK'), params: names });
  } else if (reorder > 0 && totalAfter > 0 && totalAfter <= reorder && (totalBefore > reorder || totalBefore === 0)) {
    // Coming down through the line, or partially refilled from zero but
    // still low - either way it's now "low", not "out".
    if (totalBefore === 0) await resolve(t, key('OUT_OF_STOCK'));
    await emit(t, {
      ...base, type: 'LOW_STOCK', dedupKey: key('LOW_STOCK'),
      params: { ...names, quantity: totalAfter, reorder_level: reorder },
    });
  } else if (totalAfter > reorder && totalBefore <= reorder) {
    const closed = (await resolve(t, key('LOW_STOCK'))) + (await resolve(t, key('OUT_OF_STOCK')));
    if (closed > 0) {
      await emit(t, {
        ...base, type: 'STOCK_REPLENISHED', dedupKey: `STOCK_REPLENISHED:product:${product.id}:${Date.now()}`,
        params: { ...names, quantity: totalAfter },
      });
    }
  }

  const location = levels.find((l) => l.id === Number(locationId));
  if (location?.name === FRONT_SHELF) {
    if (before > 0 && after === 0) {
      const storeRoom = levels.find((l) => l.name === STORE_ROOM);
      await emit(t, {
        ...base, type: 'SHELF_EMPTY', dedupKey: key('SHELF_EMPTY'),
        params: { ...names, store_room_quantity: storeRoom ? storeRoom.quantity : 0 },
      });
    } else if (before === 0 && after > 0) {
      await resolve(t, key('SHELF_EMPTY'));
    }
  }
}

module.exports = { onStockLevelChanged };
