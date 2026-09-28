import { useTranslation } from 'react-i18next';
import { BarChart3, PackageSearch } from 'lucide-react';
import BarChart from '../../ui/BarChart';
import DataTable from '../../ui/DataTable';
import { Select } from '../../ui/Field';
import { DescriptionList, EmptyState, Metric, Panel } from '../../ui/display';
import { formatRwf, formatRwfCompact, formatDate, formatNumber } from '../../ui/format';

const pct = (v) => (v === null || v === undefined ? '—' : `${Math.round(v * 1000) / 10}%`);
const days = (t, v) => (v === null || v === undefined ? '—' : t('profile.daysValue', { count: Math.round(v) }));

/** Period for activity-based figures; balances are always "now". */
export const PERIODS = ['all', '365', '90', '30'];
export function periodRange(period) {
  if (period === 'all') return {};
  const d = new Date(Date.now() - Number(period) * 86400000);
  return { from: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` };
}

export function PeriodPicker({ value, onChange, firstActivity }) {
  const { t } = useTranslation();
  return (
    <div className="profile-period">
      <Select value={value} onChange={(e) => onChange(e.target.value)} aria-label={t('profile.period')} className="filter-select">
        {PERIODS.map((p) => <option key={p} value={p}>{t(`profile.periods.${p}`)}</option>)}
      </Select>
      <span className="field-hint">
        {value === 'all'
          ? (firstActivity ? t('profile.periodAllHint', { date: formatDate(firstActivity) }) : t('profile.noActivityYet'))
          : t('profile.periodHint')}
      </span>
    </div>
  );
}

const monthLabel = (m) => new Date(`${m}-01T12:00:00`).toLocaleDateString(undefined, { month: 'short' });
const monthFull = (m) => new Date(`${m}-01T12:00:00`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

/** How an account pays - facts only, each with how it was worked out. */
export function BehaviourPanel({ behaviour, kind }) {
  const { t } = useTranslation();
  const b = behaviour;
  return (
    <Panel title={kind === 'supplier' ? t('profile.ourPaymentRecord') : t('profile.paymentBehaviour')} subtitle={t('profile.behaviourHint')} className="profile-section">
      <div className="ledger-summary">
        <Metric label={t('profile.paidOnTime')} value={b.paid_on_time.count} hint={formatRwf(b.paid_on_time.amount)} />
        <Metric label={t('profile.paidLate')} value={b.paid_late.count} hint={formatRwf(b.paid_late.amount)} tone={b.paid_late.count ? 'warning' : undefined} />
        <Metric label={t('profile.avgDaysToPay')} value={days(t, b.avg_days_to_pay)} hint={t('profile.basedOnSettled', { count: b.settled_invoices })} />
        <Metric label={t('profile.avgDaysLate')} value={days(t, b.avg_days_late)} hint={t('profile.lateOnly')} />
      </div>
      {b.overdue_invoices.length > 0 && (
        <DescriptionList items={b.overdue_invoices.slice(0, 6).map((i) => ({
          label: t('profile.overdueLine', { id: i.id, due: formatDate(i.due_date), days: i.days_overdue }),
          value: formatRwf(i.balance), tone: 'danger',
        }))} />
      )}
      <p className="field-hint">{t('profile.behaviourMethod', { withDue: b.settled_with_due_date, settled: b.settled_invoices })}</p>
    </Panel>
  );
}

/* ---------------- Customer: purchasing insights ---------------- */

export function CustomerInsights({ insights }) {
  const { t } = useTranslation();
  const p = insights.purchasing;
  return (
    <>
      <div className="ledger-summary">
        <Metric label={t('profile.purchasesInPeriod')} value={formatNumber(p.purchases)} hint={formatRwf(p.value)} />
        <Metric label={t('profile.lastPurchase')} value={p.last_purchase_date ? formatDate(p.last_purchase_date) : '—'}
          hint={p.days_since_last_purchase !== null ? t('profile.daysAgo', { count: p.days_since_last_purchase }) : undefined} tone={p.inactive ? 'warning' : undefined} />
        <Metric label={t('profile.avgBetween')} value={days(t, p.avg_days_between_purchases)} />
        <Metric label={t('profile.highestPurchase')} value={p.highest_purchase ? formatRwf(p.highest_purchase.value) : '—'}
          hint={p.highest_purchase ? `${p.highest_purchase.kind === 'till' ? t('profile.tillSale', { id: p.highest_purchase.id }) : t('profile.onInvoice', { id: p.highest_purchase.id })} · ${formatDate(p.highest_purchase.date)}` : undefined} />
      </div>

      <div className="finance-grid">
        <Panel title={t('profile.monthlySpending')} subtitle={t('profile.last12Months')}>
          <BarChart data={p.monthly.map((m) => ({ label: monthFull(m.month), shortLabel: monthLabel(m.month), value: m.value }))} format={formatRwfCompact} caption={t('profile.monthlySpending')} />
          {p.yearly.length > 0 && <DescriptionList className="profile-section" items={p.yearly.map((y) => ({ label: y.year, value: formatRwf(y.value) }))} />}
        </Panel>
        <Panel title={t('profile.topCategories')}>
          {p.top_categories.length === 0 ? <p className="text-secondary">{t('profile.noPurchases')}</p> : (
            <DescriptionList items={p.top_categories.map((c) => ({ label: c.category || t('profile.uncategorised'), value: `${formatRwf(c.value)} · ${t('profile.units', { count: c.quantity })}` }))} />
          )}
          <h3 className="subheading">{t('profile.recentProducts')}</h3>
          {p.recent_products.length === 0 ? <p className="text-secondary">{t('profile.noPurchases')}</p> : (
            <DescriptionList items={p.recent_products.map((x) => ({ label: x.product_name, value: formatDate(x.last_date) }))} />
          )}
        </Panel>
      </div>

      <Panel title={t('profile.topProducts')} subtitle={t('profile.topProductsHint')} className="profile-section" padded={false}>
        <DataTable
          caption={t('profile.topProducts')}
          columns={[
            { key: 'product_name', header: t('common.product'), mobile: 'title', render: (x) => <>{x.product_name}<div className="text-muted">{x.sku}</div></> },
            { key: 'category', header: t('profile.category'), render: (x) => x.category || '—' },
            { key: 'quantity', header: t('delivery.qty'), align: 'right', sortable: true, mobile: 'value' },
            { key: 'times', header: t('profile.timesBought'), align: 'right', sortable: true },
            { key: 'value', header: t('profile.spent'), align: 'right', sortable: true, render: (x) => formatRwf(x.value) },
            { key: 'last_date', header: t('profile.lastBought'), mobile: 'subtitle', render: (x) => formatDate(x.last_date) },
          ]}
          rowKey="product_id"
          rows={p.top_products}
          empty={{ icon: PackageSearch, title: t('profile.noPurchases') }}
          pageSize={10}
        />
      </Panel>

      {p.most_returned.length > 0 && (
        <Panel title={t('profile.mostReturned')} className="profile-section">
          <DescriptionList items={p.most_returned.map((x) => ({ label: x.product_name, value: `${t('profile.units', { count: x.quantity })} · ${formatRwf(x.value)}` }))} />
        </Panel>
      )}
    </>
  );
}

/* ---------------- Supplier: products & pricing ---------------- */

export function SupplierProducts({ insights }) {
  const { t } = useTranslation();
  return (
    <Panel title={t('profile.productsSupplied')} subtitle={t('profile.priceHistoryHint')} padded={false}>
      <DataTable
        caption={t('profile.productsSupplied')}
        columns={[
          { key: 'product_name', header: t('common.product'), mobile: 'title', render: (x) => <>{x.product_name}<div className="text-muted">{x.sku}{x.category ? ` · ${x.category}` : ''}</div></>, searchValue: (x) => `${x.product_name} ${x.sku} ${x.category || ''}` },
          { key: 'quantity', header: t('profile.unitsReceived'), align: 'right', sortable: true },
          { key: 'times', header: t('profile.deliveries'), align: 'right', sortable: true },
          { key: 'value', header: t('profile.purchaseValue'), align: 'right', sortable: true, mobile: 'value', render: (x) => formatRwf(x.value) },
          { key: 'last_cost', header: t('profile.lastCost'), align: 'right', sortable: true, render: (x) => formatRwf(x.last_cost) },
          { key: 'range', header: t('profile.costRange'), align: 'right', render: (x) => (x.min_cost === x.max_cost ? formatRwf(x.min_cost) : `${formatRwf(x.min_cost)} – ${formatRwf(x.max_cost)}`) },
          {
            key: 'change_pct', header: t('profile.priceChange'), align: 'right', sortable: true, mobile: 'meta',
            render: (x) => (x.change_pct === null ? '—' : <span className={x.change_pct > 0 ? 'text-danger' : x.change_pct < 0 ? 'text-success' : undefined}>{x.change_pct > 0 ? '+' : ''}{x.change_pct}%</span>),
          },
          {
            key: 'history', header: t('profile.costHistory'),
            render: (x) => <span className="text-secondary">{x.history.slice(-4).map((h) => `${formatDate(h.date)}: ${formatRwf(h.unit_cost)}`).join(' · ')}</span>,
          },
          { key: 'last_date', header: t('profile.lastDelivered'), mobile: 'subtitle', render: (x) => formatDate(x.last_date) },
        ]}
        rowKey="product_id"
        rows={insights.products}
        searchable
        searchPlaceholder={t('profile.searchProducts')}
        initialSort={{ key: 'value', dir: 'desc' }}
        empty={{ icon: PackageSearch, title: t('profile.noDeliveries') }}
      />
    </Panel>
  );
}

/* ---------------- Supplier: performance ---------------- */

export function SupplierPerformance({ insights }) {
  const { t } = useTranslation();
  const p = insights.performance;
  if (!p.deliveries && !p.returns_by_reason.length) {
    return <EmptyState icon={BarChart3} title={t('profile.noDeliveries')} description={t('profile.noDataForPeriod')} />;
  }
  return (
    <>
      <div className="ledger-summary">
        <Metric label={t('profile.deliveries')} value={formatNumber(p.deliveries)} hint={formatRwf(p.purchase_value)} />
        <Metric label={t('profile.lastDelivery')} value={p.last_delivery_date ? formatDate(p.last_delivery_date) : '—'} hint={p.days_since_last_delivery !== null ? t('profile.daysAgo', { count: p.days_since_last_delivery }) : undefined} />
        <Metric label={t('profile.returnRate')} value={pct(p.return_rate_units)} hint={t('profile.returnRateHint', { returned: p.units_returned, received: p.units_received })} tone={p.return_rate_units > 0.05 ? 'warning' : undefined} />
        <Metric label={t('profile.qualityIssues')} value={pct(p.quality_issue_rate)} hint={t('profile.qualityIssuesHint', { count: p.quality_issue_units })} />
        <Metric label={t('profile.discrepancies')} value={formatNumber(p.discrepancy_units)} hint={t('profile.discrepanciesHint')} />
      </div>
      <div className="finance-grid">
        <Panel title={t('profile.purchasesByMonth')} subtitle={t('profile.last12Months')}>
          <BarChart data={p.monthly.map((m) => ({ label: monthFull(m.month), shortLabel: monthLabel(m.month), value: m.value }))} format={formatRwfCompact} caption={t('profile.purchasesByMonth')} />
        </Panel>
        <Panel title={t('profile.returnsByReason')} subtitle={t('profile.returnValueRate', { rate: pct(p.return_rate_value) })}>
          {p.returns_by_reason.length === 0 ? <p className="text-secondary">{t('finance.noReturns')}</p> : (
            <DescriptionList items={p.returns_by_reason.map((r) => ({
              label: `${t(`finance.reasons.${r.reason}`)} · ${t('profile.returnsCount', { count: r.returns })}`,
              value: `${t('profile.units', { count: r.quantity })} · ${formatRwf(r.value)}`,
            }))} />
          )}
          {Object.keys(p.supplier_responses).length > 0 && (
            <>
              <h3 className="subheading">{t('profile.supplierResponses')}</h3>
              <DescriptionList items={Object.entries(p.supplier_responses).map(([k, v]) => ({ label: t(`finance.supplierResponse.${k}`), value: formatNumber(v) }))} />
            </>
          )}
        </Panel>
      </div>
      <p className="field-hint profile-section">{t('profile.performanceMethod')}</p>
    </>
  );
}
