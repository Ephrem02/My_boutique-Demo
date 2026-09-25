// Admin-editable email settings (non-secret). SMTP credentials are never
// stored here - they come from environment variables only, see transport.js.
const db = require('../config/db');
const { AppError } = require('../utils/AppError');

const EMAIL_DEFAULTS = {
  enabled: false, // off until an admin configures SMTP and turns it on
  sender_name: 'Shop Management',
  sender_address: '',
  max_attempts: 5,
  daily_limit: 500,
  per_recipient_hourly_limit: 20,
};

const EMAIL_ADDRESS = /^[^\s@<>"'\\,;:]+@[^\s@<>"'\\,;:]+\.[a-z]{2,}$/i;

async function getEmailSettings(trx = db) {
  const row = await trx('app_settings').where({ key: 'email' }).first();
  return { ...EMAIL_DEFAULTS, ...(row?.value || {}) };
}

function validateEmailSettings(current, input) {
  const next = { ...current };
  const errors = [];
  const allowed = Object.keys(EMAIL_DEFAULTS);
  const unknown = Object.keys(input).filter((k) => !allowed.includes(k));
  if (unknown.length) errors.push(`unknown settings: ${unknown.join(', ')}`);

  if (input.enabled !== undefined) {
    if (typeof input.enabled !== 'boolean') errors.push('enabled must be true or false');
    next.enabled = input.enabled;
  }
  if (input.sender_name !== undefined) {
    // eslint-disable-next-line no-control-regex
    if (typeof input.sender_name !== 'string' || !input.sender_name.trim() || input.sender_name.length > 80 || /[\u0000-\u001f<>"]/.test(input.sender_name)) {
      errors.push('sender_name must be 1-80 characters without quotes, angle brackets or line breaks');
    }
    next.sender_name = String(input.sender_name).trim();
  }
  if (input.sender_address !== undefined) {
    if (input.sender_address !== '' && (typeof input.sender_address !== 'string' || !EMAIL_ADDRESS.test(input.sender_address) || input.sender_address.length > 254)) {
      errors.push('sender_address must be a valid email address');
    }
    next.sender_address = String(input.sender_address).trim();
  }
  for (const [key, min, max] of [['max_attempts', 1, 10], ['daily_limit', 0, 10000], ['per_recipient_hourly_limit', 1, 500]]) {
    if (input[key] !== undefined) {
      if (!Number.isInteger(input[key]) || input[key] < min || input[key] > max) errors.push(`${key} must be a whole number from ${min} to ${max}`);
      next[key] = input[key];
    }
  }
  if (next.enabled && !next.sender_address) errors.push('sender_address is required before email can be enabled');
  if (errors.length) throw new AppError(errors.join('; '), 422);
  return next;
}

async function saveEmailSettings(trx, value, userId) {
  await trx('app_settings')
    .insert({ key: 'email', value: JSON.stringify(value), updated_by: userId, updated_at: trx.fn.now() })
    .onConflict('key')
    .merge();
}

module.exports = { EMAIL_DEFAULTS, EMAIL_ADDRESS, getEmailSettings, validateEmailSettings, saveEmailSettings };
