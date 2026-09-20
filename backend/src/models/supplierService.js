const db = require('../config/db');
const { applyMovement } = require('./stockService');

/**
 * Records a supplier delivery: the delivery header, its line items, and a
 * stock_in movement per item (into the store room by default) - all in one
 * transaction so a delivery can never exist without matching stock, or vice
 * versa.
 *
 * items: [{ product_id, quantity, unit_cost }]
 */
async function createDelivery({ supplierId, deliveryDate, paymentDueDate, items, recordedBy }) {
  if (!items || !items.length) throw new Error('A delivery needs at least one item');

  const storeRoom = await db('stock_locations').where({ name: 'store_room' }).first();
  if (!storeRoom) throw new Error('store_room location is not configured');

  const totalAmount = items.reduce((sum, i) => sum + Number(i.quantity) * Number(i.unit_cost), 0);

  return db.transaction(async (trx) => {
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
        items.map((i) => ({
          delivery_id: delivery.id,
          product_id: i.product_id,
          quantity: i.quantity,
          unit_cost: i.unit_cost,
        }))
      )
      .returning('*');

    for (const item of items) {
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

    return { ...delivery, items: itemRows };
  });
}

/**
 * Records a payment against a delivery and recomputes its paid/partial/unpaid
 * status. Allows overpayment to be flagged rather than silently rejected,
 * since real-world reconciliation sometimes needs that visible.
 */
async function recordPayment({ deliveryId, amount, paidDate, method, recordedBy }) {
  if (amount <= 0) throw new Error('Payment amount must be positive');

  return db.transaction(async (trx) => {
    const delivery = await trx('supplier_deliveries').where({ id: deliveryId }).first();
    if (!delivery) throw new Error('Delivery not found');

    const [payment] = await trx('supplier_payments')
      .insert({ delivery_id: deliveryId, amount, paid_date: paidDate, method, recorded_by: recordedBy })
      .returning('*');

    const newPaidTotal = Number(delivery.amount_paid) + Number(amount);
    let status = 'partial';
    if (newPaidTotal <= 0) status = 'unpaid';
    else if (newPaidTotal >= Number(delivery.total_amount)) status = 'paid';

    const [updatedDelivery] = await trx('supplier_deliveries')
      .where({ id: deliveryId })
      .update({ amount_paid: newPaidTotal, status })
      .returning('*');

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

module.exports = { createDelivery, recordPayment, getUnpaidSummary };
