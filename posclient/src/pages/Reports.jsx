import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { BarChart3, PackageX, Wallet } from 'lucide-react';
import client from '../api/client';
import { useAuth } from '../context/AuthContext';
import { PageHeader, Panel, Metric, ErrorState, SkeletonPanel, EmptyState, DescriptionList } from '../ui/display';
import { Field, Input } from '../ui/Field';
import DataTable from '../ui/DataTable';
import BarChart from '../ui/BarChart';
import { formatRwf, formatRwfCompact, formatNumber, formatDate } from '../ui/format';

function isoDaysAgo(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const PRESETS = [7, 30, 90];

export default function Reports() {
  const { t } = useTranslation();
  const { hasPermission } = useAuth();
  const [from, setFrom] = useState(isoDaysAgo(30));
  const [to, setTo] = useState(isoDaysAgo(0));
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  const canSales = hasPermission('reports.sales.view');
  const canShrinkage = hasPermission('reports.shrinkage.view');
  const canFinancial = hasPermission('reports.financial.view');

  const load = useCallback(async () => {
    setData(null);
    try {
      const params = { from, to };
      const [sales, top, shrinkage, financial] = await Promise.all([
        canSales ? client.get('/reports/sales-summary', { params }) : null,
        canSales ? client.get('/reports/top-products', { params: { ...params, limit: 8 } }) : null,
        canShrinkage ? client.get('/reports/shrinkage', { params }) : null,
        canFinancial ? client.get('/reports/financial-summary', { params }) : null,
      ]);
      setData({ sales: sales?.data, top: top?.data, shrinkage: shrinkage?.data, financial: financial?.data });
      setError(null);
    } catch (err) {
      setError(err);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to]);

  useEffect(() => {
    load();
  }, [load]);

  const activePreset = PRESETS.find((d) => from === isoDaysAgo(d) && to === isoDaysAgo(0));
  const f = data?.financial;
  const s = data?.sales;

  return (
    <div className="page">
      <PageHeader title={t('reports.title')} subtitle={t('reports.period', { from: formatDate(from), to: formatDate(to) })} />

      <div className="report-filters">
        <div className="segmented" role="group" aria-label={t('reports.quickRange')}>
          {PRESETS.map((d) => (
            <button key={d} type="button" className={`segmented-option${activePreset === d ? ' active' : ''}`} aria-pressed={activePreset === d}
              onClick={() => { setFrom(isoDaysAgo(d)); setTo(isoDaysAgo(0)); }}>
              {t('reports.lastDays', { count: d })}
            </button>
          ))}
        </div>
        <Field label={t('reports.from')} inline><Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label={t('reports.to')} inline><Input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></Field>
      </div>

      {error && <ErrorState error={error} onRetry={load} />}
      {!canSales && !canShrinkage && !canFinancial && <EmptyState icon={BarChart3} title={t('reports.noPermission')} />}
      {!data && !error && <div className="stack"><SkeletonPanel lines={3} /><SkeletonPanel lines={6} /></div>}

      {data && (
        <div className="stack">
          {f && (
            <Panel title={t('reports.financialSummary')} icon={Wallet}>
              <div className="report-headline">
                <Metric size="xl" label={t('reports.revenue')} value={formatRwf(f.revenue)}
                  hint={t('reports.revenueSplit', { pos: formatRwf(f.pos_revenue), institutions: formatRwf(f.institution_revenue) })} />
                <Metric size="lg" label={t('reports.grossProfit')} value={formatRwf(f.gross_profit)} tone={f.gross_profit < 0 ? 'danger' : undefined} />
                <Metric size="lg" label={t('reports.netProfit')} value={formatRwf(f.net_profit)} tone={f.net_profit < 0 ? 'danger' : 'success'} hint={t('reports.afterShrinkage')} />
              </div>
              <DescriptionList className="report-dl" items={[
                { label: t('reports.cogs'), value: formatRwf(f.cogs) },
                { label: t('reports.shrinkageValue'), value: formatRwf(-f.shrinkage_value), tone: f.shrinkage_value ? 'danger' : undefined },
                { label: t('reports.supplierPayablesOwed'), value: formatRwf(f.supplier_payables_outstanding), tone: f.supplier_payables_outstanding ? 'warning' : undefined },
                { label: t('reports.institutionReceivablesDue'), value: formatRwf(f.institution_receivables_outstanding) },
              ]} />
            </Panel>
          )}

          {s && (
            <Panel title={t('reports.salesSection')} icon={BarChart3}>
              <div className="metric-strip">
                <Metric size="sm" label={t('reports.salesCount')} value={formatNumber(s.sale_count)} />
                <Metric size="sm" label={t('reports.revenue')} value={formatRwf(s.revenue)} />
                <Metric size="sm" label={t('reports.averageSale')} value={formatRwf(s.sale_count ? s.revenue / s.sale_count : 0)} />
                <Metric size="sm" label={t('reports.voidedSales')} value={formatNumber(s.voided_count)} tone={s.voided_count ? 'danger' : undefined} />
              </div>
              {s.by_day.length > 0 ? (
                <BarChart caption={t('reports.revenueByDay')} format={formatRwf}
                  data={s.by_day.map((d) => ({ label: formatDate(String(d.day).slice(0, 10)), shortLabel: String(d.day).slice(8, 10), value: d.revenue }))} />
              ) : (
                <EmptyState compact icon={BarChart3} title={t('reports.noSalesInPeriod')} />
              )}
              <div className="grid-2 report-tables">
                <DataTable caption={t('reports.paymentMethod')} rowKey="payment_method" rows={s.by_payment_method} pageSize={10}
                  empty={{ title: t('reports.noSalesInPeriod') }}
                  columns={[
                    { key: 'payment_method', header: t('reports.paymentMethod'), mobile: 'title', render: (r) => t(`paymentMethods.${r.payment_method}`, { defaultValue: r.payment_method.replace('_', ' ') }) },
                    { key: 'sale_count', header: t('reports.sales'), align: 'right', render: (r) => formatNumber(r.sale_count) },
                    { key: 'revenue', header: t('reports.revenue'), align: 'right', mobile: 'value', render: (r) => formatRwf(r.revenue) },
                  ]} />
                <DataTable caption={t('reports.topProducts')} rowKey="product_id" rows={data.top} pageSize={10}
                  empty={{ title: t('reports.noSalesInPeriod') }}
                  columns={[
                    { key: 'name', header: t('reports.topProducts'), mobile: 'title' },
                    { key: 'quantity_sold', header: t('reports.qtySold'), align: 'right', render: (p) => formatNumber(p.quantity_sold) },
                    { key: 'revenue', header: t('reports.revenue'), align: 'right', mobile: 'value', render: (p) => formatRwfCompact(p.revenue) },
                  ]} />
              </div>
            </Panel>
          )}

          {data.shrinkage && (
            <Panel title={t('reports.shrinkageSection')} icon={PackageX}>
              <div className="metric-strip">
                <Metric size="sm" label={t('reports.totalQuantityLost')} value={formatNumber(data.shrinkage.quantity)} tone={data.shrinkage.quantity ? 'danger' : undefined} />
                <Metric size="sm" label={t('reports.totalValueLost')} value={formatRwf(data.shrinkage.value)} tone={data.shrinkage.value ? 'danger' : undefined} />
              </div>
              <DataTable caption={t('reports.shrinkageSection')} rowKey="cause" rows={data.shrinkage.by_cause}
                empty={{ icon: PackageX, title: t('reports.noShrinkageInPeriod') }}
                columns={[
                  { key: 'cause', header: t('reports.cause'), mobile: 'title', render: (r) => t(`causes.${r.cause}`, { defaultValue: r.cause }) },
                  { key: 'quantity', header: t('common.quantity'), align: 'right', render: (r) => formatNumber(r.quantity) },
                  { key: 'value', header: t('reports.value'), align: 'right', mobile: 'value', render: (r) => formatRwf(r.value) },
                ]} />
            </Panel>
          )}
        </div>
      )}
    </div>
  );
}
