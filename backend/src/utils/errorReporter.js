// Unexpected (non-AppError) failures: logged server-side with the request id,
// and surfaced to managers as one grouped SYSTEM_ERROR alert per hour. The
// alert carries only the path and request id - never the message or stack,
// which can contain SQL or data.
const { emit, hourBucket } = require('../notifications/notificationService');
const db = require('../config/db');

let reporting = false;

function reportError(err, req) {
  console.error(`[error] request=${req?.requestId || '-'}`, err);
  if (reporting) return; // never recurse if emitting itself fails
  reporting = true;
  emit(db, {
    type: 'SYSTEM_ERROR',
    dedupKey: `SYSTEM_ERROR:${hourBucket()}`,
    group: true,
    params: { path: req ? `${req.method} ${req.baseUrl || ''}${req.route?.path || req.path || ''}` : 'background job', request_id: req?.requestId || 'n/a' },
  })
    .catch(() => {})
    .finally(() => {
      reporting = false;
    });
}

module.exports = { reportError };
