import { useState, useEffect, useCallback } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Banknote, Boxes, History, ReceiptText } from 'lucide-react';
import client from '../api/client';
import { useAuth } from '../context/AuthContext';
import DocumentActions from '../components/documents/DocumentActions';
import BarChart from '../ui/BarChart';
import Button from '../ui/Button';
import DataTable from '../ui/DataTable';
import { Field, Input } from '../ui/Field';
import { DescriptionList, ErrorState, Metric, PageHeader, Panel, SkeletonPanel, StatusBadge } from '../ui/display';
import { formatRwf, formatRwfCompact, formatDate, formatDateTime, formatNumber, formatWhen } from '../ui/format';

const localDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const daysAgo = (n) => localDate(new Date(Date.now() - n * 86400000));
const PRESETS = { today: () => [daysAgo(0), daysAgo(0)], week: () => [daysAgo(6), daysAgo(0)], month: () => [daysAgo(29), daysAgo(0)], quarter: () => [daysAgo(89), daysAgo(0)] };
const BAND_TONE = { normal: 'success', attention: 'warning', critical: 'danger' };
const humanize = (s) => String(s || '').replace(/[._]/g, ' ');

/**
 * Employee 360°: what one employee did in a period - sales, money collected,
 * cash accountability (their closings and variances), stock handled and their
 * audit trail. Managers see anyone; everyone sees themselves (self).
 */
export default function EmployeeProfile({ self = false }) {
  const { t } = useTranslation();
  const params = useParams();
  const { hasPermission } = useAuth();
  const id = self ? 'me' : params.id;
  const [[from, to], setRange] = useState(PRESETS.month());
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const { data: d } = await client.get(`/documents/employees/${id}`, { params: { from, to } });
      setData(d);
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, [id, from, to]);

  useEffect(() => {
    load();
  }, [load]);

  if (error && !data) return <div className="page"><ErrorState error={error} onRetry={load} /></div>;
  if (!data) return <div className="page"><SkeletonPanel lines={10} /></div>;

  const e = data.employee;
  const d = data.days;
  const methods = Object.keys({ ...data.sales.by_method, ...data.collections.by_method });
  const canOpenDays = hasPermission('day.history.view');
  const slug = e.full_name.toLowerCase().replace(/[^a-z0-9]+/g, '-');

  return (
    <div className="page">
      <PageHeader
        title={self ? t('employee360.myTitle') : e.full_name}
        subtitle={`${t(`roles.${e.role}`, { defaultValue: e.role })} · ${t('employee360.lastLogin', { when: e.last_login_at ? formatWhen(e.last_login_at, t) : t('employees.never') })}`}
        actions={(
          <>
            {!self && <Button icon={ArrowLeft} to="/admin/users">{t('employees.title')}</Button>}
            <DocumentActions path={`/documents/employees/${id}`} params={{ from, to }} filename={`employee-${slug}-${from}-${to}.pdf`} printLabel={t('employee360.printReport')} />
          </>
        )}
      >
        <div className="record-card-badges profile-badges">
          <StatusBadge tone={e.status === 'active' ? 'success' : 'neutral'}>{t(`badges.${e.status}`, { defaultValue: e.status })}</StatusBadge>
        </div>
      </PageHeader>

      <div className="profile-period">
        {Object.keys(PRESETS).map((p) => {
          const [f, tt] = PRESETS[p]();
          return <button key={p} type="button" className="chip" aria-pressed={from === f && to === tt} onClick={() => setRange([f, tt])}>{t(`employee360.presets.${p}`)}</button>;
        })}
        <Field label={t('profile.from')} inline><Input type="date" value={from} max={to} onChange={(ev) => ev.target.value && setRange([ev.target.value, to])} /></Field>
        <Field label={t('profile.to')} inline><Input type="date" value={to} min={from} max={daysAgo(0)} onChange={(ev) => ev.target.value && setRange([from, ev.target.value])} /></Field>
      </div>

      <div className="ledger-summary profile-headline">
        <Metric size="lg" label={t('employee360.tillSales')} value={formatRwf(data.sales.total)} hint={t('employee360.salesCount', { count: data.sales.count })} />
        <Metric size="lg" label={t('employee360.collected')} value={formatRwf(data.collections.total)} hint={t('employee360.paymentsCount', { count: data.collections.count })} />
        <Metric size="lg" label={t('employee360.onAccount')} value={formatRwf(data.on_account.total)} hint={t('finance.invoicesCount', { count: data.on_account.count })} />
        <Metric size="lg" label={t('employee360.cashVariance')} value={formatRwf(d.total_variance, { signed: true })}
          tone={d.critical ? 'danger' : d.attention ? 'warning' : undefined} hint={t('employee360.closingsCount', { count: d.closings_submitted })} />
      </div>

      <div className="finance-grid">
        <Panel title={t('employee360.salesAndMoney')} icon={ReceiptText}>
          <DescriptionList items={[
            { label: t('employee360.voids'), value: `${formatNumber(data.sales.voids.count)} · ${formatRwf(data.sales.voids.total)}` },
            { label: t('employee360.refunds'), value: `${formatNumber(data.refunds.count)} · ${formatRwf(data.refunds.total)}` },
            { label: t('employee360.supplierPayments'), value: `${formatNumber(data.supplier_payments.count)} · ${formatRwf(data.supplier_payments.total)}` },
            { label: t('employee360.reversals'), value: formatNumber(data.reversals_made) },
            { label: t('employee360.denied'), value: formatNumber(data.access_denied), tone: data.access_denied ? 'warning' : undefined },
            ...methods.map((m) => ({
              label: t(`paymentMethods.${m}`, { defaultValue: m }),
              value: `${formatRwf(data.sales.by_method[m] || 0)} · ${t('employee360.collectedShort', { amount: formatRwf(data.collections.by_method[m] || 0) })}`,
            })),
          ]} />
        </Panel>
        <Panel title={t('employee360.salesByDay')}>
          {data.sales.by_day.length === 0 ? <p className="text-secondary">{t('employee360.noSales')}</p> : (
            <BarChart data={data.sales.by_day.map((x) => ({ label: formatDate(x.date), shortLabel: x.date.slice(8), value: x.total }))} format={formatRwfCompact} caption={t('employee360.salesByDay')} />
          )}
        </Panel>
      </div>

      <Panel title={t('employee360.cashTitle')} subtitle={t('employee360.cashHint')} icon={Banknote} className="profile-section">
        <div className="ledger-summary">
          <Metric label={t('employee360.daysOpened')} value={formatNumber(d.opened)} />
          <Metric label={t('employee360.shortages')} value={formatRwf(d.shortages, { signed: true })} tone={d.shortages < 0 ? 'danger' : undefined} />
          <Metric label={t('employee360.overages')} value={formatRwf(d.overages, { signed: true })} />
          <Metric label={t('employee360.flagged')} value={`${d.attention} / ${d.critical}`} hint={t('employee360.flaggedHint')} />
        </div>
        <DataTable
          caption={t('employee360.cashTitle')}
          rowKey="day_id"
          columns={[
            {
              key: 'business_date', header: t('common.date'), mobile: 'title',
              render: (c) => (canOpenDays ? <Link to={`/business-days/${c.day_id}`}>{formatDate(c.business_date)}</Link> : formatDate(c.business_date)),
            },
            { key: 'expected_cash', header: t('businessDay.fig.expectedCash'), align: 'right', render: (c) => formatRwf(c.expected_cash) },
            { key: 'counted_cash', header: t('businessDay.fig.countedCash'), align: 'right', render: (c) => formatRwf(c.counted_cash) },
            { key: 'variance', header: t('businessDay.fig.variance'), align: 'right', mobile: 'value', render: (c) => formatRwf(c.variance, { signed: true }) },
            { key: 'variance_band', header: t('common.status'), mobile: 'meta', render: (c) => <StatusBadge tone={BAND_TONE[c.variance_band]}>{t(`employee360.band.${c.variance_band}`)}</StatusBadge> },
            { key: 'explanation', header: t('employee360.explanation'), render: (c) => <span className="text-secondary">{c.explanation || '—'}</span> },
          ]}
          rows={d.closings}
          pageSize={10}
          empty={{ icon: Banknote, title: t('employee360.noClosings') }}
        />
      </Panel>

      <Panel title={t('employee360.stockTitle')} icon={Boxes} className="profile-section">
        <DescriptionList items={[
          { label: t('employee360.deliveries'), value: `${formatNumber(data.deliveries_received.count)} · ${formatRwf(data.deliveries_received.total)}` },
          ...data.stock_movements.map((m) => ({ label: t(`movementTypes.${m.type}`, { defaultValue: humanize(m.type) }), value: t('employee360.movementValue', { count: m.count, units: m.quantity }) })),
        ]} />
      </Panel>

      {data.activity && (
        <Panel title={t('employee360.activityTitle')} subtitle={t('employee360.activityHint')} icon={History} className="profile-section" padded={false}>
          <DataTable
            caption={t('employee360.activityTitle')}
            columns={[
              { key: 'created_at', header: t('profile.when'), mobile: 'subtitle', render: (a) => formatDateTime(a.created_at) },
              { key: 'action', header: t('profile.what'), mobile: 'title', render: (a) => t(`profile.actions.${a.action.replace(/\./g, '_')}`, { defaultValue: humanize(a.action) }) },
              { key: 'entity', header: t('employee360.record'), render: (a) => (a.entity_type ? `${humanize(a.entity_type)} #${a.entity_id || '—'}` : '—'), searchValue: (a) => `${a.entity_type} ${a.entity_id}` },
              { key: 'result', header: t('common.status'), mobile: 'meta', render: (a) => <StatusBadge tone={a.result === 'success' ? 'success' : 'danger'}>{humanize(a.result)}</StatusBadge> },
            ]}
            rows={data.activity}
            searchable
            searchPlaceholder={t('profile.searchActivity')}
            empty={{ icon: History, title: t('profile.noActivity') }}
          />
        </Panel>
      )}
    </div>
  );
}
