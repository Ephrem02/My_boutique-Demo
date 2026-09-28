// Idempotency for money requests (Step 0).
//
// A client sends `Idempotency-Key: <random id>` with a POST that records
// money or stock. The first request runs normally; its successful response is
// stored. The same key again (a double click, a retry after a dropped
// connection) gets that stored response back - marked `Idempotent-Replay:
// true` - instead of recording the payment or sale a second time.
//
//  - Keys are per user, so one user can never see another's response.
//  - The same key with a different body is refused (422): it is a bug, not a retry.
//  - A request still running under the key gets 409; the client may retry.
//  - Only 2xx responses are kept. Anything else frees the key so the user can
//    fix the problem (e.g. open the business day) and submit again.
//  - Without the header, requests behave exactly as before.
const crypto = require('crypto');
const db = require('../config/db');

const KEY_FORMAT = /^[A-Za-z0-9_-]{8,100}$/;
const STALE_MS = 10 * 60 * 1000; // an "in progress" key older than this was abandoned (crash)
const KEEP_HOURS = 48;

function requestHash(req) {
  return crypto.createHash('sha256').update(JSON.stringify([req.method, req.baseUrl + req.path, req.body ?? null])).digest('hex');
}

function idempotent() {
  return async (req, res, next) => {
    const key = req.get('Idempotency-Key');
    if (!key || req.method !== 'POST') return next();
    if (!KEY_FORMAT.test(key)) return res.status(422).json({ error: 'Idempotency-Key must be 8-100 letters, digits, "-" or "_"' });
    if (!req.user) return next(); // authenticate runs first; nothing to scope the key to otherwise

    const hash = requestHash(req);
    const where = { user_id: req.user.id, key };
    try {
      const inserted = await db('idempotency_keys').insert({ ...where, request_hash: hash }).onConflict(['user_id', 'key']).ignore().returning('key');
      if (!inserted.length) {
        const existing = await db('idempotency_keys').where(where).first();
        if (existing.request_hash !== hash) {
          return res.status(422).json({ error: 'This Idempotency-Key was already used for a different request' });
        }
        if (existing.state === 'done') {
          res.set('Idempotent-Replay', 'true');
          return res.status(existing.status_code).json(existing.response_body);
        }
        if (Date.now() - new Date(existing.created_at).getTime() < STALE_MS) {
          return res.status(409).json({ error: 'This request is already being processed - wait a moment before trying again' });
        }
        // Abandoned by a crashed request: take it over
        await db('idempotency_keys').where(where).update({ created_at: db.fn.now() });
      }
    } catch (err) {
      return next(err);
    }

    let settled = false;
    const release = () => db('idempotency_keys').where({ ...where, state: 'in_progress' }).del().catch(() => {});
    const json = res.json.bind(res);
    res.json = (payload) => {
      settled = true;
      const store = res.statusCode >= 200 && res.statusCode < 300
        ? db('idempotency_keys').where(where).update({ state: 'done', status_code: res.statusCode, response_body: JSON.stringify(payload ?? null) })
        : release();
      // Store before replying, so a retry that arrives right after the
      // response already finds the result.
      Promise.resolve(store).catch((err) => console.error('[idempotency] could not store response:', err.message)).finally(() => json(payload));
      return res;
    };
    res.on('close', () => {
      if (!settled) release();
    });
    return next();
  };
}

/** Housekeeping for the worker: forget keys after KEEP_HOURS. */
async function purgeOldKeys() {
  return db('idempotency_keys').where('created_at', '<', db.raw(`now() - interval '${KEEP_HOURS} hours'`)).del();
}

module.exports = { idempotent, purgeOldKeys, requestHash };
