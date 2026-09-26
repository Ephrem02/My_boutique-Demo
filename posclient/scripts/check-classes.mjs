// Lists class names used in JSX that no stylesheet defines (catches typos
// and leftovers from the old stylesheet). Dynamic ${} parts are skipped.
// Run: node scripts/check-classes.mjs   (exits 1 when anything is missing)
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const walk = (dir) => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f);
  return statSync(p).isDirectory() ? walk(p) : [p];
});

const HOOKS = new Set([
  'btn-label', 'money', 'dialog-heading', 'dashboard', 'attention-panel', 'admin-page', 'admin-section',
  'bell-button', 'wizard-step-label', 'pagination-info',
]);

const files = walk('src');
const css = files.filter((f) => f.endsWith('.css')).map((f) => readFileSync(f, 'utf8')).join('\n');
const defined = new Set([...css.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1]));
const missing = new Map();

for (const file of files.filter((x) => /\.(jsx|js)$/.test(x))) {
  const src = readFileSync(file, 'utf8');
  for (const m of src.matchAll(/className=(?:"([^"]+)"|\{`([^`]+)`\})/g)) {
    const raw = (m[1] || m[2]).replace(/\$\{[^}]*\}/g, ' ');
    for (const cls of raw.split(/\s+/).filter(Boolean)) {
      // "badge-" etc. are the static half of `badge-${tone}`; HOOKS are
      // semantic/test hooks that intentionally carry no styles.
      if (defined.has(cls) || cls.endsWith('-') || HOOKS.has(cls)) continue;
      const where = missing.get(cls) || new Set();
      where.add(file.split(/[\\/]/).slice(1).join('/'));
      missing.set(cls, where);
    }
  }
}

for (const [cls, where] of missing) console.log(`${cls}  <-  ${[...where].join(', ')}`);
console.log(missing.size ? `\n${missing.size} undefined class(es)` : 'all classes defined');
process.exitCode = missing.size ? 1 : 0;
