export const METHODS = ['cash', 'mtn_mobile_money', 'airtel_money', 'card'];

export const HEALTH_BADGE = { normal: 'paid', attention: 'partial', critical: 'unpaid' };

export function rwf(value) {
  return `${Math.round(Number(value) || 0).toLocaleString()} RWF`;
}

export function signedRwf(value) {
  const v = Math.round(Number(value) || 0);
  if (v === 0) return '0 RWF';
  return `${v > 0 ? '+' : '−'}${Math.abs(v).toLocaleString()} RWF`;
}

export function formatDate(date) {
  if (!date) return '';
  const [y, m, d] = String(date).slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatTime(value) {
  if (!value) return '';
  return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** Client-side mirror of the server's variance bands (display only - the server decides). */
export function bandFor(variance, thresholds) {
  const abs = Math.abs(Number(variance) || 0);
  if (abs > thresholds.critical_variance_rwf) return 'critical';
  if (abs > thresholds.attention_variance_rwf) return 'attention';
  return 'normal';
}
