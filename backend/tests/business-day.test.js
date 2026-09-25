const request = require('supertest');
const app = require('../src/app');
const db = require('../src/config/db');
const worker = require('../src/notifications/worker');
const { resetDb, createUser, loginAs, createProduct, ownerDb, openBusinessDay, eventsOfType, inbox } = require('./helpers');

const kigaliDate = (offsetDays = 0) => {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Kigali' }).format(d);
};
const kigaliTime = (offsetMinutes = 0) => new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Africa/Kigali', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
}).format(new Date(Date.now() + offsetMinutes * 60000));

async function staff() {
  const cashier = await createUser('cashier', { full_name: 'Alice Cashier' });
  const cashier2 = await createUser('cashier', { full_name: 'Bob Cashier' });
  const keeper = await createUser('store_keeper', { full_name: 'Kevin Keeper' });
  const manager = await createUser('store_manager', { full_name: 'Grace Manager' });
  const manager2 = await createUser('store_manager', { full_name: 'Paul Manager' });
  return {
    cashier, cashier2, keeper, manager, manager2,
    c: await loginAs(app, cashier), c2: await loginAs(app, cashier2), k: await loginAs(app, keeper),
    m: await loginAs(app, manager), m2: await loginAs(app, manager2),
  };
}

async function sell(agent, productId, qty, method) {
  const res = await agent.post('/api/sales').send({ payment_method: method, items: [{ product_id: productId, quantity: qty }] });
  expect([res.status, res.body.error]).toEqual([201, undefined]);
  return res.body;
}

/** A past-dated open day (so "today" can still be opened afterwards), with a known float. */
async function yesterdayOpen(float = 10000, openedBy = null) {
  return openBusinessDay({ date: kigaliDate(-1), openingFloat: float, openedBy });
}

async function closeWith(agent, counted, explanation) {
  expect((await agent.post('/api/business-days/current/closing/start')).status).toBe(200);
  return agent.post('/api/business-days/current/closing/submit').send({ counted_cash: counted, explanation });
}

describe('opening the business day', () => {
  beforeEach(() => resetDb({ openDay: false }));

  test('no sales or refunds without an open day, and the day is never auto-opened', async () => {
    const s = await staff();
    const p = await createProduct({ shelf: 10 });
    const res = await s.c.post('/api/sales').send({ payment_method: 'cash', items: [{ product_id: p.id, quantity: 1 }] });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/No business day is open/);
    expect(await ownerDb()('business_days')).toHaveLength(0);
  });

  test('cashier opens the day (audited); duplicates and store keepers are refused', async () => {
    const s = await staff();
    expect((await s.k.post('/api/business-days/open').send({ opening_float: 5000 })).status).toBe(403);
    const res = await s.c.post('/api/business-days/open').send({ opening_float: 5000 });
    expect(res.status).toBe(201);
    expect(res.body.business_date).toBeDefined();
    expect((await s.m.post('/api/business-days/open').send({ opening_float: 0 })).status).toBe(409);
    const [row] = await ownerDb()('audit_logs').where({ action: 'day.open' });
    expect(row.actor_user_id).toBe(s.cashier.id);
    expect(row.new_values.opening_float).toBe(5000);
  });

  test('the same calendar date cannot be opened twice', async () => {
    const s = await staff();
    await s.c.post('/api/business-days/open').send({ opening_float: 0 });
    await closeWith(s.c, 0);
    const again = await s.c.post('/api/business-days/open').send({ opening_float: 0 });
    expect(again.status).toBe(409);
    expect(again.body.error).toMatch(/already been opened and closed/);
  });

  test('invalid opening float is rejected', async () => {
    const s = await staff();
    expect((await s.c.post('/api/business-days/open').send({ opening_float: -5 })).status).toBe(422);
    expect((await s.c.post('/api/business-days/open').send({ opening_float: 'abc' })).status).toBe(422);
  });

  test('legacy payment methods are no longer accepted', async () => {
    const s = await staff();
    await s.c.post('/api/business-days/open').send({ opening_float: 0 });
    const p = await createProduct({ shelf: 10 });
    const res = await s.c.post('/api/sales').send({ payment_method: 'mobile_money', items: [{ product_id: p.id, quantity: 1 }] });
    expect(res.status).toBe(400);
  });
});

describe('closing and reconciliation', () => {
  beforeEach(() => resetDb({ openDay: false }));

  async function tradingDay() {
    const s = await staff();
    const day = await yesterdayOpen(10000, s.cashier.id);
    const p = await createProduct({ shelf: 100, price: 1000 });
    await sell(s.c, p.id, 5, 'cash'); // 5,000
    await sell(s.c2, p.id, 3, 'mtn_mobile_money'); // 3,000
    await sell(s.c, p.id, 2, 'airtel_money'); // 2,000
    await sell(s.c2, p.id, 4, 'card'); // 4,000
    const cashSale = await sell(s.c, p.id, 2, 'cash'); // 2,000
    await s.c.post('/api/returns').send({ sale_item_id: cashSale.items[0].id, quantity: 1, restocked: true }); // cash refund 1,000
    const voided = await sell(s.c, p.id, 1, 'cash');
    await s.m.post(`/api/sales/${voided.id}/void`);
    return { s, day, p };
  }

  test('expected cash = opening float + cash sales - cash refunds; methods reported separately', async () => {
    const { s } = await tradingDay();
    await s.c.post('/api/business-days/current/closing/start');
    const preview = await s.c.get('/api/business-days/current/closing/preview');
    expect(preview.status).toBe(200);
    const f = preview.body.figures;
    expect(f.payment_methods).toEqual({ cash: 7000, mtn_mobile_money: 3000, airtel_money: 2000, card: 4000 });
    expect(f.sales).toMatchObject({ gross: 16000, refunds: 1000, net: 15000, transactions: 5, void_count: 1 });
    expect(f.cash).toEqual({ opening_float: 10000, cash_sales: 7000, cash_refunds: 1000, expected_cash: 16000 });
    expect(f.per_cashier).toBeUndefined();
  });

  test('closing blocks sales; cancelling resumes them', async () => {
    const { s, p } = await tradingDay();
    await s.c.post('/api/business-days/current/closing/start');
    const blocked = await s.c2.post('/api/sales').send({ payment_method: 'cash', items: [{ product_id: p.id, quantity: 1 }] });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toMatch(/Closing is in progress/);
    expect((await s.c.post('/api/business-days/current/closing/cancel')).status).toBe(200);
    await sell(s.c2, p.id, 1, 'cash');
  });

  test('variance within tolerance is auto-accepted but still recorded', async () => {
    const { s, day } = await tradingDay();
    const res = await closeWith(s.c, 15500); // expected 16,000 -> -500
    expect(res.status).toBe(201);
    expect(res.body.closing).toMatchObject({ variance: -500, variance_band: 'normal', expected_cash: 16000 });
    expect(res.body.day.status).toBe('closed');
    const closing = await ownerDb()('daily_closings').where({ business_day_id: day.id }).first();
    expect(Number(closing.variance)).toBe(-500);
    const actions = await ownerDb()('audit_logs').whereIn('action', ['day.closing_submit', 'day.auto_accept']).pluck('action');
    expect(actions.sort()).toEqual(['day.auto_accept', 'day.closing_submit']);
    expect((await inbox(s.cashier.id)).map((n) => n.type)).toContain('CLOSING_ACCEPTED');
  });

  test('attention band requires an explanation', async () => {
    const { s } = await tradingDay();
    const missing = await closeWith(s.c, 18000); // +2,000
    expect(missing.status).toBe(422);
    const ok = await s.c.post('/api/business-days/current/closing/submit').send({ counted_cash: 18000, explanation: 'Customer overpaid, will refund' });
    expect(ok.status).toBe(201);
    expect(ok.body.closing.variance_band).toBe('attention');
    expect(ok.body.day.status).toBe('closed');
    expect(await eventsOfType('CASH_VARIANCE_ATTENTION')).toHaveLength(1);
  });

  test('critical variance waits for a different manager; submitter cannot approve own exception', async () => {
    const { s, day } = await tradingDay();
    const res = await closeWith(s.c, 1000, 'Till was short'); // -15,000
    expect(res.body.closing.variance_band).toBe('critical');
    expect(res.body.day.status).toBe('closing_submitted');
    expect((await s.c.post(`/api/business-days/${day.id}/accept`)).status).toBe(403); // cashier lacks day.review
    const critical = await eventsOfType('CASH_VARIANCE_CRITICAL');
    expect(critical).toHaveLength(1);
    const recipients = await ownerDb()('notifications').where({ event_id: critical[0].id }).pluck('recipient_user_id');
    expect(recipients.sort()).toEqual([s.cashier.id, s.manager.id, s.manager2.id].sort());

    const accepted = await s.m.post(`/api/business-days/${day.id}/accept`).send({ note: 'Checked CCTV, cash was mis-bagged' });
    expect(accepted.status).toBe(200);
    expect(accepted.body.status).toBe('closed');
    expect(accepted.body.acceptance).toBe('manager');
  });

  test('a manager who submitted a critical closing cannot accept it', async () => {
    const s = await staff();
    const day = await yesterdayOpen(0);
    await closeWith(s.m, 50000, 'test');
    expect((await s.m.post(`/api/business-days/${day.id}/accept`)).status).toBe(403);
    expect((await s.m2.post(`/api/business-days/${day.id}/accept`)).status).toBe(200);
  });

  test('duplicate and concurrent submissions produce exactly one closing', async () => {
    const { s, day } = await tradingDay();
    await s.c.post('/api/business-days/current/closing/start');
    const results = await Promise.all([s.c, s.c2, s.m, s.m2, s.c].map((a) =>
      a.post('/api/business-days/current/closing/submit').send({ counted_cash: 16000 })));
    expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409, 409, 409]);
    expect(await ownerDb()('daily_closings').where({ business_day_id: day.id })).toHaveLength(1);
    const again = await s.c.post('/api/business-days/current/closing/submit').send({ counted_cash: 16000 });
    expect(again.status).toBe(409);
  });

  test('recount keeps the original closing and adds a new version', async () => {
    const { s, day } = await tradingDay();
    await closeWith(s.c, 1000, 'short');
    expect((await s.m.post(`/api/business-days/${day.id}/recount`).send({ reason: 'Count the safe too' })).status).toBe(200);
    expect((await s.m.post(`/api/business-days/${day.id}/accept`)).status).toBe(409); // must wait for the recount
    expect((await inbox(s.cashier.id)).map((n) => n.type)).toContain('RECOUNT_REQUESTED');
    const recount = await s.c.post('/api/business-days/current/closing/submit').send({ counted_cash: 16000 });
    expect(recount.status).toBe(201);
    expect(recount.body.closing.version).toBe(2);
    expect(recount.body.day.status).toBe('closed');
    const versions = await ownerDb()('daily_closings').where({ business_day_id: day.id }).orderBy('version');
    expect(versions.map((v) => Number(v.counted_cash))).toEqual([1000, 16000]);
    expect(versions[1].supersedes_id).toBe(versions[0].id);
  });
});

describe('closed periods are immutable', () => {
  beforeEach(() => resetDb({ openDay: false }));

  async function closedYesterdayThenOpenToday() {
    const s = await staff();
    const yesterday = await yesterdayOpen(0);
    const p = await createProduct({ shelf: 100, price: 1000 });
    const oldSale = await sell(s.c, p.id, 3, 'cash');
    await closeWith(s.c, 3000);
    expect((await s.c.post('/api/business-days/open').send({ opening_float: 0 })).status).toBe(201);
    return { s, yesterday, p, oldSale };
  }

  test("yesterday's sale can't be voided; it can be refunded as today's transaction", async () => {
    const { s, oldSale, yesterday } = await closedYesterdayThenOpenToday();
    const voidRes = await s.m.post(`/api/sales/${oldSale.id}/void`);
    expect(voidRes.status).toBe(409);
    expect(voidRes.body.error).toMatch(/closed business day/);

    const refund = await s.c.post('/api/returns').send({ sale_item_id: oldSale.items[0].id, quantity: 1, restocked: true });
    expect(refund.status).toBe(201);
    const row = await ownerDb()('returns').where({ id: refund.body.id }).first();
    expect(row.business_day_id).not.toBe(yesterday.id);
    expect(Number(row.refund_amount)).toBe(1000);
    expect(row.refund_method).toBe('cash');
  });

  test('the database refuses changes to closed-day rows and backdated inserts', async () => {
    const { s, oldSale, yesterday } = await closedYesterdayThenOpenToday();
    await expect(db('sales').where({ id: oldSale.id }).update({ total_amount: 1 })).rejects.toThrow(/business_day_closed/);
    await expect(db('sales').where({ id: oldSale.id }).del()).rejects.toThrow(/business_day_closed/);
    await expect(db('sale_items').where({ sale_id: oldSale.id }).update({ quantity: 1 })).rejects.toThrow(/business_day_closed/);
    await expect(db('sales').insert({ cashier_id: s.cashier.id, total_amount: 5, payment_method: 'cash', business_day_id: yesterday.id }))
      .rejects.toThrow(/business_day_closed/);
    await expect(db('sales').insert({ cashier_id: s.cashier.id, total_amount: 5, payment_method: 'cash' }))
      .rejects.toThrow(/business_day_closed/);
  });

  test('closing snapshots and adjustments are append-only for the API role', async () => {
    const { yesterday } = await closedYesterdayThenOpenToday();
    await expect(db('daily_closings').where({ business_day_id: yesterday.id }).update({ counted_cash: 1 })).rejects.toThrow(/permission denied/);
    await expect(db('daily_closings').del()).rejects.toThrow(/permission denied/);
    await expect(ownerDb()('daily_closings').del()).rejects.toThrow(/append-only/);
  });

  test("yesterday's board comes from the snapshot, unaffected by later activity or renames", async () => {
    const { s, p } = await closedYesterdayThenOpenToday();
    const before = (await s.m.get('/api/business-days/dashboard')).body.last;
    await sell(s.c, p.id, 5, 'cash');
    await ownerDb()('users').where({ id: s.cashier.id }).update({ full_name: 'Renamed Person' });
    const after = (await s.m.get('/api/business-days/dashboard')).body.last;
    expect(after.figures.sales).toEqual(before.figures.sales);
    expect(after.people.submitted_by.name).toBe('Alice Cashier');
    expect(after.figures.payment_methods).toEqual(before.figures.payment_methods);
  });
});

describe('corrections and adjustments', () => {
  beforeEach(() => resetDb({ openDay: false }));

  async function closedDay() {
    const s = await staff();
    const day = await yesterdayOpen(0);
    const p = await createProduct({ shelf: 100, price: 1000 });
    await sell(s.c, p.id, 5, 'cash');
    await closeWith(s.c, 5000);
    return { s, day };
  }

  test('approved correction creates an adjustment; original closing is untouched', async () => {
    const { s, day } = await closedDay();
    const req1 = await s.c.post('/api/corrections').send({ business_day_id: day.id, field: 'counted_cash', requested_value: 5400, reason: 'Found 400 in the drawer tray' });
    expect(req1.status).toBe(201);
    expect(Number(req1.body.original_value)).toBe(5000);
    const dup = await s.c.post('/api/corrections').send({ business_day_id: day.id, field: 'counted_cash', requested_value: 5500, reason: 'again' });
    expect(dup.status).toBe(409);

    expect((await s.c.post(`/api/corrections/${req1.body.id}/decision`).send({ decision: 'approve' })).status).toBe(403);
    const decided = await s.m.post(`/api/corrections/${req1.body.id}/decision`).send({ decision: 'approve', reason: 'Verified' });
    expect(decided.status).toBe(200);
    expect(Number(decided.body.adjustment.delta)).toBe(400);

    const closing = await ownerDb()('daily_closings').where({ business_day_id: day.id }).first();
    expect(Number(closing.counted_cash)).toBe(5000);
    const board = (await s.m.get(`/api/business-days/${day.id}`)).body;
    expect(board.day.status).toBe('closed_with_adjustment');
    expect(board.corrected.values.counted_cash).toEqual({ original: 5000, delta: 400, corrected: 5400 });
    expect(board.corrected.variance).toBe(400);
    expect(board.adjustments[0]).toMatchObject({ requested_by_name: 'Alice Cashier', approved_by_name: 'Grace Manager' });

    const trail = await ownerDb()('audit_logs').whereIn('action', ['correction.request', 'correction.approve', 'adjustment.apply']).orderBy('id').pluck('action');
    expect(trail).toEqual(['correction.request', 'correction.approve', 'adjustment.apply']);
    expect((await inbox(s.cashier.id)).map((n) => n.type)).toContain('CORRECTION_DECIDED');
  });

  test('rejection needs a reason; nobody reviews their own request (enforced by the DB too)', async () => {
    const { s, day } = await closedDay();
    const own = await s.m.post('/api/corrections').send({ business_day_id: day.id, field: 'card', requested_value: 100, reason: 'Card slip missed' });
    expect(own.status).toBe(201);
    expect((await s.m.post(`/api/corrections/${own.body.id}/decision`).send({ decision: 'approve' })).status).toBe(403);
    expect((await s.m2.post(`/api/corrections/${own.body.id}/decision`).send({ decision: 'reject' })).status).toBe(422);
    const rejected = await s.m2.post(`/api/corrections/${own.body.id}/decision`).send({ decision: 'reject', reason: 'No slip found' });
    expect(rejected.body.request.status).toBe('rejected');
    expect(await ownerDb()('closing_adjustments')).toHaveLength(0);
    await expect(ownerDb()('closing_correction_requests').where({ id: own.body.id }).update({ reviewed_by: s.manager.id }))
      .rejects.toThrow(/correction_not_self_reviewed/);
  });

  test('store keepers cannot request financial corrections; cashiers only list their own', async () => {
    const { s, day } = await closedDay();
    expect((await s.k.post('/api/corrections').send({ business_day_id: day.id, field: 'counted_cash', requested_value: 1, reason: 'xxxxx' })).status).toBe(403);
    await s.m.post('/api/corrections').send({ business_day_id: day.id, field: 'card', requested_value: 10, reason: 'manager one' });
    await s.c2.post('/api/corrections').send({ business_day_id: day.id, field: 'counted_cash', requested_value: 10, reason: 'bob one' });
    const mine = await s.c2.get('/api/corrections');
    expect(mine.body.map((r) => r.reason)).toEqual(['bob one']);
    expect((await s.m2.get('/api/corrections')).body).toHaveLength(2);
  });
});

describe('reopening', () => {
  beforeEach(() => resetDb({ openDay: false }));

  test('manager-only, reason required, audited, critical alert, new closing version', async () => {
    const s = await staff();
    const day = await yesterdayOpen(0);
    await closeWith(s.c, 0);
    expect((await s.c.post(`/api/business-days/${day.id}/reopen`).send({ reason: 'I want to fix it' })).status).toBe(403);
    expect((await s.m.post(`/api/business-days/${day.id}/reopen`).send({ reason: 'short' })).status).toBe(422);
    const res = await s.m.post(`/api/business-days/${day.id}/reopen`).send({ reason: 'Missed recording three sales from the paper log' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('open');
    expect(await eventsOfType('BUSINESS_DAY_REOPENED')).toHaveLength(1);
    expect(await ownerDb()('audit_logs').where({ action: 'day.reopen' })).toHaveLength(1);

    const p = await createProduct({ shelf: 10, price: 500 });
    await sell(s.c, p.id, 2, 'cash');
    const again = await closeWith(s.c, 1000);
    expect(again.body.closing.version).toBe(2);
    const board = (await s.m.get(`/api/business-days/${day.id}`)).body;
    expect(board.health.status).toBe('critical');
    expect(board.health.reasons).toContain('reopened');
  });

  test('only the most recent day, and not while another day is open', async () => {
    const s = await staff();
    const day = await yesterdayOpen(0);
    await closeWith(s.c, 0);
    await s.c.post('/api/business-days/open').send({ opening_float: 0 });
    const res = await s.m.post(`/api/business-days/${day.id}/reopen`).send({ reason: 'Trying to reopen while today is open' });
    expect(res.status).toBe(409);
  });
});

describe('dashboard boards', () => {
  beforeEach(() => resetDb({ openDay: false }));

  test('names on both boards; cashiers get shop-level totals only; clear comparisons', async () => {
    const s = await staff();
    const yesterday = await yesterdayOpen(2000, s.cashier2.id);
    const p = await createProduct({ shelf: 100, price: 1000, reorder: 5 });
    await sell(s.c, p.id, 2, 'cash');
    await sell(s.c2, p.id, 1, 'airtel_money');
    await closeWith(s.c, 4000);
    await s.c2.post('/api/business-days/open').send({ opening_float: 500 });
    await sell(s.c2, p.id, 1, 'card');

    const cashierView = (await s.c.get('/api/business-days/dashboard')).body;
    expect(cashierView.last.people.opened_by.name).toBe('Bob Cashier');
    expect(cashierView.last.people.closing_requested_by.name).toBe('Alice Cashier');
    expect(cashierView.last.people.submitted_by.name).toBe('Alice Cashier');
    expect(cashierView.last.people.worked).toEqual(['Alice Cashier', 'Bob Cashier']);
    expect(cashierView.today.people.opened_by.name).toBe('Bob Cashier');
    expect(cashierView.last.figures.payment_methods).toEqual({ cash: 2000, mtn_mobile_money: 0, airtel_money: 1000, card: 0 });
    expect(cashierView.today.figures.payment_methods.card).toBe(1000);
    expect(cashierView.last.figures.per_cashier).toBeUndefined();
    expect(cashierView.today.figures.per_cashier).toBeUndefined();
    expect(JSON.stringify(cashierView)).not.toMatch(/cost_price|profit|cogs/);
    expect(cashierView.comparison.same_time).toHaveProperty('slot');
    expect(cashierView.comparison.last_full_day).toEqual({ sales: 3000, transactions: 2 });

    const managerView = (await s.m.get('/api/business-days/dashboard')).body;
    expect(managerView.last.figures.per_cashier.map((r) => r.name).sort()).toEqual(['Alice Cashier', 'Bob Cashier']);
    expect((await s.c.get(`/api/business-days/${yesterday.id}`)).status).toBe(403);
    expect((await s.k.get('/api/business-days/dashboard')).status).toBe(200);
  });

  test('timeline lists the day in order (managers only)', async () => {
    const s = await staff();
    const day = await yesterdayOpen(0);
    const p = await createProduct({ shelf: 10, price: 1000 });
    await sell(s.c, p.id, 1, 'cash');
    await closeWith(s.c, 1000);
    expect((await s.c.get(`/api/business-days/${day.id}/timeline`)).status).toBe(403);
    const tl = (await s.m.get(`/api/business-days/${day.id}/timeline`)).body.items.map((i) => i.code);
    expect(tl).toEqual(expect.arrayContaining(['first_sale', 'day.closing_start', 'day.closing_submit', 'day.auto_accept']));
    expect(tl.indexOf('first_sale')).toBeLessThan(tl.indexOf('day.closing_submit'));
  });
});

describe('closing schedule and settings', () => {
  beforeEach(() => resetDb({ openDay: false }));

  async function setClosingTime(m, time, extra = {}) {
    const res = await m.put('/api/admin/closing-settings').send({ expected_closing_time: time, ...extra });
    expect(res.status).toBe(200);
  }

  test('reminder before closing time, once', async () => {
    const s = await staff();
    await openBusinessDay({ date: kigaliDate(0) });
    await setClosingTime(s.m, kigaliTime(10), { reminder_lead_minutes: 30 });
    expect(await worker.checkBusinessDay()).toEqual(['reminder']);
    expect(await worker.checkBusinessDay()).toEqual([]);
    const recipients = await ownerDb()('notifications').join('notification_events', 'notification_events.id', 'notifications.event_id')
      .where('notification_events.type', 'CLOSING_REMINDER').pluck('recipient_user_id');
    expect(recipients.sort()).toEqual([s.cashier.id, s.cashier2.id, s.manager.id, s.manager2.id].sort());
  });

  test('due, then critical after the configured delay, with an audit event', async () => {
    const s = await staff();
    await openBusinessDay({ date: kigaliDate(-1) }); // yesterday, still open
    await setClosingTime(s.m, '20:00', { critical_delay_minutes: 120 });
    const fired = await worker.checkBusinessDay();
    expect(fired).toEqual(expect.arrayContaining(['due', 'critical']));
    expect(await worker.checkBusinessDay()).toEqual([]);
    expect(await ownerDb()('audit_logs').where({ action: 'day.left_open_critical' })).toHaveLength(1);
    const dashboard = (await s.m.get('/api/business-days/dashboard')).body;
    expect(dashboard.today.closing_schedule.state).toBe('overdue_critical');
    expect(dashboard.today.health.status).toBe('critical');
  });

  test('settings are validated and every change is audited', async () => {
    const s = await staff();
    expect((await s.m.put('/api/admin/closing-settings').send({ expected_closing_time: '25:00' })).status).toBe(422);
    expect((await s.m.put('/api/admin/closing-settings').send({ attention_variance_rwf: 5000, critical_variance_rwf: 100 })).status).toBe(422);
    expect((await s.m.put('/api/admin/closing-settings').send({ timezone: 'Mars/Olympus' })).status).toBe(422);
    await setClosingTime(s.m, '22:30');
    const [row] = await ownerDb()('audit_logs').where({ action: 'closing_settings.update' });
    expect(row.old_values.expected_closing_time).toBe('21:00');
    expect(row.new_values.expected_closing_time).toBe('22:30');
  });

  test('thresholds drive the variance bands', async () => {
    const s = await staff();
    await setClosingTime(s.m, '21:00', { attention_variance_rwf: 100, critical_variance_rwf: 200 });
    await yesterdayOpen(0);
    const res = await closeWith(s.c, 250, 'extra coins');
    expect(res.body.closing.variance_band).toBe('critical');
  });
});

test('unauthenticated access is refused', async () => {
  await resetDb({ openDay: false });
  expect((await request(app).get('/api/business-days/dashboard')).status).toBe(401);
  expect((await request(app).post('/api/business-days/open')).status).toBe(401);
});
