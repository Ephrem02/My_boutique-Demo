import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import client from '../../api/client';
import StatTile from '../../components/StatTile';
import { useNotifications } from '../../context/NotificationContext';

const SEVERITY_COLOR = { critical: 'var(--danger)', warning: 'var(--warn)', info: 'var(--accent)' };

/** 14-day stacked bars of notification volume by severity (no chart library needed). */
function VolumeChart({ byDay, t }) {
  const days = [];
  for (let i = 13; i >= 0; i -= 1) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
  }
  const totals = days.map((day) => {
    const rows = byDay.filter((r) => r.day === day);
    return { day, parts: ['critical', 'warning', 'info'].map((s) => ({ s, n: rows.find((r) => r.severity === s)?.count || 0 })) };
  });
  const max = Math.max(1, ...totals.map((d) => d.parts.reduce((a, p) => a + p.n, 0)));
  return (
    <div className="volume-chart" role="img" aria-label={t('admin.overview.volumeAria')}>
      {totals.map(({ day, parts }) => {
        const sum = parts.reduce((a, p) => a + p.n, 0);
        return (
          <div key={day} className="volume-col" title={`${day}: ${parts.map((p) => `${p.n} ${p.s}`).join(', ')}`}>
            <div className="volume-bar">
              {parts.filter((p) => p.n).map((p) => (
                <span key={p.s} style={{ height: `${(p.n / max) * 100}%`, background: SEVERITY_COLOR[p.s] }} />
              ))}
            </div>
            <span className="volume-label">{sum || ''}</span>
            <span className="volume-day">{day.slice(8)}</span>
          </div>
        );
      })}
    </div>
  );
}

export default function OverviewTab() {
  const { t } = useTranslation();
  const { version } = useNotifications();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setData((await client.get('/admin/monitoring')).data);
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, version]);

  if (error) return <div className="error-banner">{error}</div>;
  if (!data) return <p style={{ color: 'var(--ink-muted)' }}>{t('common.loading')}</p>;
  const { notifications: n, delivery: d, business: b, security: s, system } = data;

  return (
    <>
      <div className="section-title" style={{ marginTop: 0 }}>{t('admin.overview.notifications')}</div>
      <div className="unpaid-summary">
        <StatTile label={t('admin.overview.total')} value={n.total} />
        <StatTile label={t('admin.overview.unread')} value={n.unread} tone={n.unread ? 'warn' : undefined} />
        <StatTile label={t('admin.overview.today')} value={n.today} />
        <StatTile label={t('admin.overview.openCritical')} value={n.open_critical} tone={n.open_critical ? 'bad' : undefined} />
        <StatTile label={t('admin.overview.critical30d')} value={n.by_severity.critical || 0} tone={n.by_severity.critical ? 'bad' : undefined} />
        <StatTile label={t('admin.overview.warning30d')} value={n.by_severity.warning || 0} tone={n.by_severity.warning ? 'warn' : undefined} />
        <StatTile label={t('admin.overview.info30d')} value={n.by_severity.info || 0} />
      </div>
      <VolumeChart byDay={n.by_day} t={t} />

      <div className="section-title">{t('admin.overview.delivery')}</div>
      <div className="unpaid-summary">
        <StatTile label={t('admin.overview.sentToday')} value={d.sent_today} />
        <StatTile label={t('admin.overview.successRate')} value={d.success_rate === null ? '—' : `${d.success_rate}%`} tone={d.success_rate !== null && d.success_rate < 90 ? 'bad' : undefined} />
        <StatTile label={t('admin.overview.failed')} value={(d.by_status.failed || 0) + (d.by_status.dead || 0)} tone={(d.by_status.dead || 0) ? 'bad' : undefined} />
        <StatTile label={t('admin.overview.retries')} value={d.retries} />
        <StatTile label={t('admin.overview.skipped')} value={d.by_status.skipped || 0} />
        <StatTile label={t('admin.overview.avgSend')} value={d.avg_seconds_to_send === null ? '—' : `${d.avg_seconds_to_send}s`} />
      </div>

      <div className="section-title">{t('admin.overview.business')}</div>
      <div className="unpaid-summary">
        <StatTile label={t('admin.overview.lowStock')} value={b.low_stock.length} tone={b.low_stock.length ? 'warn' : undefined} />
        <StatTile label={t('admin.overview.outOfStock')} value={b.out_of_stock.length} tone={b.out_of_stock.length ? 'bad' : undefined} />
        <StatTile label={t('admin.overview.voids7d')} value={b.voids_7d} tone={b.voids_7d ? 'warn' : undefined} />
        <StatTile label={t('admin.overview.refunds7d')} value={b.refunds_7d} />
        <StatTile label={t('admin.overview.largeSales7d')} value={b.large_sales_7d} />
        <StatTile label={t('admin.overview.overpayments30d')} value={b.overpayments_30d} tone={b.overpayments_30d ? 'warn' : undefined} />
        <StatTile label={t('admin.overview.overdueSupplier')} value={b.overdue_supplier_payments} tone={b.overdue_supplier_payments ? 'bad' : undefined} />
        <StatTile label={t('admin.overview.shrinkage30d')} value={b.shrinkage_events_30d} />
      </div>
      {(b.low_stock.length > 0 || b.out_of_stock.length > 0) && (
        <table className="data-table" style={{ marginBottom: 28 }}>
          <thead>
            <tr><th>{t('common.product')}</th><th>{t('products.sku')}</th><th>{t('products.stock')}</th><th>{t('products.reorderLevel')}</th></tr>
          </thead>
          <tbody>
            {[...b.out_of_stock, ...b.low_stock].slice(0, 15).map((p) => (
              <tr key={p.id}>
                <td>{p.name}</td>
                <td>{p.sku}</td>
                <td className="num" style={{ color: p.total === 0 ? 'var(--danger)' : 'var(--warn)', fontWeight: 500 }}>{p.total}</td>
                <td className="num">{p.reorder_level}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {s && (
        <>
          <div className="section-title">{t('admin.overview.security')}</div>
          <div className="unpaid-summary">
            <StatTile label={t('admin.overview.failedLogins24h')} value={s.failed_logins_24h} tone={s.failed_logins_24h ? 'warn' : undefined} />
            <StatTile label={t('admin.overview.failedLogins7d')} value={s.failed_logins_7d} />
            <StatTile label={t('admin.overview.accessDenied7d')} value={s.access_denied_7d} tone={s.access_denied_7d ? 'warn' : undefined} />
            <StatTile label={t('admin.overview.roleChanges30d')} value={s.role_changes_30d} />
            <StatTile label={t('admin.overview.usersCreated30d')} value={s.users_created_30d} />
            <StatTile label={t('admin.overview.usersDisabled30d')} value={s.users_disabled_30d} />
            <StatTile label={t('admin.overview.passwordResets30d')} value={s.password_resets_30d} />
          </div>
          {s.recent.length > 0 && (
            <table className="data-table" style={{ marginBottom: 28 }}>
              <thead>
                <tr><th>{t('common.date')}</th><th>{t('admin.audit.action')}</th><th>{t('admin.audit.role')}</th><th>{t('admin.audit.entity')}</th><th>{t('admin.audit.result')}</th><th>IP</th></tr>
              </thead>
              <tbody>
                {s.recent.map((r) => (
                  <tr key={r.id}>
                    <td>{new Date(r.created_at).toLocaleString()}</td>
                    <td><code>{r.action}</code></td>
                    <td>{r.actor_role || '—'}</td>
                    <td>{r.entity_type ? `${r.entity_type} ${r.entity_id || ''}` : '—'}</td>
                    <td><span className={`badge ${r.result === 'success' ? 'paid' : 'unpaid'}`}>{r.result}</span></td>
                    <td>{r.ip || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}

      <div className="section-title">{t('admin.overview.system')}</div>
      <div className="unpaid-summary">
        <StatTile
          label={t('admin.overview.worker')}
          value={system.worker.stale ? t('admin.overview.workerStale') : t('admin.overview.workerOk')}
          tone={system.worker.stale ? 'bad' : undefined}
        />
        <StatTile label={t('admin.overview.backlog')} value={system.delivery_backlog} tone={system.delivery_backlog > 20 ? 'warn' : undefined} />
        <StatTile label={t('admin.overview.deadDeliveries')} value={system.dead_deliveries} tone={system.dead_deliveries ? 'bad' : undefined} />
        <StatTile label={t('admin.overview.errors24h')} value={system.errors_24h} tone={system.errors_24h ? 'bad' : undefined} />
      </div>
      {system.worker.last_error && <div className="error-banner">{t('admin.overview.workerError')}: {system.worker.last_error}</div>}
      <p className="hint-text">{t('admin.overview.generatedAt', { time: new Date(data.generated_at).toLocaleString() })}</p>
    </>
  );
}
