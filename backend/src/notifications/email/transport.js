// SMTP transport. Credentials come only from environment variables - they
// are never stored in the database, returned by the API, or logged.
// Without SMTP_HOST the transport is "not configured" and deliveries are
// marked skipped, so nothing is ever sent by accident.
const nodemailer = require('nodemailer');

let overrideTransport = null;
let cached = null;

function smtpConfigured() {
  return !!process.env.SMTP_HOST;
}

function getTransport() {
  if (overrideTransport) return overrideTransport;
  if (!smtpConfigured()) return null;
  if (!cached) {
    cached = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_SECURE === 'true', // true = implicit TLS (465); false = STARTTLS
      requireTLS: process.env.SMTP_SECURE !== 'true',
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } : undefined,
      tls: { rejectUnauthorized: process.env.SMTP_TLS_REJECT_UNAUTHORIZED !== 'false' },
    });
  }
  return cached;
}

/** Status for the admin UI - host is masked, credentials never included. */
function describeTransport() {
  if (overrideTransport) return { configured: true, host: 'test transport' };
  if (!smtpConfigured()) return { configured: false, host: null };
  const host = process.env.SMTP_HOST;
  const masked = host.length > 6 ? `${host.slice(0, 3)}***${host.slice(-3)}` : '***';
  return { configured: true, host: masked, port: Number(process.env.SMTP_PORT) || 587, user_set: !!process.env.SMTP_USER };
}

/** Tests inject a fake transport; pass null to restore the real one. */
function setTransportForTesting(transport) {
  overrideTransport = transport;
}

module.exports = { getTransport, describeTransport, setTransportForTesting };
