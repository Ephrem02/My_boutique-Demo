// Checks WCAG contrast of the semantic text/background token pairs in both
// themes. Run: node scripts/contrast-check.mjs  (exits 1 on any failure)
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../src/styles/tokens.css', import.meta.url), 'utf8');
const block = (selector) => css.slice(css.indexOf(selector), css.indexOf('}', css.indexOf(selector)));
const parse = (text) => Object.fromEntries([...text.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
const base = parse(block(':root {'));
const dark = { ...base, ...parse(block(":root[data-theme='dark']")) };

function resolve(vars, value, depth = 0) {
  const ref = /^var\((--[\w-]+)\)$/.exec(value);
  return ref && depth < 10 ? resolve(vars, vars[ref[1]], depth + 1) : value;
}
function rgba(value) {
  if (value.startsWith('#')) {
    const h = value.slice(1);
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).concat(1);
  }
  const m = /rgba?\(([^)]+)\)/.exec(value);
  const [r, g, b, a = 1] = m[1].split(',').map((s) => Number(s.trim()));
  return [r, g, b, a];
}
function over(fg, bg) {
  const [r, g, b, a] = fg;
  return [r * a + bg[0] * (1 - a), g * a + bg[1] * (1 - a), b * a + bg[2] * (1 - a), 1];
}
function lum([r, g, b]) {
  const c = [r, g, b].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function ratio(vars, fg, bg, under = '--color-surface') {
  const floor = rgba(resolve(vars, vars[under]));
  const b = over(rgba(resolve(vars, vars[bg])), floor);
  const f = over(rgba(resolve(vars, vars[fg])), b);
  const [l1, l2] = [lum(f), lum(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

const PAIRS = [
  ['--color-text', '--color-surface', 4.5], ['--color-text', '--color-bg', 4.5],
  ['--color-text-secondary', '--color-surface', 4.5], ['--color-text-secondary', '--color-bg', 4.5],
  ['--color-text-muted', '--color-surface', 4.5], ['--color-text-muted', '--color-bg', 4.5],
  ['--color-text-muted', '--color-surface-sunken', 4.5],
  ['--color-on-primary', '--color-primary', 4.5], ['--color-on-primary', '--color-primary-hover', 4.5],
  ['--color-primary-text', '--color-surface', 4.5], ['--color-primary-soft-text', '--color-primary-soft', 4.5],
  ['--color-success-fg', '--color-success-bg', 4.5], ['--color-warning-fg', '--color-warning-bg', 4.5],
  ['--color-danger-fg', '--color-danger-bg', 4.5], ['--color-info-fg', '--color-info-bg', 4.5],
  ['--color-danger-fg', '--color-surface', 4.5], ['--color-warning-fg', '--color-surface', 4.5],
  ['--color-border-strong', '--color-surface', 1.5], ['--color-focus-ring', '--color-surface', 3],
];

let failed = 0;
for (const [name, vars] of [['light', base], ['dark', dark]]) {
  for (const [fg, bg, min] of PAIRS) {
    const r = ratio(vars, fg, bg);
    const ok = r >= min;
    if (!ok) failed += 1;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${name.padEnd(5)} ${fg} on ${bg}: ${r.toFixed(2)} (min ${min})`);
  }
}
process.exitCode = failed ? 1 : 0;
