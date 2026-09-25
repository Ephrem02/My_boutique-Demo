const { TYPES, ROLES, SEVERITIES } = require('./types');
const { AppError } = require('../utils/AppError');

function defaultRule(type) {
  const def = TYPES[type];
  return {
    type,
    enabled: true,
    recipient_roles: [...def.roles],
    in_app: def.inApp,
    email: def.email,
    severity: def.severity,
    thresholds: { ...def.thresholds },
    cooldown_minutes: def.cooldown,
    customized: false,
  };
}

/** Admin override merged over the default. Thresholds merge key-by-key. */
async function getRule(trx, type) {
  const base = defaultRule(type);
  const override = await trx('notification_rules').where({ type }).first();
  if (!override) return base;
  return {
    ...base,
    ...override,
    thresholds: { ...base.thresholds, ...(override.thresholds || {}) },
    customized: true,
  };
}

/** Roles that hold the type's visibility permission - the ceiling for recipient_roles. */
async function eligibleRoles(trx, type) {
  const def = TYPES[type];
  if (!def.permission) return [];
  return trx('roles')
    .join('role_permissions', 'role_permissions.role_id', 'roles.id')
    .join('permissions', 'permissions.id', 'role_permissions.permission_id')
    .where('permissions.code', def.permission)
    .pluck('roles.name');
}

/**
 * Validates an admin's proposed rule and returns the normalized row to store.
 * Rejects anything that would widen visibility or silence a mandatory alert.
 */
async function validateRule(trx, type, input) {
  const def = TYPES[type];
  if (!def || def.manual) throw new AppError('Unknown or non-configurable notification type', 404);
  const current = await getRule(trx, type);
  const next = { ...current, ...input };
  const errors = [];

  if (typeof next.enabled !== 'boolean') errors.push('enabled must be true or false');
  if (typeof next.in_app !== 'boolean' || typeof next.email !== 'boolean') errors.push('in_app and email must be true or false');
  if (!SEVERITIES.includes(next.severity)) errors.push(`severity must be one of ${SEVERITIES.join(', ')}`);
  if (!Number.isInteger(next.cooldown_minutes) || next.cooldown_minutes < 0 || next.cooldown_minutes > 10080) {
    errors.push('cooldown_minutes must be a whole number between 0 and 10080 (one week)');
  }

  if (!Array.isArray(next.recipient_roles) || next.recipient_roles.some((r) => !ROLES.includes(r))) {
    errors.push(`recipient_roles must only contain: ${ROLES.join(', ')}`);
  } else {
    const allowed = await eligibleRoles(trx, type);
    // A role can also be listed if it's only ever reached as a *target* (e.g.
    // cashiers for their own voided sales) - the permission gate still applies
    // to role-based fan-out in recipients.js.
    const targetOnly = def.roles.filter((r) => !allowed.includes(r));
    const bad = next.recipient_roles.filter((r) => !allowed.includes(r) && !targetOnly.includes(r));
    if (bad.length) errors.push(`${bad.join(', ')} cannot receive ${type} (missing the ${def.permission} permission)`);
    next.recipient_roles = [...new Set(next.recipient_roles)];
  }

  if (def.mandatory) {
    if (next.enabled === false) errors.push(`${type} is mandatory and cannot be disabled`);
    if (!next.in_app && !next.email) errors.push(`${type} is mandatory and needs at least one channel`);
    if (Array.isArray(next.recipient_roles) && !next.recipient_roles.length) errors.push(`${type} is mandatory and needs recipients`);
  }
  if (def.emailAllowed === false && next.email) errors.push(`${type} cannot be sent by email`);

  const thresholds = {};
  for (const key of Object.keys(def.thresholds)) {
    const value = next.thresholds?.[key] ?? def.thresholds[key];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1e12) {
      errors.push(`threshold ${key} must be a non-negative number`);
    }
    thresholds[key] = value;
  }
  const unknown = Object.keys(input.thresholds || {}).filter((k) => !(k in def.thresholds));
  if (unknown.length) errors.push(`unknown thresholds: ${unknown.join(', ')}`);

  if (errors.length) throw new AppError(errors.join('; '), 422);

  return {
    type,
    enabled: next.enabled,
    recipient_roles: next.recipient_roles,
    in_app: next.in_app,
    email: next.email,
    severity: next.severity,
    thresholds,
    cooldown_minutes: next.cooldown_minutes,
  };
}

module.exports = { defaultRule, getRule, eligibleRoles, validateRule };
