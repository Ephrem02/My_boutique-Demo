// Translation checks.
//   node scripts/i18n-check.mjs         -> keys used in code but missing from en.js (exit 1 if any)
//   node scripts/i18n-check.mjs --rw    -> also writes translations/rw-missing.json: every English
//                                          string with no Kinyarwanda yet, for a translator
import { readFileSync, readdirSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const walk = (dir) => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f);
  return statSync(p).isDirectory() ? walk(p) : [p];
});
const load = async (file) => (await import(pathToFileURL(join(process.cwd(), file)).href)).default;
const en = await load('src/i18n/locales/en.js');
const rw = await load('src/i18n/locales/rw.js');

const get = (obj, key) => key.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), obj);
const flatten = (obj, prefix = '') => Object.entries(obj).flatMap(([k, v]) => (
  v && typeof v === 'object' ? flatten(v, `${prefix}${k}.`) : [[`${prefix}${k}`, v]]
));

// Keys used in code: t('a.b') and t(`a.b.${x}`) (the static prefix must exist)
const allKeys = flatten(en).map(([k]) => k);
const missing = new Map();
for (const file of walk('src').filter((f) => /\.(jsx|js)$/.test(f) && !f.includes('locales'))) {
  const src = readFileSync(file, 'utf8');
  for (const m of src.matchAll(/\bt\(\s*(['`])([^'`]+)\1/g)) {
    const key = m[2];
    const hasDefault = /defaultValue/.test(src.slice(m.index, m.index + 200).split('\n')[0]);
    if (key.includes('${')) {
      const raw = key.slice(0, key.indexOf('${'));
      // `a.b.${x}` needs object a.b; `a.b_${x}` needs some key starting with a.b_
      const ok = !raw || (raw.endsWith('.') ? typeof get(en, raw.slice(0, -1)) === 'object' : allKeys.some((k) => k.startsWith(raw)));
      if (!ok && !hasDefault) missing.set(`${raw}*`, file.split(/[\\/]/).slice(1).join('/'));
      continue;
    }
    if (get(en, key) === undefined && !hasDefault) missing.set(key, file.split(/[\\/]/).slice(1).join('/'));
  }
}
for (const [key, file] of missing) console.log(`missing in en.js: ${key}  (${file})`);
console.log(missing.size ? `\n${missing.size} missing key(s)` : 'all used keys exist in en.js');

if (process.argv.includes('--rw')) {
  const todo = Object.fromEntries(flatten(en).filter(([key]) => get(rw, key) === undefined));
  mkdirSync('translations', { recursive: true });
  writeFileSync('translations/rw-missing.json', `${JSON.stringify(todo, null, 2)}\n`);
  console.log(`translations/rw-missing.json: ${Object.keys(todo).length} strings need Kinyarwanda (of ${flatten(en).length})`);
}
process.exitCode = missing.size ? 1 : 0;
