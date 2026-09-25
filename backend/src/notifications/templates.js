// Notification templates. Admins may override the built-in text per type
// (notification_templates table), but only within tight constraints:
//  - plain text only (anything that looks like an HTML tag is rejected;
//    emails are HTML-escaped at send time regardless)
//  - placeholders must be {{name}} with name in the type's `vars` allowlist,
//    so a template can never reach data the event didn't explicitly expose
//  - no control characters; subjects/titles are single-line; lengths capped
const { TYPES } = require('./types');
const { cleanString } = require('../utils/sanitize');
const { AppError } = require('../utils/AppError');

const PLACEHOLDER = /\{\{\s*([a-z_]+)\s*\}\}/g;
const LIMITS = { title: 150, body: 1000, email_subject: 150, email_body: 4000 };
const SINGLE_LINE = new Set(['title', 'email_subject']);
const FIELDS = Object.keys(LIMITS);

function defaultTemplate(type) {
  const def = TYPES[type];
  return { title: def.title, body: def.body, email_subject: def.emailSubject, email_body: def.emailBody };
}

/** Returns the list of problems with a proposed template (empty = valid). */
function validateTemplate(type, template) {
  const def = TYPES[type];
  if (!def) return ['Unknown notification type'];
  const errors = [];
  for (const field of FIELDS) {
    const value = template[field];
    if (typeof value !== 'string' || !value.trim()) {
      errors.push(`${field} is required`);
      continue;
    }
    if (value.length > LIMITS[field]) errors.push(`${field} must be at most ${LIMITS[field]} characters`);
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u0008\u000b-\u001f\u007f]/.test(value)) errors.push(`${field} contains control characters`);
    if (SINGLE_LINE.has(field) && /[\r\n]/.test(value)) errors.push(`${field} must be a single line`);
    if (/<\s*\/?\s*[a-z!?]/i.test(value)) errors.push(`${field} must be plain text (no HTML)`);

    // Every {{ must open a valid, allowlisted placeholder.
    const opens = (value.match(/\{\{/g) || []).length;
    const valid = [...value.matchAll(PLACEHOLDER)];
    if (opens !== valid.length) errors.push(`${field} has a malformed placeholder`);
    for (const [, name] of valid) {
      if (!def.vars.includes(name)) errors.push(`${field} uses unknown placeholder {{${name}}}`);
    }
  }
  return errors;
}

function assertValidTemplate(type, template) {
  const errors = validateTemplate(type, template);
  if (errors.length) throw new AppError(errors.join('; '), 422);
}

/** Fills placeholders with plain-text values. Unknown names render empty. */
function render(text, params, allowedVars, { singleLine = false } = {}) {
  return text.replace(PLACEHOLDER, (_, name) => {
    if (!allowedVars.includes(name)) return '';
    const value = params[name];
    return value === undefined || value === null ? '' : cleanString(value, { max: 300, singleLine });
  });
}

/** Active admin override if there is one, otherwise the built-in default. */
async function getTemplate(trx, type) {
  const override = await trx('notification_templates').where({ type, is_active: true }).first();
  return override ? { ...override, customized: true } : { ...defaultTemplate(type), customized: false };
}

function renderAll(type, template, params) {
  const vars = TYPES[type].vars;
  return {
    title: render(template.title, params, vars, { singleLine: true }).slice(0, 200),
    body: render(template.body, params, vars),
    emailSubject: render(template.email_subject, params, vars, { singleLine: true }).slice(0, 200),
    emailBody: render(template.email_body, params, vars),
  };
}

/** Sample values for the admin preview, so previews never touch real data. */
function sampleParams(type) {
  return Object.fromEntries(TYPES[type].vars.map((v) => [v, `[${v}]`]));
}

module.exports = {
  FIELDS, LIMITS, defaultTemplate, validateTemplate, assertValidTemplate, render, renderAll, getTemplate, sampleParams,
};
