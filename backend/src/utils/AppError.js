/**
 * Thrown intentionally by service functions for expected, user-facing failure
 * conditions (e.g. "insufficient stock", "not found"). Only AppError messages
 * are ever sent to a client - anything else (a DB error, a bug) is logged
 * server-side and replaced with a generic message, so internal details never
 * leak in a response.
 */
class AppError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'AppError';
    this.status = status;
  }
}

module.exports = { AppError };
