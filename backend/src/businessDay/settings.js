// Admin-configurable closing rules (app_settings key 'closing'). Business
// logic reads these at use time - nothing about closing times or variance
// thresholds is hard-coded elsewhere.
const db = require('../config/db');
const { AppError } = require('../utils/AppError');

const CLOSING_DEFAULTS = {
  expected_closing_time: '21:00', // shop local time, HH:MM
  reminder_lead_minutes: 30,
  critical_delay_minutes: 120,
  attention_variance_rwf: 1000, // |variance| above this needs an explanation
  critical_variance_rwf: 10000, // |variance| above this needs manager review
  timezone: 'Africa/Kigali',
};

function isValidTimezone(tz) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

async function getClosingSettings(trx = db) {
  const row = await trx('app_settings').where({ key: 'closing' }).first();
  return { ...CLOSING_DEFAULTS, ...(row?.value || {}) };
}

function validateClosingSettings(current, input) {
  const next = { ...current };
  const errors = [];
  const unknown = Object.keys(input).filter((k) => !(k in CLOSING_DEFAULTS));
  if (unknown.length) errors.push(`unknown settings: ${unknown.join(', ')}`);

  if (input.expected_closing_time !== undefined) {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(input.expected_closing_time))) errors.push('expected_closing_time must be HH:MM (24-hour)');
    next.expected_closing_time = String(input.expected_closing_time);
  }
  for (const [key, min, max] of [
    ['reminder_lead_minutes', 0, 720],
    ['critical_delay_minutes', 15, 1440],
    ['attention_variance_rwf', 0, 1e9],
    ['critical_variance_rwf', 0, 1e9],
  ]) {
    if (input[key] !== undefined) {
      if (!Number.isInteger(input[key]) || input[key] < min || input[key] > max) errors.push(`${key} must be a whole number from ${min} to ${max}`);
      next[key] = input[key];
    }
  }
  if (input.timezone !== undefined) {
    if (typeof input.timezone !== 'string' || !isValidTimezone(input.timezone)) errors.push('timezone must be a valid IANA timezone, e.g. Africa/Kigali');
    next.timezone = input.timezone;
  }
  if (next.critical_variance_rwf < next.attention_variance_rwf) {
    errors.push('critical_variance_rwf must be at least attention_variance_rwf');
  }
  if (errors.length) throw new AppError(errors.join('; '), 422);
  return next;
}

async function saveClosingSettings(trx, value, userId) {
  await trx('app_settings')
    .insert({ key: 'closing', value: JSON.stringify(value), updated_by: userId, updated_at: trx.fn.now() })
    .onConflict('key')
    .merge();
}

/** 'normal' | 'attention' | 'critical' for a signed variance. Bands use the absolute amount. */
function varianceBand(variance, settings) {
  const abs = Math.abs(Number(variance) || 0);
  if (abs > settings.critical_variance_rwf) return 'critical';
  if (abs > settings.attention_variance_rwf) return 'attention';
  return 'normal';
}

/** Calendar date (YYYY-MM-DD) in the shop's timezone. */
function shopDate(settings, date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: settings.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

/** HH:MM in the shop's timezone. */
function shopTime(settings, date = new Date()) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: settings.timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date);
}

module.exports = {
  CLOSING_DEFAULTS, getClosingSettings, validateClosingSettings, saveClosingSettings, varianceBand, shopDate, shopTime,
};
