import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Activity, BellRing, PackageX, ShieldAlert, Store } from 'lucide-react';
import client from '../../api/client';
import { useNotifications } from '../../context/NotificationContext';
import { Panel, Metric, StatusBadge, ErrorState, SkeletonPanel, Alert } from '../../ui/display';
import DataTable from '../../ui/DataTable';
import BarChart from '../../ui/BarChart';
import { formatNumber, formatWhen, formatDate } from '../../ui/format';
import AdminSection from './AdminSection';

/** System monitoring: notifications, delivery, business alerts, security, health. */
export default function OverviewTab() {
  const { t } = useTranslation();
  const { version } = useNotifications();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      setData((await client.get('/admin/monitoring')).data);
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, version]);

  const section = (children) => (
    <AdminSection title={t('admin.sections.monitoring.title')} description={t('admin.sections.monitoring.description')}>{children}</AdminSection>
  );
  if (error) return section(<ErrorState error={error} onRetry={load} />);
  if (!data) return section(<div className="stack"><SkeletonPanel lines={3} /><SkeletonPanel lines={5} /></div>);

  const { notifications: n, delivery: d, business: b, security: s, system } = data;
  const days = [];
  for (let i = 13; i >= 0; i -= 1) {
    const dt = new Date();
    dt.setDate(dt.getDate() - i);
    const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
    const rows = n.by_day.filter((r) => r.day === key);
    days.push({
      label: formatDate(key), shortLabel: key.slice(8), value: rows.reduce((a, r) => a + r.count, 0),
      tone: rows.some((r) => r.severity === 'critical') ? 'danger' : rows.some((r) => r.severity === 'warning') ? 'warning' : undefined,
    });
  }
  const tone = (v, bad = 'danger') => (v ? bad : undefined);

  return section(
    <div className="stack">
      {system.worker.stale && <Alert tone="danger" title={t('admin.overview.workerStaleTitle')}>{t('admin.overview.workerStaleHint')}</Alert>}
      {system.worker.last_error && <Alert tone="warning" title={t('admin.overview.workerError')}>{system.worker.last_error}</Alert>}

      <Panel title={t('admin.overview.system')} icon={Activity}>
        <div className="metric-strip">
          <Metric size="sm" label={t('admin.overview.worker')} value={system.worker.stale ? t('admin.overview.workerStale') : t('admin.overview.workerOk')} tone={system.worker.stale ? 'danger' : 'success'} />
          <Metric size="sm" label={t('admin.overview.backlog')} value={formatNumber(system.delivery_backlog)} tone={system.delivery_backlog > 20 ? 'warning' : undefined} />
          <Metric size="sm" label={t('admin.overview.deadDeliveries')} value={formatNumber(system.dead_deliveries)} tone={tone(system.dead_deliveries)} />
          <Metric size="sm" label={t('admin.overview.errors24h')} value={formatNumber(system.errors_24h)} tone={tone(system.errors_24h)} />
        </div>
      </Panel>

      <Panel title={t('admin.overview.notifications')} icon={BellRing}>
        <div className="metric-strip">
          <Metric size="sm" label={t('admin.overview.today')} value={formatNumber(n.today)} />
          <Metric size="sm" label={t('admin.overview.unread')} value={formatNumber(n.unread)} tone={tone(n.unread, 'warning')} />
          <Metric size="sm" label={t('admin.overview.openCritical')} value={formatNumber(n.open_critical)} tone={tone(n.open_critical)} />
          <Metric size="sm" label={t('admin.overview.critical30d')} value={formatNumber(n.by_severity.critical || 0)} tone={tone(n.by_severity.critical)} />
          <Metric size="sm" label={t('admin.overview.warning30d')} value={formatNumber(n.by_severity.warning || 0)} tone={tone(n.by_severity.warning, 'warning')} />
          <Metric size="sm" label={t('admin.overview.info30d')} value={formatNumber(n.by_severity.info || 0)} />
        </div>
        <BarChart caption={t('admin.overview.volumeCaption')} data={days} format={(v) => t('admin.overview.eventsCount', { count: v })} height={120} />
        <h3 className="subheading">{t('admin.overview.delivery')}</h3>
        <div className="metric-strip">
          <Metric size="sm" label={t('admin.overview.sentToday')} value={formatNumber(d.sent_today)} />
          <Metric size="sm" label={t('admin.overview.successRate')} value={d.success_rate === null ? '—' : `${d.success_rate}%`} tone={d.success_rate !== null && d.success_rate < 90 ? 'danger' : undefined} />
          <Metric size="sm" label={t('admin.overview.failed')} value={formatNumber((d.by_status.failed || 0) + (d.by_status.dead || 0))} tone={tone(d.by_status.dead)} />
          <Metric size="sm" label={t('admin.overview.retries')} value={formatNumber(d.retries)} />
          <Metric size="sm" label={t('admin.overview.skipped')} value={formatNumber(d.by_status.skipped || 0)} />
          <Metric size="sm" label={t('admin.overview.avgSend')} value={d.avg_seconds_to_send === null ? '—' : `${d.avg_seconds_to_send}s`} />
        </div>
      </Panel>

      <Panel title={t('admin.overview.business')} icon={Store}>
        <div className="metric-strip">
          <Metric size="sm" label={t('admin.overview.lowStock')} value={formatNumber(b.low_stock.length)} tone={tone(b.low_stock.length, 'warning')} />
          <Metric size="sm" label={t('admin.overview.outOfStock')} value={formatNumber(b.out_of_stock.length)} tone={tone(b.out_of_stock.length)} />
          <Metric size="sm" label={t('admin.overview.voids7d')} value={formatNumber(b.voids_7d)} tone={tone(b.voids_7d, 'warning')} />
          <Metric size="sm" label={t('admin.overview.refunds7d')} value={formatNumber(b.refunds_7d)} />
          <Metric size="sm" label={t('admin.overview.largeSales7d')} value={formatNumber(b.large_sales_7d)} />
          <Metric size="sm" label={t('admin.overview.overpayments30d')} value={formatNumber(b.overpayments_30d)} tone={tone(b.overpayments_30d, 'warning')} />
          <Metric size="sm" label={t('admin.overview.overdueSupplier')} value={formatNumber(b.overdue_supplier_payments)} tone={tone(b.overdue_supplier_payments)} />
          <Metric size="sm" label={t('admin.overview.shrinkage30d')} value={formatNumber(b.shrinkage_events_30d)} />
        </div>
        {(b.low_stock.length > 0 || b.out_of_stock.length > 0) && (
          <DataTable caption={t('admin.overview.stockTable')} rows={[...b.out_of_stock, ...b.low_stock].slice(0, 15)} pageSize={15}
            columns={[
              { key: 'name', header: t('common.product'), mobile: 'title' },
              { key: 'sku', header: t('products.sku'), mobile: 'subtitle' },
              { key: 'total', header: t('products.stock'), align: 'right', mobile: 'value', render: (p) => (p.total === 0 ? <StatusBadge tone="danger">{t('products.stockOut')}</StatusBadge> : <StatusBadge tone="warning">{formatNumber(p.total)}</StatusBadge>) },
              { key: 'reorder_level', header: t('products.reorderLevel'), align: 'right', render: (p) => formatNumber(p.reorder_level) },
            ]} empty={{ icon: PackageX, title: t('dashboard.stockOk') }} />
        )}
      </Panel>

      {s && (
        <Panel title={t('admin.overview.security')} icon={ShieldAlert}>
          <div className="metric-strip">
            <Metric size="sm" label={t('admin.overview.failedLogins24h')} value={formatNumber(s.failed_logins_24h)} tone={tone(s.failed_logins_24h, 'warning')} />
            <Metric size="sm" label={t('admin.overview.failedLogins7d')} value={formatNumber(s.failed_logins_7d)} />
            <Metric size="sm" label={t('admin.overview.accessDenied7d')} value={formatNumber(s.access_denied_7d)} tone={tone(s.access_denied_7d, 'warning')} />
            <Metric size="sm" label={t('admin.overview.roleChanges30d')} value={formatNumber(s.role_changes_30d)} />
            <Metric size="sm" label={t('admin.overview.usersCreated30d')} value={formatNumber(s.users_created_30d)} />
            <Metric size="sm" label={t('admin.overview.usersDisabled30d')} value={formatNumber(s.users_disabled_30d)} />
            <Metric size="sm" label={t('admin.overview.passwordResets30d')} value={formatNumber(s.password_resets_30d)} />
          </div>
          {s.recent.length > 0 && (
            <DataTable caption={t('admin.overview.recentSecurity')} rows={s.recent} pageSize={10}
              columns={[
                { key: 'created_at', header: t('common.date'), mobile: 'subtitle', render: (r) => formatWhen(r.created_at, t) },
                { key: 'action', header: t('admin.audit.action'), mobile: 'title', render: (r) => <code>{r.action}</code> },
                { key: 'actor_role', header: t('admin.audit.role'), render: (r) => r.actor_role || '—' },
                { key: 'entity', header: t('admin.audit.entity'), render: (r) => (r.entity_type ? `${r.entity_type} ${r.entity_id || ''}` : '—') },
                { key: 'result', header: t('admin.audit.result'), mobile: 'meta', render: (r) => <StatusBadge tone={r.result === 'success' ? 'success' : 'danger'}>{t(`admin.audit.results.${r.result}`)}</StatusBadge> },
                { key: 'ip', header: 'IP', render: (r) => <span className="num">{r.ip || '—'}</span> },
              ]} />
          )}
        </Panel>
      )}
      <p className="field-hint">{t('admin.overview.generatedAt', { time: formatWhen(data.generated_at, t) })}</p>
    </div>
  );
}
