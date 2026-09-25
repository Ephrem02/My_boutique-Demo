// Server-Sent Events hub for live notification updates.
//
// One dedicated Postgres connection LISTENs on the channel that emit()
// pg_notify()s into. Postgres only delivers NOTIFY on commit, so clients are
// never told about notifications from a rolled-back transaction, and this
// also works across several API processes.
//
// The stream only ever carries the user's own unread count - clients then
// fetch content over the normal authenticated API, so the same RBAC and
// ownership checks apply. If this hub is unavailable the frontend falls back
// to polling /api/notifications/unread-count.
const { Client } = require('pg');
const db = require('../config/db');
const { userFromToken } = require('../middleware/auth');
const { PUSH_CHANNEL } = require('./notificationService');

const MAX_STREAMS_PER_USER = 5;
const HEARTBEAT_MS = 25 * 1000;
const REVALIDATE_MS = 60 * 1000;

const clientsByUser = new Map(); // userId -> Set<stream>
let listener = null;
let listenerStarting = null;
let stopped = false;

async function unreadCount(userId) {
  const { count } = await db('notifications')
    .where({ recipient_user_id: userId, in_app: true })
    .whereNull('read_at')
    .whereNull('archived_at')
    .count('* as count')
    .first();
  return Number(count);
}

function send(stream, event, data) {
  stream.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

async function pushUnread(userId) {
  const streams = clientsByUser.get(userId);
  if (!streams?.size) return;
  const count = await unreadCount(userId);
  for (const stream of streams) send(stream, 'unread', { count });
}

async function startListener() {
  if (listener || stopped) return;
  if (listenerStarting) return listenerStarting;
  listenerStarting = (async () => {
    const client = new Client(db.client.connectionSettings);
    client.on('notification', (msg) => {
      if (msg.channel !== PUSH_CHANNEL) return;
      let payload;
      try {
        payload = JSON.parse(msg.payload);
      } catch {
        return;
      }
      for (const userId of payload.user_ids || []) {
        if (clientsByUser.has(userId)) pushUnread(userId).catch(() => {});
      }
    });
    client.on('error', (err) => {
      console.error('[realtime] listener error:', err.message);
      listener = null;
      client.end().catch(() => {});
      // Reconnect after a pause; streams stay open meanwhile and clients'
      // polling fallback covers the gap.
      if (!stopped) setTimeout(() => startListener().catch(() => {}), 5000).unref?.();
    });
    await client.connect();
    await client.query(`LISTEN ${PUSH_CHANNEL}`);
    listener = client;
  })().finally(() => {
    listenerStarting = null;
  });
  return listenerStarting;
}

/** GET /api/notifications/stream - req.user is set by authenticate. */
async function stream(req, res) {
  const userId = req.user.id;
  const streams = clientsByUser.get(userId) || new Set();
  if (streams.size >= MAX_STREAMS_PER_USER) {
    return res.status(429).json({ error: 'Too many open notification streams' });
  }

  try {
    await startListener();
  } catch (err) {
    console.error('[realtime] could not start listener:', err.message);
    return res.status(503).json({ error: 'Live updates unavailable - polling instead' });
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // don't let nginx buffer the stream
  });
  res.write('retry: 10000\n\n');

  const entry = { res, userId };
  streams.add(entry);
  clientsByUser.set(userId, streams);
  const token = req.cookies?.token;
  const tokenExpiresAt = req.user.tokenExpiresAt;

  const close = () => {
    clearInterval(heartbeat);
    clearInterval(revalidate);
    clearTimeout(expiry);
    streams.delete(entry);
    if (!streams.size) clientsByUser.delete(userId);
    res.end();
  };
  const heartbeat = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS);
  // A disabled account, reset password or changed permissions must not keep
  // an open stream alive on an old session.
  const revalidate = setInterval(async () => {
    const user = await userFromToken(token).catch(() => null);
    if (!user) {
      send(entry, 'session-ended', {});
      close();
    }
  }, REVALIDATE_MS);
  const expiry = setTimeout(() => {
    send(entry, 'session-ended', {});
    close();
  }, Math.max(0, Math.min(tokenExpiresAt - Date.now(), 2 ** 31 - 1)));
  req.on('close', close);

  send(entry, 'unread', { count: await unreadCount(userId) });
}

async function shutdown() {
  stopped = true;
  for (const streams of clientsByUser.values()) for (const s of streams) s.res.end();
  clientsByUser.clear();
  if (listener) await listener.end().catch(() => {});
  listener = null;
}

module.exports = { stream, shutdown, unreadCount, pushUnread };
