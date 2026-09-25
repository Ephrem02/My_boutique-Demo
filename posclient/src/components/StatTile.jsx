export default function StatTile({ label, value, tone }) {
  const colors = {
    bad: ['var(--danger-soft)', 'var(--danger)'],
    warn: ['var(--warn-soft)', 'var(--warn)'],
  }[tone] || ['var(--accent-soft)', 'var(--accent-ink)'];
  return (
    <div className="unpaid-card" style={{ background: colors[0] }}>
      <div className="unpaid-card-name">{label}</div>
      <div className="unpaid-card-amount num" style={{ color: colors[1] }}>
        {value}
      </div>
    </div>
  );
}
