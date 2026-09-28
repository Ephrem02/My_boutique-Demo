/**
 * Thrown intentionally by service functions for expected, user-facing failure
 * conditions (e.g. "insufficient stock", "not found"). Only AppError messages
 * are ever sent to a client - anything else (a DB error, a bug) is logged
 * server-side and replaced with a generic message, so internal details never
 * leak in a response.
 */
class AppError extends Error {
  /** details: optional safe, machine-readable fields sent with the message (e.g. { code, limit }). */
  constructor(message, status = 400, details = undefined) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.details = details;
  }
}

module.exports = { AppError };
