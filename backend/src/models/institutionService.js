const db = require('../config/db');
const { AppError } = require('../utils/AppError');
const { applyMovement, inLockOrder, toPositiveInt } = require('./stockService');
const { emit, actorName } = require('../notifications/notificationService');
const { audit } = require('../audit/auditService');
const { formatRwf } = require('../utils/sanitize');
const { SIDES } = require('../finance/sides');
const ledger = require('../finance/ledger');
const credit = require('../finance/credit');

const s = SIDES.customer;

/**
 * Creates a customer (institution) sales invoice. Stock is deducted
 * immediately from the store room (goods are dispatched at order time);
 * delivery_status is a separate logistics flag for "has this been physically
 * dropped off / confirmed received", not a gate on stock.
 *
 * items: [{ product_id, quantity, unit_price }] - unit_price may be a
 * negotiated rate, different from the regular selling_price.
 * discount_amount: invoice-level discount (total = lines - discount).
 * payment ({ amount, method, reference_no }): paid at the sale; without it
 * the whole invoice is on credit. Balances/status come from the ledger.
 *
 * Credit limit: whatever is not paid now goes on the client's account, so it
 * is checked against their limit (finance/credit.js) with the client row
 * locked. Going over needs creditExceptionId (a manager's approval for today)
 * or creditOverride ({ reason }, a manager approving inline).
 */
async function createOrder({
  req, institutionId, orderDate, deliveryDate, dueDate, discountAmount, notes, items, payment, fromLocation = 'store_room', creditExceptionId, creditOverride,
}) {
  if (!items || !items.length) throw new AppError('An order needs at least one item');
  const lines = inLockOrder(items).map((i) => {
    const unitPrice = Number(i.unit_price);
    if (!Number.isFinite(unitPrice) || unitPrice < 0) throw new AppError('unit_price must be a non-negative number');
    return { ...i, quantity: toPositiveInt(i.quantity), unit_price: unitPrice };
  });
  const soldOn = ledger.parseDate(orderDate, 'order_date');
  const subtotal = ledger.n(lines.reduce((sum, i) => sum + i.quantity * i.unit_price, 0));
  const discount = discountAmount === undefined || discountAmount === null || discountAmount === '' ? 0 : Number(discountAmount);
  if (!Number.isFinite(discount) || discount < 0) throw new AppError('discount_amount must be a non-negative amount', 422);
  if (discount > subtotal) throw new AppError('The discount cannot be more than the invoice amount', 422);
  const totalAmount = ledger.n(subtotal - discount);
  const pay = payment && Number(payment.amount) > 0
    ? { amount: ledger.parseAmount(payment.amount, 'payment amount'), method: ledger.parseMethod(payment.method), referenceNo: payment.reference_no }
    : null;
  if (dueDate && Number.isNaN(Date.parse(dueDate))) throw new AppError('due_date must be a date (YYYY-MM-DD)', 422);

  const storeRoom = await db('stock_locations').where({ name: fromLocation }).first();
  if (!storeRoom) throw new AppError(`${fromLocation} location is not configured`);
  const recordedBy = req.user.id;

  return db.transaction(async (trx) => {
    // Locked: concurrent credit sales to the same client are checked one at a time
    const institution = await trx('institutions').where({ id: Number(institutionId) || 0 }).forUpdate().first();
    if (!institution) throw new AppError('Customer not found', 404);
    // Blocked clients can still pay what they owe, but get no new credit
    if (institution.status === 'blocked') throw new AppError(`${institution.name} is blocked: new sales on account are not allowed`, 409);

    const onCredit = ledger.n(totalAmount - (pay?.amount || 0));
    const exception = await credit.checkSale(trx, {
      req, institution, creditAmount: onCredit, exceptionId: creditExceptionId, overrideReason: creditOverride?.reason,
    });

    // The open business day, if any: the sale then shows in that day's figures
    const activeDay = await trx('business_days').whereIn('status', require('../businessDay/businessDayService').ACTIVE).first('id');

    const [order] = await trx('institution_orders')
      .insert({
        business_day_id: activeDay?.id || null,
        institution_id: institutionId,
        order_date: soldOn,
        delivery_date: deliveryDate || null,
        due_date: dueDate || null,
        discount_amount: ledger.n(discount),
        notes: ledger.text(notes, 1000),
        total_amount: totalAmount,
        // sold at the till: the customer takes the goods there and then
        delivery_status: fromLocation === 'front_shelf' ? 'delivered' : 'pending',
        recorded_by: recordedBy,
      })
      .returning('*');

    const itemRows = await trx('institution_order_items')
      .insert(lines.map((i) => ({ order_id: order.id, product_id: i.product_id, quantity: i.quantity, unit_price: i.unit_price })))
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
          notes: `Customer invoice #${order.id}`,
        },
        trx
      );
    }

    await audit(req, {
      action: 'institution_order.create', entityType: 'institution_order', entityId: order.id,
      newValues: { institution_id: institutionId, subtotal, discount_amount: discount, total_amount: totalAmount, lines: lines.length, paid_at_sale: pay?.amount || 0 },
    }, { trx, required: true });

    await emit(trx, {
      type: 'INSTITUTION_ORDER_CREATED',
      dedupKey: `INSTITUTION_ORDER_CREATED:order:${order.id}`,
      entityType: 'institution_order',
      entityId: order.id,
      actorUserId: recordedBy,
      params: {
        institution_name: institution.name,
        order_id: order.id,
        amount_rwf: formatRwf(totalAmount),
        actor_name: await actorName(trx, recordedBy),
      },
    });

    if (pay) {
      await ledger.insertPayment(trx, {
        req, s, invoice: order, amount: pay.amount, method: pay.method, referenceNo: pay.referenceNo, txnDate: soldOn, note: 'Paid at sale',
      });
    }

    if (exception) await credit.useException(trx, { req, exception, order, institution, creditAmount: onCredit });

    return { ...order, discount_amount: ledger.n(order.discount_amount), ...(await ledger.balanceOf(trx, s, order.id)), items: itemRows };
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

module.exports = { createOrder, markDelivered };
