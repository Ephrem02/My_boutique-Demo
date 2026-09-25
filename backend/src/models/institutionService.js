const db = require('../config/db');
const { AppError } = require('../utils/AppError');
const { applyMovement, inLockOrder, toPositiveInt } = require('./stockService');
const { toPositiveAmount } = require('./supplierService');
const { emit, actorName } = require('../notifications/notificationService');

/**
 * Creates a bulk/credit order for an institution. Stock is deducted
 * immediately from the store room (goods are dispatched at order time);
 * delivery_status is a separate logistics flag for "has this been physically
 * dropped off / confirmed received", not a gate on stock.
 *
 * items: [{ product_id, quantity, unit_price }] - unit_price may be a
 * negotiated institutional rate, different from the regular selling_price.
 */
async function createOrder({ institutionId, orderDate, deliveryDate, items, recordedBy }) {
  if (!items || !items.length) throw new AppError('An order needs at least one item');
  const lines = inLockOrder(items).map((i) => {
    const unitPrice = Number(i.unit_price);
    if (!Number.isFinite(unitPrice) || unitPrice < 0) throw new AppError('unit_price must be a non-negative number');
    return { ...i, quantity: toPositiveInt(i.quantity), unit_price: unitPrice };
  });

  const storeRoom = await db('stock_locations').where({ name: 'store_room' }).first();
  if (!storeRoom) throw new AppError('store_room location is not configured');

  const totalAmount = lines.reduce((sum, i) => sum + i.quantity * i.unit_price, 0);

  return db.transaction(async (trx) => {
    const institution = await trx('institutions').where({ id: institutionId }).first();
    if (!institution) throw new AppError('Institution not found', 404);

    const [order] = await trx('institution_orders')
      .insert({
        institution_id: institutionId,
        order_date: orderDate,
        delivery_date: deliveryDate || null,
        total_amount: totalAmount,
        amount_paid: 0,
        delivery_status: 'pending',
        payment_status: 'unpaid',
        recorded_by: recordedBy,
      })
      .returning('*');

    const itemRows = await trx('institution_order_items')
      .insert(
        lines.map((i) => ({
          order_id: order.id,
          product_id: i.product_id,
          quantity: i.quantity,
          unit_price: i.unit_price,
        }))
      )
      .returning('*');

    for (const item of lines) {
      await applyMovement(
        {
          productId: item.product_id,
          locationId: storeRoom.id,
          type: 'sold',
          quantity: item.quantity,
          referenceType: 'institution_order',
          referenceId: order.id,
          performedBy: recordedBy,
          notes: `Institution order #${order.id}`,
        },
        trx
      );
    }

    await emit(trx, {
      type: 'INSTITUTION_ORDER_CREATED',
      dedupKey: `INSTITUTION_ORDER_CREATED:order:${order.id}`,
      entityType: 'institution_order',
      entityId: order.id,
      actorUserId: recordedBy,
      params: {
        institution_name: institution.name,
        order_id: order.id,
        amount_rwf: totalAmount,
        actor_name: await actorName(trx, recordedBy),
      },
    });

    return { ...order, items: itemRows };
  });
}

/** Marks an order delivered. Only the pending -> delivered transition notifies. */
async function markDelivered({ orderId, performedBy }) {
  return db.transaction(async (trx) => {
    const [order] = await trx('institution_orders')
      .where({ id: orderId, delivery_status: 'pending' })
      .update({ delivery_status: 'delivered', delivery_date: trx.fn.now() })
      .returning('*');
    if (!order) {
      const existing = await trx('institution_orders').where({ id: orderId }).first();
      if (!existing) throw new AppError('Order not found', 404);
      return existing; // already delivered - idempotent
    }
    const institution = await trx('institutions').where({ id: order.institution_id }).first('name');
    await emit(trx, {
      type: 'INSTITUTION_ORDER_DELIVERED',
      dedupKey: `INSTITUTION_ORDER_DELIVERED:order:${order.id}`,
      entityType: 'institution_order',
      entityId: order.id,
      actorUserId: performedBy,
      params: { institution_name: institution.name, order_id: order.id, actor_name: await actorName(trx, performedBy) },
    });
    return order;
  });
}

/** Same pattern as supplier payments: lock, log the payment, recompute status. */
async function recordPayment({ orderId, amount, paidDate, method, recordedBy }) {
  const value = toPositiveAmount(amount);

  return db.transaction(async (trx) => {
    const order = await trx('institution_orders').where({ id: orderId }).forUpdate().first();
    if (!order) throw new AppError('Order not found', 404);

    const [payment] = await trx('institution_payments')
      .insert({ order_id: orderId, amount: value, paid_date: paidDate, method, recorded_by: recordedBy })
      .returning('*');

    const newPaidTotal = Number(order.amount_paid) + value;
    let status = 'partial';
    if (newPaidTotal <= 0) status = 'unpaid';
    else if (newPaidTotal >= Number(order.total_amount)) status = 'paid';

    const [updatedOrder] = await trx('institution_orders')
      .where({ id: orderId })
      .update({ amount_paid: newPaidTotal, payment_status: status })
      .returning('*');

    const institution = await trx('institutions').where({ id: order.institution_id }).first('name');
    await emit(trx, {
      type: 'INSTITUTION_PAYMENT_RECEIVED',
      dedupKey: `INSTITUTION_PAYMENT_RECEIVED:payment:${payment.id}`,
      entityType: 'institution_order',
      entityId: order.id,
      actorUserId: recordedBy,
      params: {
        institution_name: institution.name,
        order_id: order.id,
        amount_rwf: value,
        balance_rwf: Math.max(0, Number(order.total_amount) - newPaidTotal),
        actor_name: await actorName(trx, recordedBy),
      },
    });
    if (newPaidTotal > Number(order.total_amount)) {
      await emit(trx, {
        type: 'OVERPAYMENT',
        dedupKey: `OVERPAYMENT:institution_payment:${payment.id}`,
        entityType: 'institution_order',
        entityId: order.id,
        actorUserId: recordedBy,
        params: {
          party_type: 'institution order',
          party_name: institution.name,
          reference_id: order.id,
          total_rwf: Number(order.total_amount),
          paid_rwf: newPaidTotal,
        },
      });
    }

    return { payment, order: updatedOrder };
  });
}

/** Institutions with an outstanding balance, mirroring the unpaid suppliers view. */
async function getUnpaidSummary() {
  return db('institution_orders')
    .select(
      'institutions.id as institution_id', 'institutions.name as institution_name',
      db.raw('SUM(institution_orders.total_amount - institution_orders.amount_paid) as balance_due'),
      db.raw('COUNT(*) as unpaid_orders')
    )
    .join('institutions', 'institutions.id', 'institution_orders.institution_id')
    .whereIn('institution_orders.payment_status', ['unpaid', 'partial'])
    .groupBy('institutions.id', 'institutions.name')
    .havingRaw('SUM(institution_orders.total_amount - institution_orders.amount_paid) > 0')
    .orderBy('balance_due', 'desc');
}

module.exports = { createOrder, markDelivered, recordPayment, getUnpaidSummary };
