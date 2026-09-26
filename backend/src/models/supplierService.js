const db = require('../config/db');
const { AppError } = require('../utils/AppError');
const { applyMovement, inLockOrder, toPositiveInt } = require('./stockService');
const { emit, actorName } = require('../notifications/notificationService');
const { audit } = require('../audit/auditService');
const { formatRwf } = require('../utils/sanitize');
const { SIDES } = require('../finance/sides');
const ledger = require('../finance/ledger');

const s = SIDES.supplier;

/**
 * Records goods received from a supplier - a purchase invoice: the header
 * (supplier's reference number, who received it), its lines (with batch and
 * expiry where applicable) and a stock_in movement per line into the store
 * room, all in one transaction so goods and the payable can never disagree.
 *
 * `payment` ({ amount, method, reference_no }) records money paid on receipt
 * as the invoice's first ledger transaction; without it the goods are on
 * credit. Paying suppliers needs supplier_payments.manage (checked by the
 * controller). Balances/status come from the ledger, never stored here.
 *
 * items: [{ product_id, quantity, unit_cost, batch_no?, expiry_date? }]
 */
async function createDelivery({ req, supplierId, deliveryDate, paymentDueDate, referenceNo, notes, items, payment }) {
  if (!items || !items.length) throw new AppError('A delivery needs at least one item');
  const lines = inLockOrder(items).map((i) => {
    const unitCost = Number(i.unit_cost);
    if (!Number.isFinite(unitCost) || unitCost < 0) throw new AppError('unit_cost must be a non-negative number');
    if (i.expiry_date && Number.isNaN(Date.parse(i.expiry_date))) throw new AppError('expiry_date must be a date (YYYY-MM-DD)', 422);
    return { ...i, quantity: toPositiveInt(i.quantity), unit_cost: unitCost };
  });
  const receivedOn = ledger.parseDate(deliveryDate, 'delivery_date');
  const pay = payment && Number(payment.amount) > 0
    ? { amount: ledger.parseAmount(payment.amount, 'payment amount'), method: ledger.parseMethod(payment.method), referenceNo: payment.reference_no }
    : null;

  const storeRoom = await db('stock_locations').where({ name: 'store_room' }).first();
  if (!storeRoom) throw new AppError('store_room location is not configured');

  const totalAmount = ledger.n(lines.reduce((sum, i) => sum + i.quantity * i.unit_cost, 0));
  const recordedBy = req.user.id;

  return db.transaction(async (trx) => {
    const supplier = await trx('suppliers').where({ id: supplierId }).first();
    if (!supplier) throw new AppError('Supplier not found', 404);

    const [delivery] = await trx('supplier_deliveries')
      .insert({
        supplier_id: supplierId,
        delivery_date: receivedOn,
        payment_due_date: paymentDueDate || null,
        reference_no: ledger.text(referenceNo, 100),
        notes: ledger.text(notes, 1000),
        total_amount: totalAmount,
        recorded_by: recordedBy,
        received_by: recordedBy,
      })
      .returning('*');

    const itemRows = await trx('supplier_delivery_items')
      .insert(lines.map((i) => ({
        delivery_id: delivery.id,
        product_id: i.product_id,
        quantity: i.quantity,
        unit_cost: i.unit_cost,
        batch_no: ledger.text(i.batch_no, 100),
        expiry_date: i.expiry_date || null,
      })))
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

    await audit(req, {
      action: 'supplier_delivery.create', entityType: 'supplier_delivery', entityId: delivery.id,
      newValues: { supplier_id: supplierId, reference_no: delivery.reference_no, total_amount: totalAmount, lines: lines.length, paid_on_receipt: pay?.amount || 0 },
    }, { trx, required: true });

    if (pay) {
      await ledger.insertPayment(trx, {
        req, s, invoice: delivery, amount: pay.amount, method: pay.method, referenceNo: pay.referenceNo, txnDate: receivedOn, note: 'Paid on receipt',
      });
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
        amount_rwf: formatRwf(totalAmount),
        due_date: paymentDueDate || 'not set',
        actor_name: await actorName(trx, recordedBy),
      },
    });

    return { ...delivery, ...(await ledger.balanceOf(trx, s, delivery.id)), items: itemRows };
  });
}

module.exports = { createDelivery };
