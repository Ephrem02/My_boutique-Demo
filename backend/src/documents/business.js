// Business identity printed on documents (app_settings key 'business').
// Managers edit it (settings.manage); every change is audited.
const db = require('../config/db');
const { AppError } = require('../utils/AppError');
const { audit } = require('../audit/auditService');

const DEFAULTS = {
  name: 'MY Boutique',
  tin: '',
  address: '',
  phone: '',
  email: '',
  document_footer: '',
  proforma_terms: '',
};
const LIMITS = { name: 120, tin: 40, address: 200, phone: 60, email: 120, document_footer: 300, proforma_terms: 1000 };

async function getBusiness(trx = db) {
  const row = await trx('app_settings').where({ key: 'business' }).first();
  return { ...DEFAULTS, ...(row?.value || {}) };
}

async function updateBusiness({ req, input = {} }) {
  const current = await getBusiness();
  const unknown = Object.keys(input).filter((k) => !(k in DEFAULTS));
  if (unknown.length) throw new AppError(`unknown settings: ${unknown.join(', ')}`, 422);
  const next = { ...current };
  for (const [key, max] of Object.entries(LIMITS)) {
    if (input[key] === undefined) continue;
    if (typeof input[key] !== 'string') throw new AppError(`${key} must be text`, 422);
    next[key] = input[key].trim().slice(0, max);
  }
  if (!next.name) throw new AppError('The business name is required', 422);
  if (next.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next.email)) throw new AppError('email is not a valid address', 422);
  await db.transaction(async (trx) => {
    await trx('app_settings').insert({ key: 'business', value: JSON.stringify(next), updated_by: req.user.id, updated_at: trx.fn.now() }).onConflict('key').merge();
    await audit(req, { action: 'business_settings.update', entityType: 'settings', oldValues: current, newValues: next }, { trx, required: true });
  });
  return next;
}

module.exports = { getBusiness, updateBusiness, DEFAULTS };
