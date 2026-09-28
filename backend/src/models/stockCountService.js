// Physical stock counts and their discrepancy approvals.
//
//   start  -> lines saved with each product/location's stock at that moment
//   count  -> counters enter what they see (blind: without the system figure)
//   submit -> expected = snapshot + every movement since; difference and
//             value at cost worked out; STOCK_DISCREPANCY alert if any
//   decide -> a manager who did not count approves (differences posted as
//             'adjustment' movements, shortages also as shrinkage) or rejects
//
// Stock is never overwritten, nothing is deleted, and every step is audited.
const db = require('../config/db');
const { AppError } = require('../utils/AppError');
const { audit } = require('../audit/auditService');
const { emit, actorName } = require('../notifications/notificationService');
const { getRule } = require('../notifications/rules');
const { can } = require('../middleware/rbac');
const { formatRwf } = require('../utils/sanitize');
const { getClosingSettings, shopDate } = require('../businessDay/settings');
const { applyMovement } = require('./stockService');
const { nextNumber } = require('../documents/proformas');
const { n, text } = require('../finance/ledger');

const REASONS = ['miscount', 'theft', 'spoilage', 'other'];
const INCREASING = ['stock_in', 'returned', 'transfer_in'];
const DECREASING = ['sold', 'damaged', 'transfer_out', 'returned_to_supplier'];

/** Starts a count: saves the stock of every line now, with the rows share-locked. */
async function startCount({ req, body = {} }) {
  const scope = body.scope || 'all';
  if (!['all', 'category', 'products'].includes(scope)) throw new AppError('scope must be all, category or products', 422);
  const blind = body.blind === undefined ? true : !!body.blind;
  if (!blind && !can(req, 'stock.count.approve')) throw new AppError('Only a manager can start a count that shows the system quantities', 403);

  return db.transaction(async (trx) => {
    const locations = body.location_id
      ? await trx('stock_locations').where({ id: Number(body.location_id) || 0 })
      : await trx('stock_locations').orderBy('id');
    if (!locations.length) throw new AppError('Location not found', 404);

    // One open count per location at a time: two would post the same difference twice
    const busy = await trx('stock_counts').whereIn('status', ['counting', 'submitted'])
      .where((q) => q.whereNull('location_id').orWhereIn('location_id', locations.map((l) => l.id))).first('number');
    if (busy) throw new AppError(`Count ${busy.number} is still open for this location - finish or cancel it first`, 409);

    const products = trx('products').where({ is_active: true });
    if (scope === 'category') {
      if (!body.category_id) throw new AppError('Choose the category to count', 422);
      products.where({ category_id: Number(body.category_id) || 0 });
    } else if (scope === 'products') {
      const ids = (Array.isArray(body.product_ids) ? body.product_ids : []).map(Number).filter(Boolean);
      if (!ids.length) throw new AppError('Choose at least one product to count', 422);
      products.whereIn('id', ids);
    }
    const list = await products.orderBy('name').select('id');
    if (!list.length) throw new AppError('No active products match this count', 422);

    // Share-lock the stock rows so no sale is half-way through while we read them;
    // the last movement id then marks exactly what the snapshot includes.
    const levels = await trx('stock_levels').whereIn('product_id', list.map((p) => p.id)).whereIn('location_id', locations.map((l) => l.id))
      .forShare().select('product_id', 'location_id', 'quantity');
    const { max } = await trx('stock_movements').max('id as max').first();

    const today = shopDate(await getClosingSettings(trx));
    const number = await nextNumber(trx, 'stock_count', 'SC', today);
    const [count] = await trx('stock_counts').insert({
      number, location_id: body.location_id ? locations[0].id : null, scope, category_id: scope === 'category' ? Number(body.category_id) : null,
      blind, snapshot_movement_id: Number(max) || 0, notes: text(body.notes, 1000), started_by: req.user.id,
    }).returning('*');
    const qty = new Map(levels.map((l) => [`${l.product_id}:${l.location_id}`, l.quantity]));
    const lines = list.flatMap((p) => locations.map((l) => ({ count_id: count.id, product_id: p.id, location_id: l.id, snapshot_qty: qty.get(`${p.id}:${l.id}`) || 0 })));
    for (let i = 0; i < lines.length; i += 500) await trx('stock_count_lines').insert(lines.slice(i, i + 500));
    await audit(req, {
      action: 'stock_count.start', entityType: 'stock_count', entityId: count.id,
      newValues: { number, scope, location_id: count.location_id, blind, lines: lines.length },
    }, { trx, required: true });
    return { ...count, lines: lines.length };
  });
}

/** Net stock change per (product, location) from movements after the snapshot. */
async function movementsSince(trx, count) {
  const rows = await trx('stock_movements as m')
    .leftJoin('stock_count_lines as l', function joinLine() {
      this.on('l.id', '=', 'm.reference_id').andOn(trx.raw("m.reference_type = 'stock_count'"));
    })
    .where('m.id', '>', count.snapshot_movement_id)
    .whereIn(['m.product_id', 'm.location_id'], trx('stock_count_lines').where({ count_id: count.id }).select('product_id', 'location_id'))
    .select('m.product_id', 'm.location_id', 'm.type', 'm.quantity', 'l.variance');
  const net = new Map();
  for (const r of rows) {
    let change = 0;
    if (INCREASING.includes(r.type)) change = r.quantity;
    else if (DECREASING.includes(r.type)) change = -r.quantity;
    else if (r.type === 'adjustment') change = r.variance === null ? 0 : Math.sign(r.variance) * r.quantity; // only counts post adjustments
    const key = `${r.product_id}:${r.location_id}`;
    net.set(key, (net.get(key) || 0) + change);
  }
  return net;
}

async function loadCount(trx, id, { lock = false } = {}) {
  const q = trx('stock_counts').where({ id: Number(id) || 0 });
  if (lock) q.forUpdate();
  const count = await q.first();
  if (!count) throw new AppError('Stock count not found', 404);
  return count;
}

/** GET /api/stock-counts/:id - blind counts hide the system figures from counters until submitted. */
async function getCount({ req, id }) {
  const count = await loadCount(db, id);
  const lines = await db('stock_count_lines as l')
    .join('products as p', 'p.id', 'l.product_id')
    .join('stock_locations as s', 's.id', 'l.location_id')
    .leftJoin('categories as c', 'c.id', 'p.category_id')
    .where('l.count_id', count.id)
    .orderBy('p.name').orderBy('s.id')
    .select('l.*', 'p.name as product_name', 'p.sku', 'p.cost_price', 'c.name as category', 's.name as location');
  const people = new Map((await db('users').whereIn('id', [count.started_by, count.submitted_by, count.decided_by].filter(Boolean)).select('id', 'full_name')).map((u) => [u.id, u.full_name]));
  const hideSystem = count.blind && count.status === 'counting' && !can(req, 'stock.count.approve');
  let live = null;
  if (!hideSystem && count.status === 'counting') live = await movementsSince(db, count);
  return {
    ...count,
    shortage_value: count.shortage_value === null ? null : n(count.shortage_value),
    overage_value: count.overage_value === null ? null : n(count.overage_value),
    started_by_name: people.get(count.started_by) || null,
    submitted_by_name: people.get(count.submitted_by) || null,
    decided_by_name: people.get(count.decided_by) || null,
    system_hidden: hideSystem,
    lines: lines.map((l) => {
      const base = {
        id: l.id, product_id: l.product_id, product_name: l.product_name, sku: l.sku, category: l.category, location: l.location, location_id: l.location_id,
        counted_qty: l.counted_qty, counted_by: l.counted_by, reason: l.reason, note: l.note, counted_at: l.counted_at,
      };
      if (hideSystem) return base;
      const expected = l.expected_qty ?? (l.snapshot_qty + (live?.get(`${l.product_id}:${l.location_id}`) || 0));
      return {
        ...base,
        snapshot_qty: l.snapshot_qty,
        expected_qty: expected,
        variance: l.variance ?? (l.counted_qty === null ? null : l.counted_qty - expected),
        unit_cost: n(l.unit_cost ?? l.cost_price),
        variance_value: l.variance_value !== null ? n(l.variance_value) : (l.counted_qty === null ? null : n((l.counted_qty - expected) * Number(l.cost_price))),
      };
    }),
  };
}

async function listCounts({ status }) {
  const q = db('stock_counts as c').leftJoin('stock_locations as s', 's.id', 'c.location_id').leftJoin('users as u', 'u.id', 'c.started_by')
    .select('c.*', 's.name as location', 'u.full_name as started_by_name',
      db.raw('(SELECT COUNT(*)::int FROM stock_count_lines l WHERE l.count_id = c.id) AS line_count'),
      db.raw('(SELECT COUNT(*)::int FROM stock_count_lines l WHERE l.count_id = c.id AND l.counted_qty IS NOT NULL) AS counted_count'))
    .orderBy('c.id', 'desc').limit(200);
  if (status) q.where('c.status', status);
  return (await q).map((c) => ({ ...c, shortage_value: c.shortage_value === null ? null : n(c.shortage_value), overage_value: c.overage_value === null ? null : n(c.overage_value) }));
}

/** PUT /api/stock-counts/:id/lines { lines: [{ id, counted_qty, reason, note }] } - while counting. */
async function saveLines({ req, id, lines }) {
  if (!Array.isArray(lines) || !lines.length) throw new AppError('Send at least one counted line', 422);
  return db.transaction(async (trx) => {
    const count = await loadCount(trx, id, { lock: true });
    if (count.status !== 'counting') throw new AppError(`This count is ${count.status} - it can no longer be changed`, 409);
    for (const l of lines) {
      const update = {};
      if (l.counted_qty !== undefined) {
        if (l.counted_qty === null || l.counted_qty === '') update.counted_qty = null;
        else {
          const v = Number(l.counted_qty);
          if (!Number.isInteger(v) || v < 0 || v > 1e7) throw new AppError('Counted quantities must be whole numbers, 0 or more', 422);
          update.counted_qty = v;
        }
        update.counted_by = update.counted_qty === null ? null : req.user.id;
        update.counted_at = update.counted_qty === null ? null : trx.fn.now();
      }
      if (l.reason !== undefined) {
        if (l.reason && !REASONS.includes(l.reason)) throw new AppError(`reason must be one of: ${REASONS.join(', ')}`, 422);
        update.reason = l.reason || null;
      }
      if (l.note !== undefined) update.note = text(l.note, 500);
      if (!Object.keys(update).length) continue;
      const done = await trx('stock_count_lines').where({ id: Number(l.id) || 0, count_id: count.id }).update(update);
      if (!done) throw new AppError(`Line ${l.id} is not part of this count`, 422);
    }
    return { saved: lines.length };
  });
}

/** POST /api/stock-counts/:id/submit - works out the differences and alerts if there are any. */
async function submitCount({ req, id }) {
  return db.transaction(async (trx) => {
    const count = await loadCount(trx, id, { lock: true });
    if (count.status !== 'counting') throw new AppError(`This count is already ${count.status}`, 409);
    const lines = await trx('stock_count_lines as l').join('products as p', 'p.id', 'l.product_id')
      .where('l.count_id', count.id).select('l.*', 'p.cost_price', 'p.name as product_name');
    const uncounted = lines.filter((l) => l.counted_qty === null);
    if (uncounted.length) throw new AppError(`${uncounted.length} line(s) are not counted yet - enter 0 for items that are not there`, 422);
    const net = await movementsSince(trx, count);

    let shortage = 0;
    let overage = 0;
    let differing = 0;
    const missingReason = [];
    for (const l of lines) {
      const expected = l.snapshot_qty + (net.get(`${l.product_id}:${l.location_id}`) || 0);
      const variance = l.counted_qty - expected;
      const value = n(variance * Number(l.cost_price));
      if (variance !== 0) {
        differing += 1;
        if (!l.reason) missingReason.push(l.product_name);
        if (value < 0) shortage = n(shortage - value);
        else overage = n(overage + value);
      }
      await trx('stock_count_lines').where({ id: l.id }).update({ expected_qty: expected, variance, unit_cost: n(l.cost_price), variance_value: value });
    }
    if (missingReason.length) {
      throw new AppError(`Give a reason for each difference (${missingReason.slice(0, 5).join(', ')}${missingReason.length > 5 ? '…' : ''})`, 422);
    }

    // Nothing to correct: closes itself. Otherwise it waits for a manager.
    const status = differing ? 'submitted' : 'approved';
    const [updated] = await trx('stock_counts').where({ id: count.id }).update({
      status, submitted_by: req.user.id, submitted_at: trx.fn.now(), lines_with_difference: differing, shortage_value: shortage, overage_value: overage,
      ...(!differing && { decision_note: 'No differences - nothing to correct' }),
    }).returning('*');
    await audit(req, {
      action: 'stock_count.submit', entityType: 'stock_count', entityId: count.id,
      newValues: { number: count.number, lines: lines.length, lines_with_difference: differing, shortage_value: shortage, overage_value: overage },
    }, { trx, required: true });

    if (differing) {
      const rule = await getRule(trx, 'STOCK_DISCREPANCY');
      const critical = n(shortage + overage) >= Number(rule.thresholds?.critical_value_rwf ?? 50000);
      await emit(trx, {
        type: 'STOCK_DISCREPANCY', dedupKey: `STOCK_DISCREPANCY:${count.id}`, entityType: 'stock_count', entityId: count.id, actorUserId: req.user.id,
        severity: critical ? 'critical' : 'warning',
        params: {
          count_number: count.number, lines: differing, shortage_rwf: formatRwf(shortage), overage_rwf: formatRwf(overage), actor_name: await actorName(trx, req.user.id),
        },
      });
    }
    return updated;
  });
}

/**
 * POST /api/stock-counts/:id/decision { decision: approve|reject, note } -
 * a manager who took no part in the count. Approving posts each difference.
 */
async function decideCount({ req, id, decision, note }) {
  if (!['approve', 'reject'].includes(decision)) throw new AppError('decision must be approve or reject', 422);
  const why = text(note, 1000);
  if (decision === 'reject' && (!why || why.length < 3)) throw new AppError('Give a reason for rejecting the count', 422);
  return db.transaction(async (trx) => {
    const count = await loadCount(trx, id, { lock: true });
    if (count.status !== 'submitted') throw new AppError(`This count is ${count.status}, not waiting for a decision`, 409);
    const lines = await trx('stock_count_lines').where({ count_id: count.id }).orderBy('id');
    const counters = new Set([count.started_by, count.submitted_by, ...lines.map((l) => l.counted_by)].filter(Boolean));
    if (counters.has(req.user.id)) throw new AppError('You took part in this count - another manager must decide it', 403);

    if (decision === 'approve') {
      for (const l of lines.filter((x) => x.variance !== 0)) {
        await applyMovement({
          productId: l.product_id, locationId: l.location_id, type: 'adjustment', delta: l.variance,
          referenceType: 'stock_count', referenceId: l.id, performedBy: req.user.id, notes: `Stock count ${count.number}: ${l.reason}${l.note ? ` - ${l.note}` : ''}`,
        }, trx);
        if (l.variance < 0) {
          await trx('shrinkage_records').insert({
            product_id: l.product_id, quantity: -l.variance, cause: l.reason, recorded_by: req.user.id,
            recorded_date: require('../businessDay/settings').shopToday(), notes: `Stock count ${count.number}${l.note ? `: ${l.note}` : ''}`,
          });
        }
      }
    }
    const [updated] = await trx('stock_counts').where({ id: count.id }).update({
      status: decision === 'approve' ? 'approved' : 'rejected', decided_by: req.user.id, decided_at: trx.fn.now(), decision_note: why,
    }).returning('*');
    await audit(req, {
      action: `stock_count.${decision}`, entityType: 'stock_count', entityId: count.id,
      oldValues: { status: 'submitted' },
      newValues: { status: updated.status, note: why, adjustments: decision === 'approve' ? lines.filter((x) => x.variance !== 0).length : 0 },
    }, { trx, required: true });
    await emit(trx, {
      type: 'STOCK_COUNT_DECIDED', dedupKey: `STOCK_COUNT_DECIDED:${count.id}`, entityType: 'stock_count', entityId: count.id, actorUserId: req.user.id,
      targetUserIds: [...counters], severity: decision === 'reject' ? 'warning' : 'info',
      params: {
        count_number: count.number, decision: decision === 'approve' ? 'approved' : 'rejected', reviewer_name: await actorName(trx, req.user.id), note: why || '',
      },
    });
    return updated;
  });
}

/** POST /api/stock-counts/:id/cancel { reason } - an open count abandoned (nothing is posted). */
async function cancelCount({ req, id, reason }) {
  const why = text(reason, 1000);
  if (!why || why.length < 3) throw new AppError('Give a reason for cancelling the count', 422);
  return db.transaction(async (trx) => {
    const count = await loadCount(trx, id, { lock: true });
    if (count.status !== 'counting') throw new AppError(`Only a count still being counted can be cancelled (this one is ${count.status})`, 409);
    if (count.started_by !== req.user.id && !can(req, 'stock.count.approve')) throw new AppError('Only whoever started the count or a manager can cancel it', 403);
    const [updated] = await trx('stock_counts').where({ id: count.id }).update({ status: 'cancelled', decision_note: why }).returning('*');
    await audit(req, { action: 'stock_count.cancel', entityType: 'stock_count', entityId: count.id, oldValues: { status: 'counting' }, newValues: { status: 'cancelled', reason: why } }, { trx, required: true });
    return updated;
  });
}

module.exports = { startCount, getCount, listCounts, saveLines, submitCount, decideCount, cancelCount, REASONS };
