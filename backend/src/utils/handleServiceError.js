const { AppError } = require('./AppError');
const { reportError } = require('./errorReporter');

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
  reportError(err, res.req);
  return res.status(500).json({ error: 'Internal server error' });
}

module.exports = { handleServiceError };
