const db = require('../config/db');
const { applyMovement } = require('./stockService');

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
  if (!items || !items.length) throw new Error('An order needs at least one item');

  const storeRoom = await db('stock_locations').where({ name: 'store_room' }).first();
  if (!storeRoom) throw new Error('store_room location is not configured');

  const totalAmount = items.reduce((sum, i) => sum + Number(i.quantity) * Number(i.unit_price), 0);

  return db.transaction(async (trx) => {
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
        items.map((i) => ({
          order_id: order.id,
          product_id: i.product_id,
          quantity: i.quantity,
          unit_price: i.unit_price,
        }))
      )
      .returning('*');

    for (const item of items) {
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

    return { ...order, items: itemRows };
  });
}

async function markDelivered({ orderId, performedBy }) {
  const [order] = await db('institution_orders')
    .where({ id: orderId })
    .update({ delivery_status: 'delivered', delivery_date: db.fn.now() })
    .returning('*');
  if (!order) throw new Error('Order not found');
  return order;
}

/** Same pattern as supplier payments: log the payment, recompute status. */
async function recordPayment({ orderId, amount, paidDate, method, recordedBy }) {
  if (amount <= 0) throw new Error('Payment amount must be positive');

  return db.transaction(async (trx) => {
    const order = await trx('institution_orders').where({ id: orderId }).first();
    if (!order) throw new Error('Order not found');

    const [payment] = await trx('institution_payments')
      .insert({ order_id: orderId, amount, paid_date: paidDate, method, recorded_by: recordedBy })
      .returning('*');

    const newPaidTotal = Number(order.amount_paid) + Number(amount);
    let status = 'partial';
    if (newPaidTotal <= 0) status = 'unpaid';
    else if (newPaidTotal >= Number(order.total_amount)) status = 'paid';

    const [updatedOrder] = await trx('institution_orders')
      .where({ id: orderId })
      .update({ amount_paid: newPaidTotal, payment_status: status })
      .returning('*');

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
