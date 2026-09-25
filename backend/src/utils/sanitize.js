// Shared scrubbing for anything that gets persisted for humans to read later
// (audit rows, notification params, delivery errors). Values here come from
// request bodies and DB rows, so they're untrusted: secrets are redacted,
// control characters stripped (log injection) and sizes capped.

const SECRET_KEY = /pass(word)?|pwd|token|secret|hash|cookie|authorization|api[_-]?key|smtp_pass/i;
// Everything below 0x20 except tab/newline, plus DEL and the C1 range.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g;
// eslint-disable-next-line no-control-regex
const LINE_BREAKS = /[\r\n\u2028\u2029]+/g;

function cleanString(value, { max = 500, singleLine = false } = {}) {
  let s = String(value).replace(CONTROL_CHARS, '');
  if (singleLine) s = s.replace(LINE_BREAKS, ' ');
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/** Deep-copies a value with secrets redacted and strings cleaned. */
function redact(value, depth = 0) {
  if (value === null || value === undefined) return value ?? null;
  if (depth > 4) return '[truncated]';
  if (typeof value === 'string') return cleanString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    for (const [key, v] of Object.entries(value).slice(0, 100)) {
      out[key] = SECRET_KEY.test(key) ? '[REDACTED]' : redact(v, depth + 1);
    }
    return out;
  }
  return cleanString(String(value));
}

/** Only the keys whose values actually differ, for compact before/after audit rows. */
function diffValues(before, after) {
  const oldValues = {};
  const newValues = {};
  for (const key of Object.keys(after)) {
    const a = before?.[key];
    const b = after[key];
    if (String(a ?? '') !== String(b ?? '')) {
      oldValues[key] = a ?? null;
      newValues[key] = b ?? null;
    }
  }
  return { oldValues, newValues, changed: Object.keys(newValues).length > 0 };
}

function formatRwf(amount) {
  return `${Math.round(Number(amount) || 0).toLocaleString('en-US')} RWF`;
}

/** j***@example.com - enough for an admin to recognise, not to harvest. */
function maskEmail(email) {
  if (!email) return null;
  const [local, domain] = String(email).split('@');
  if (!domain) return '***';
  return `${local.slice(0, 1)}***@${domain}`;
}

module.exports = { cleanString, redact, diffValues, formatRwf, maskEmail, SECRET_KEY };
