// Proforma invoices: a price proposal before a sale.
//
// Creating one records no sale, moves no stock and creates no debt. Totals are
// computed here from the lines (never taken from the client). The person
// creating it chooses the expiry date. It can be cancelled, or converted once
// into a real customer invoice - through the normal createOrder path, so stock,
// credit limits, business day and audit rules all apply exactly as for any sale.
const db = require('../config/db');
const { AppError } = require('../utils/AppError');
const { audit } = require('../audit/auditService');
const { getClosingSettings, shopDate } = require('../businessDay/settings');
const { dateOnly } = require('../businessDay/businessDayService');
const { inLockOrder, toPositiveInt } = require('../models/stockService');
const ledger = require('../finance/ledger');
const { getBusiness } = require('./business');
const pdf = require('./pdf');

const { n, text } = ledger;
const isDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));

/** Next number for a document type, e.g. PRO-2026-000042. Locks the counter row until commit. */
async function nextNumber(trx, docType, prefix, date) {
  const year = Number(String(date).slice(0, 4));
  const { rows } = await trx.raw(
    `INSERT INTO document_counters (doc_type, year, last_no) VALUES (?, ?, 1)
     ON CONFLICT (doc_type, year) DO UPDATE SET last_no = document_counters.last_no + 1
     RETURNING last_no`,
    [docType, year],
  );
  return `${prefix}-${year}-${String(rows[0].last_no).padStart(6, '0')}`;
}

function present(row, today) {
  if (!row) return row;
  const validUntil = dateOnly(row.valid_until);
  return {
    ...row,
    issue_date: dateOnly(row.issue_date),
    valid_until: validUntil,
    subtotal: n(row.subtotal),
    discount_amount: n(row.discount_amount),
    total_amount: n(row.total_amount),
    // "expired" is derived: an issued proforma past its date
    state: row.status === 'issued' && validUntil < today ? 'expired' : row.status,
  };
}

async function createProforma({ req, body = {} }) {
  const settings = await getClosingSettings();
  const today = shopDate(settings);
  if (!isDate(body.valid_until)) throw new AppError('Choose the expiry date (valid_until, YYYY-MM-DD)', 422);
  if (body.valid_until < today) throw new AppError('The expiry date cannot be in the past', 422);
  if (!Array.isArray(body.items) || !body.items.length) throw new AppError('A proforma needs at least one item', 422);

  const products = await db('products').whereIn('id', body.items.map((i) => Number(i.product_id) || 0));
  const lines = inLockOrder(body.items).map((i) => {
    const product = products.find((p) => p.id === Number(i.product_id));
    if (!product || !product.is_active) throw new AppError(`Unknown product_id: ${i.product_id}`, 422);
    const quantity = toPositiveInt(i.quantity);
    const unitPrice = i.unit_price === undefined || i.unit_price === '' || i.unit_price === null ? Number(product.selling_price) : Number(i.unit_price);
    if (!Number.isFinite(unitPrice) || unitPrice < 0) throw new AppError('unit_price must be a non-negative number', 422);
    return { product, quantity, unit_price: n(unitPrice), line_total: n(quantity * n(unitPrice)) };
  });
  const subtotal = n(lines.reduce((s, l) => s + l.line_total, 0));
  const discount = body.discount_amount === undefined || body.discount_amount === '' ? 0 : Number(body.discount_amount);
  if (!Number.isFinite(discount) || discount < 0) throw new AppError('discount_amount must be a non-negative amount', 422);
  if (discount > subtotal) throw new AppError('The discount cannot be more than the proforma amount', 422);

  return db.transaction(async (trx) => {
    let institution = null;
    let customerName = text(body.customer_name, 200);
    if (body.institution_id) {
      institution = await trx('institutions').where({ id: Number(body.institution_id) || 0 }).first();
      if (!institution) throw new AppError('Client not found', 404);
      customerName = institution.name;
    }
    if (!customerName) throw new AppError('Choose a client or type the customer\'s name', 422);
    const number = await nextNumber(trx, 'proforma', 'PRO', today);
    const business = await getBusiness(trx);
    const [row] = await trx('proformas').insert({
      number,
      institution_id: institution?.id || null,
      customer_name: customerName,
      customer_contact: text(body.customer_contact, 200) || (institution ? [institution.contact_person, institution.contact_phone].filter(Boolean).join(' · ') || null : null),
      issue_date: today,
      valid_until: body.valid_until,
      payment_terms: text(body.payment_terms, 1000) || business.proforma_terms || null,
      notes: text(body.notes, 1000),
      subtotal,
      discount_amount: n(discount),
      total_amount: n(subtotal - discount),
      created_by: req.user.id,
    }).returning('*');
    await trx('proforma_items').insert(lines.map((l) => ({
      proforma_id: row.id, product_id: l.product.id, product_name: l.product.name, sku: l.product.sku,
      quantity: l.quantity, unit_price: l.unit_price, line_total: l.line_total,
    })));
    await audit(req, {
      action: 'proforma.create', entityType: 'proforma', entityId: row.id,
      newValues: { number, customer: customerName, institution_id: row.institution_id, total_amount: n(row.total_amount), valid_until: body.valid_until, lines: lines.length },
    }, { trx, required: true });
    return present(row, today);
  });
}

async function getProforma(id) {
  const row = await db('proformas as p')
    .leftJoin('users as u', 'u.id', 'p.created_by')
    .leftJoin('users as cv', 'cv.id', 'p.converted_by')
    .leftJoin('users as cn', 'cn.id', 'p.cancelled_by')
    .where('p.id', Number(id) || 0)
    .first('p.*', 'u.full_name as created_by_name', 'cv.full_name as converted_by_name', 'cn.full_name as cancelled_by_name');
  if (!row) throw new AppError('Proforma not found', 404);
  const items = await db('proforma_items').where({ proforma_id: row.id }).orderBy('id');
  const today = shopDate(await getClosingSettings());
  return { ...present(row, today), items: items.map((i) => ({ ...i, unit_price: n(i.unit_price), line_total: n(i.line_total) })) };
}

async function listProformas({ status, institutionId }) {
  const today = shopDate(await getClosingSettings());
  const q = db('proformas as p').leftJoin('users as u', 'u.id', 'p.created_by')
    .select('p.*', 'u.full_name as created_by_name').orderBy('p.id', 'desc').limit(500);
  if (institutionId) q.where('p.institution_id', Number(institutionId) || 0);
  if (status === 'expired') q.where('p.status', 'issued').where('p.valid_until', '<', today);
  else if (status === 'issued') q.where('p.status', 'issued').where('p.valid_until', '>=', today);
  else if (status) q.where('p.status', status);
  return (await q).map((r) => present(r, today));
}

async function cancelProforma({ req, id, reason }) {
  const why = text(reason, 1000);
  if (!why || why.length < 3) throw new AppError('Give a reason for cancelling', 422);
  return db.transaction(async (trx) => {
    const row = await trx('proformas').where({ id: Number(id) || 0 }).forUpdate().first();
    if (!row) throw new AppError('Proforma not found', 404);
    if (row.status !== 'issued') throw new AppError(`This proforma is already ${row.status}`, 409);
    const [updated] = await trx('proformas').where({ id: row.id })
      .update({ status: 'cancelled', cancelled_by: req.user.id, cancelled_at: trx.fn.now(), cancel_reason: why }).returning('*');
    await audit(req, { action: 'proforma.cancel', entityType: 'proforma', entityId: row.id, oldValues: { status: 'issued' }, newValues: { status: 'cancelled', reason: why } }, { trx, required: true });
    return present(updated, shopDate(await getClosingSettings(trx)));
  });
}

/**
 * POST /api/proformas/:id/convert - the customer accepted: make the real sale
 * at the quoted prices and discount. Walk-in proformas need a client chosen
 * now (a sale on account needs an account). Expired proformas cannot be
 * converted - issue a new one with current prices.
 */
async function convertProforma({ req, id, body = {} }) {
  const { createOrder } = require('../models/institutionService');
  return db.transaction(async (trx) => {
    const row = await trx('proformas').where({ id: Number(id) || 0 }).forUpdate().first();
    if (!row) throw new AppError('Proforma not found', 404);
    if (row.status !== 'issued') throw new AppError(`This proforma is already ${row.status}`, 409);
    const today = shopDate(await getClosingSettings(trx));
    if (dateOnly(row.valid_until) < today) throw new AppError('This proforma has expired - issue a new one with current prices', 409);
    const institutionId = row.institution_id || Number(body.institution_id) || null;
    if (!institutionId) throw new AppError('Choose the client this sale is for', 422);
    const items = await trx('proforma_items').where({ proforma_id: row.id }).orderBy('id');

    const order = await createOrder({
      req, trx, institutionId, orderDate: today, dueDate: body.due_date || null, discountAmount: n(row.discount_amount),
      notes: `From proforma ${row.number}`, items: items.map((i) => ({ product_id: i.product_id, quantity: i.quantity, unit_price: n(i.unit_price) })),
      payment: body.payment, creditExceptionId: body.credit_exception_id, creditOverride: body.credit_override,
    });
    if (n(order.total_amount) !== n(row.total_amount)) throw new AppError('The sale total does not match the proforma - nothing was recorded', 409);
    await trx('proformas').where({ id: row.id }).update({ status: 'converted', converted_order_id: order.id, converted_by: req.user.id, converted_at: trx.fn.now() });
    await audit(req, {
      action: 'proforma.convert', entityType: 'proforma', entityId: row.id,
      oldValues: { status: 'issued' }, newValues: { status: 'converted', order_id: order.id, total_amount: n(order.total_amount) },
    }, { trx, required: true });
    return { proforma_id: row.id, number: row.number, order };
  });
}

function proformaPdf(p, { business, timezone, generatedBy }) {
  const { rwf, num, when, table, pairs, heading, note, columns } = pdf;
  const stateLabel = { issued: 'Valid', expired: 'EXPIRED', converted: 'Accepted - converted to a sale', cancelled: 'CANCELLED' }[p.state];
  const content = [
    columns(
      [heading('For'), { text: p.customer_name, bold: true }, p.customer_contact ? { text: p.customer_contact, style: 'small' } : null].filter(Boolean),
      pairs([
        ['Proforma no.', p.number, { bold: true }],
        ['Date', when(p.issue_date, timezone, { time: false })],
        ['Valid until', when(p.valid_until, timezone, { time: false }), { bold: true }],
        ['Status', stateLabel],
      ]),
    ),
    table(
      [{ text: '#', width: 18 }, { text: 'Product' }, { text: 'SKU', width: 70 }, { text: 'Qty', align: 'right', width: 40 }, { text: 'Unit price', align: 'right', width: 80 }, { text: 'Amount', align: 'right', width: 85 }],
      p.items.map((i, idx) => [String(idx + 1), i.product_name, i.sku || '—', num(i.quantity), rwf(i.unit_price), rwf(i.line_total)]),
    ),
    columns(
      [p.payment_terms ? [heading('Payment terms'), { text: p.payment_terms }] : [], p.notes ? [heading('Notes'), { text: p.notes }] : []].flat(),
      pairs([
        ['Subtotal', rwf(p.subtotal)],
        p.discount_amount > 0 && ['Discount', rwf(-p.discount_amount)],
        ['Total proposed price', rwf(p.total_amount), { bold: true }],
      ]),
    ),
    note('This is a proforma invoice: a price proposal, not a demand for payment and not a tax invoice. Prices are held until the date above; the official invoice is issued through EBM at the sale.'),
  ];
  return pdf.layout({
    business,
    title: 'PROFORMA INVOICE',
    subtitle: `${p.number} · for ${p.customer_name}`,
    meta: [['Proforma', p.number], ['Prepared by', p.created_by_name || '—']],
    content,
    generatedBy,
    timezone,
  });
}

async function proformaDocument({ id, format, generatedBy }) {
  const model = await getProforma(id);
  if (format !== 'pdf') return { model };
  const [business, settings] = [await getBusiness(), await getClosingSettings()];
  return { model, pdf: await pdf.render(proformaPdf(model, { business, timezone: settings.timezone, generatedBy })), filename: `${model.number}.pdf` };
}

module.exports = { createProforma, getProforma, listProformas, cancelProforma, convertProforma, proformaDocument, nextNumber };
