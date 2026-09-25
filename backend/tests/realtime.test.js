const http = require('http');
const app = require('../src/app');
const db = require('../src/config/db');
const { emit } = require('../src/notifications/notificationService');
const request = require('supertest');
const { resetDb, createUser, PASSWORD } = require('./helpers');

let server;
let baseUrl;
beforeAll(async () => {
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
afterAll(async () => {
  await require('../src/notifications/realtime').shutdown();
  await new Promise((resolve) => server.close(resolve));
});
beforeEach(resetDb);

async function sessionCookie(user) {
  const res = await request(app).post('/api/auth/login').send({ email: user.email, password: PASSWORD });
  return res.headers['set-cookie'][0].split(';')[0];
}

/** Opens the SSE stream and collects parsed events until `until(events)` is true. */
function openStream(cookie) {
  const events = [];
  let waiters = [];
  const controller = new AbortController();
  const ready = fetch(`${baseUrl}/api/notifications/stream`, { headers: { cookie }, signal: controller.signal }).then(async (res) => {
    if (res.status !== 200) {
      events.push({ event: 'http', data: res.status });
      waiters.forEach((w) => w());
      return;
    }
    const decoder = new TextDecoder();
    let buffer = '';
    for await (const chunk of res.body) {
      buffer += decoder.decode(chunk, { stream: true });
      let idx;
      while ((idx = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const event = /^event: (.+)$/m.exec(block)?.[1];
        const data = /^data: (.+)$/m.exec(block)?.[1];
        if (event) events.push({ event, data: JSON.parse(data) });
      }
      waiters.forEach((w) => w());
    }
  }).catch(() => {});
  const waitFor = (predicate, timeout = 5000) => new Promise((resolve, reject) => {
    const check = () => {
      if (predicate(events)) {
        waiters = waiters.filter((w) => w !== check);
        resolve(events);
      }
    };
    waiters.push(check);
    check();
    setTimeout(() => reject(new Error(`timed out; got ${JSON.stringify(events)}`)), timeout);
  });
  return { events, waitFor, close: () => controller.abort(), ready };
}

test('pushes unread counts for committed notifications only, to the right user only', async () => {
  const keeper = await createUser('store_keeper');
  const other = await createUser('store_keeper');
  const stream = openStream(await sessionCookie(keeper));
  const otherStream = openStream(await sessionCookie(other));
  await stream.waitFor((e) => e.some((x) => x.event === 'unread' && x.data.count === 0));
  await otherStream.waitFor((e) => e.some((x) => x.event === 'unread'));

  // Rolled back: no push
  await db.transaction(async (trx) => {
    await emit(trx, { type: 'MANUAL', dedupKey: 'rt:rollback', explicitUserIds: [keeper.id], params: { title: 'x', message: 'y', sender_name: 'z' } });
    throw new Error('rollback');
  }).catch(() => {});
  // Committed: push
  await emit(db, { type: 'MANUAL', dedupKey: 'rt:commit', explicitUserIds: [keeper.id], params: { title: 'x', message: 'y', sender_name: 'z' } });

  const events = await stream.waitFor((e) => e.some((x) => x.event === 'unread' && x.data.count === 1));
  expect(events.filter((x) => x.event === 'unread').map((x) => x.data.count)).toEqual([0, 1]);
  await new Promise((r) => setTimeout(r, 300));
  expect(otherStream.events.filter((x) => x.event === 'unread').map((x) => x.data.count)).toEqual([0]);
  stream.close();
  otherStream.close();
});

test('rejects unauthenticated streams and caps streams per user', async () => {
  const anon = await fetch(`${baseUrl}/api/notifications/stream`);
  expect(anon.status).toBe(401);

  const user = await createUser('cashier');
  const cookie = await sessionCookie(user);
  const streams = [];
  for (let i = 0; i < 5; i += 1) {
    const s = openStream(cookie);
    await s.waitFor((e) => e.some((x) => x.event === 'unread'));
    streams.push(s);
  }
  const sixth = openStream(cookie);
  await sixth.waitFor((e) => e.some((x) => x.event === 'http'));
  expect(sixth.events[0].data).toBe(429);
  streams.forEach((s) => s.close());
});
