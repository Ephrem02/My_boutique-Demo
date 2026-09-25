const db = require('../config/db');
const { AppError } = require('../utils/AppError');
const { applyMovement, inLockOrder, toPositiveInt } = require('./stockService');
const { emit, actorName } = require('../notifications/notificationService');

function toPositiveAmount(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw new AppError('Payment amount must be positive');
  return n;
}

/**
 * Records a supplier delivery: the delivery header, its line items, and a
 * stock_in movement per item (into the store room by default) - all in one
 * transaction so a delivery can never exist without matching stock, or vice
 * versa.
 *
 * items: [{ product_id, quantity, unit_cost }]
 */
async function createDelivery({ supplierId, deliveryDate, paymentDueDate, items, recordedBy }) {
  if (!items || !items.length) throw new AppError('A delivery needs at least one item');
  const lines = inLockOrder(items).map((i) => {
    const unitCost = Number(i.unit_cost);
    if (!Number.isFinite(unitCost) || unitCost < 0) throw new AppError('unit_cost must be a non-negative number');
    return { ...i, quantity: toPositiveInt(i.quantity), unit_cost: unitCost };
  });

  const storeRoom = await db('stock_locations').where({ name: 'store_room' }).first();
  if (!storeRoom) throw new AppError('store_room location is not configured');

  const totalAmount = lines.reduce((sum, i) => sum + i.quantity * i.unit_cost, 0);

  return db.transaction(async (trx) => {
    const supplier = await trx('suppliers').where({ id: supplierId }).first();
    if (!supplier) throw new AppError('Supplier not found', 404);

    const [delivery] = await trx('supplier_deliveries')
      .insert({
        supplier_id: supplierId,
        delivery_date: deliveryDate,
        payment_due_date: paymentDueDate || null,
        total_amount: totalAmount,
        amount_paid: 0,
        status: 'unpaid',
        recorded_by: recordedBy,
      })
      .returning('*');

    const itemRows = await trx('supplier_delivery_items')
      .insert(
        lines.map((i) => ({
          delivery_id: delivery.id,
          product_id: i.product_id,
          quantity: i.quantity,
          unit_cost: i.unit_cost,
        }))
      )
      .returning('*');

    for (const item of lines) {
      await applyMovement(
        {
          productId: item.product_id,
          locationId: storeRoom.id,
          type: 'stock_in',
          quantity: item.quantity,
          referenceType: 'supplier_delivery',
          referenceId: delivery.id,
          performedBy: recordedBy,
          notes: `Delivery from supplier #${supplierId}`,
        },
        trx
      );
    }

    await emit(trx, {
      type: 'DELIVERY_RECEIVED',
      dedupKey: `DELIVERY_RECEIVED:delivery:${delivery.id}`,
      entityType: 'supplier_delivery',
      entityId: delivery.id,
      actorUserId: recordedBy,
      params: {
        supplier_name: supplier.name,
        delivery_id: delivery.id,
        amount_rwf: totalAmount,
        due_date: paymentDueDate || 'not set',
        actor_name: await actorName(trx, recordedBy),
      },
    });

    return { ...delivery, items: itemRows };
  });
}

/**
 * Records a payment against a delivery and recomputes its paid/partial/unpaid
 * status. Allows overpayment to be flagged rather than silently rejected,
 * since real-world reconciliation sometimes needs that visible - it raises a
 * mandatory OVERPAYMENT alert. The delivery row is locked so two payments
 * recorded at once can't both read the same amount_paid.
 */
async function recordPayment({ deliveryId, amount, paidDate, method, recordedBy }) {
  const value = toPositiveAmount(amount);

  return db.transaction(async (trx) => {
    const delivery = await trx('supplier_deliveries').where({ id: deliveryId }).forUpdate().first();
    if (!delivery) throw new AppError('Delivery not found', 404);

    const [payment] = await trx('supplier_payments')
      .insert({ delivery_id: deliveryId, amount: value, paid_date: paidDate, method, recorded_by: recordedBy })
      .returning('*');

    const newPaidTotal = Number(delivery.amount_paid) + value;
    let status = 'partial';
    if (newPaidTotal <= 0) status = 'unpaid';
    else if (newPaidTotal >= Number(delivery.total_amount)) status = 'paid';

    const [updatedDelivery] = await trx('supplier_deliveries')
      .where({ id: deliveryId })
      .update({ amount_paid: newPaidTotal, status })
      .returning('*');

    if (newPaidTotal > Number(delivery.total_amount)) {
      const supplier = await trx('suppliers').where({ id: delivery.supplier_id }).first('name');
      await emit(trx, {
        type: 'OVERPAYMENT',
        dedupKey: `OVERPAYMENT:supplier_payment:${payment.id}`,
        entityType: 'supplier_delivery',
        entityId: delivery.id,
        actorUserId: recordedBy,
        params: {
          party_type: 'supplier delivery',
          party_name: supplier.name,
          reference_id: delivery.id,
          total_rwf: Number(delivery.total_amount),
          paid_rwf: newPaidTotal,
        },
      });
    }

    return { payment, delivery: updatedDelivery };
  });
}

/** Suppliers with an outstanding balance, for the "unpaid suppliers" view. */
async function getUnpaidSummary() {
  return db('supplier_deliveries')
    .select(
      'suppliers.id as supplier_id', 'suppliers.name as supplier_name',
      db.raw('SUM(supplier_deliveries.total_amount - supplier_deliveries.amount_paid) as balance_due'),
      db.raw('COUNT(*) as unpaid_deliveries')
    )
    .join('suppliers', 'suppliers.id', 'supplier_deliveries.supplier_id')
    .whereIn('supplier_deliveries.status', ['unpaid', 'partial'])
    .groupBy('suppliers.id', 'suppliers.name')
    .havingRaw('SUM(supplier_deliveries.total_amount - supplier_deliveries.amount_paid) > 0')
    .orderBy('balance_due', 'desc');
}

module.exports = { createDelivery, recordPayment, getUnpaidSummary, toPositiveAmount };
