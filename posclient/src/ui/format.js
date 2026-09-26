// One way to format money, numbers and dates across the app. Grouping is
// fixed to en-US (1,250,000) so figures look the same on every device,
// whatever the browser language.
const integer = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

/** RWF 1,250,000 · −RWF 5,000 · +RWF 400 (signed) */
export function formatRwf(value, { signed = false } = {}) {
  const n = Math.round(Number(value) || 0);
  const abs = integer.format(Math.abs(n));
  if (signed) return n === 0 ? 'RWF 0' : `${n > 0 ? '+' : '−'}RWF ${abs}`;
  return n < 0 ? `−RWF ${abs}` : `RWF ${abs}`;
}

/** Compact form for dense spots: RWF 1.35M · RWF 620K */
export function formatRwfCompact(value) {
  const n = Math.round(Number(value) || 0);
  const abs = Math.abs(n);
  const sign = n < 0 ? '−' : '';
  if (abs >= 1e6) return `${sign}RWF ${(abs / 1e6).toFixed(abs >= 1e7 ? 1 : 2).replace(/\.?0+$/, '')}M`;
  if (abs >= 1e4) return `${sign}RWF ${Math.round(abs / 1e3)}K`;
  return formatRwf(n);
}

export function formatNumber(value) {
  return integer.format(Number(value) || 0);
}

export function formatPercentChange(current, previous) {
  if (!previous) return null;
  const pct = ((Number(current) - Number(previous)) / Number(previous)) * 100;
  return `${pct >= 0 ? '+' : '−'}${Math.abs(pct).toFixed(Math.abs(pct) < 10 ? 1 : 0)}%`;
}

/** Accepts 'YYYY-MM-DD' (treated as a calendar date, no timezone shift) or a timestamp. */
function toDate(value) {
  if (!value) return null;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  return new Date(value);
}

export function formatDate(value, { weekday = false } = {}) {
  const d = toDate(value);
  if (!d || Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', { ...(weekday ? { weekday: 'short' } : {}), day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatTime(value) {
  const d = toDate(value);
  if (!d) return '';
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

export function formatDateTime(value) {
  const d = toDate(value);
  if (!d) return '';
  return `${formatDate(d)} · ${formatTime(d)}`;
}

/** "Today · 10:42", "Yesterday · 21:04", else "24 Sep 2026 · 10:42" */
export function formatWhen(value, t) {
  const d = toDate(value);
  if (!d) return '';
  const today = new Date();
  const startOf = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOf(today) - startOf(d)) / 86400000);
  if (days === 0) return `${t('time.today')} · ${formatTime(d)}`;
  if (days === 1) return `${t('time.yesterday')} · ${formatTime(d)}`;
  return formatDateTime(d);
}
