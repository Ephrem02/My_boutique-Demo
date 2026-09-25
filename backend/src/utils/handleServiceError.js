const { AppError } = require('./AppError');
const { reportError } = require('./errorReporter');

// Raised by the business_day_guard trigger (migration 18) - the database's
// last line of defence for closed periods.
const CLOSED_PERIOD_MESSAGE = 'That business day is not open - the change was refused';
function isClosedPeriodViolation(err) {
  return err?.code === 'P0001' && String(err.message).includes('business_day_closed');
}

/**
 * Sends an AppError's own (safe, user-facing) message to the client.
 * Anything else - a DB error, a bug - is logged server-side only and
 * replaced with a generic message, so raw exception text never reaches
 * a response.
 */
function handleServiceError(err, res) {
  if (err instanceof AppError) {
    return res.status(err.status).json({ error: err.message });
  }
  if (isClosedPeriodViolation(err)) {
    return res.status(409).json({ error: CLOSED_PERIOD_MESSAGE });
  }
  reportError(err, res.req);
  return res.status(500).json({ error: 'Internal server error' });
}

module.exports = { handleServiceError, isClosedPeriodViolation, CLOSED_PERIOD_MESSAGE };
