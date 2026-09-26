import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { ReceiptText, Undo2 } from 'lucide-react';
import client from '../api/client';
import { useAuth } from '../context/AuthContext';
import SaleDetail from '../components/SaleDetail';
import { PageHeader, Panel, Metric, StatusBadge, Tabs } from '../ui/display';
import DataTable from '../ui/DataTable';
import { formatRwf, formatWhen, formatNumber } from '../ui/format';

export default function SalesHistory() {
  const { t } = useTranslation();
  const { hasPermission } = useAuth();
  // Without sales.view_all the API only returns this user's own sales, so the
  // page becomes "My sales" with a personal summary instead of shop totals.
  const ownOnly = !hasPermission('sales.view_all');
  const [sales, setSales] = useState(null);
  const [returns, setReturns] = useState(null);
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState('sales');
  const [selectedId, setSelectedId] = useState(null);

  const load = useCallback(async () => {
    try {
      const now = new Date();
      const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      const [{ data: salesData }, returnsRes, summaryRes] = await Promise.all([
        client.get('/sales'),
        hasPermission('returns.process') ? client.get('/returns') : Promise.resolve(null),
        ownOnly ? client.get('/reports/my-summary', { params: { from: today, to: today } }) : Promise.resolve(null),
      ]);
      setSales(salesData);
      setReturns(returnsRes ? returnsRes.data : []);
      if (summaryRes) setSummary(summaryRes.data);
      setError(null);
    } catch (err) {
      setError(err);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const method = (m) => t(`paymentMethods.${m}`, { defaultValue: m.replace('_', ' ') });
  const saleColumns = [
    { key: 'id', header: t('salesHistory.saleNo'), sortable: true, mobile: 'title', sortValue: (s) => s.id, render: (s) => <span className="num">#{s.id}</span> },
    { key: 'created_at', header: t('common.date'), sortable: true, mobile: 'subtitle', render: (s) => formatWhen(s.created_at, t) },
    !ownOnly && { key: 'cashier_name', header: t('salesHistory.cashier'), sortable: true },
    { key: 'payment_method', header: t('salesHistory.payment'), sortable: true, render: (s) => method(s.payment_method) },
    { key: 'total_amount', header: t('common.total'), align: 'right', sortable: true, mobile: 'value', sortValue: (s) => Number(s.total_amount), render: (s) => formatRwf(s.total_amount) },
    { key: 'status', header: t('common.status'), sortable: true, mobile: 'meta', render: (s) => <StatusBadge tone={s.status === 'voided' ? 'danger' : 'success'}>{t(`badges.${s.status}`)}</StatusBadge> },
  ].filter(Boolean);

  const returnColumns = [
    { key: 'created_at', header: t('common.date'), sortable: true, mobile: 'subtitle', render: (r) => formatWhen(r.created_at, t) },
    { key: 'product_name', header: t('common.product'), sortable: true, mobile: 'title' },
    { key: 'sale_id', header: t('salesHistory.saleNo'), render: (r) => <span className="num">#{r.sale_id}</span> },
    { key: 'quantity', header: t('salesHistory.qty'), align: 'right', render: (r) => formatNumber(r.quantity) },
    { key: 'refund_amount', header: t('salesHistory.refund'), align: 'right', mobile: 'value', render: (r) => formatRwf(r.refund_amount) },
    { key: 'restocked', header: t('salesHistory.restocked'), mobile: 'meta', render: (r) => <StatusBadge tone={r.restocked ? 'success' : 'neutral'}>{r.restocked ? t('salesHistory.backOnShelf') : t('salesHistory.writeOff')}</StatusBadge> },
    { key: 'reason', header: t('salesHistory.reason'), render: (r) => <span className="text-secondary">{r.reason || '—'}</span> },
    { key: 'processed_by_name', header: t('salesHistory.processedBy') },
  ];

  const showReturnsTab = hasPermission('returns.process');
  return (
    <div className="page">
      <PageHeader title={ownOnly ? t('salesHistory.myTitle') : t('salesHistory.title')} subtitle={ownOnly ? t('salesHistory.mySubtitle') : t('salesHistory.subtitle')} />

      {summary && (
        <Panel className="summary-panel" title={t('salesHistory.today')}>
          <div className="metric-strip">
            <Metric size="sm" label={t('salesHistory.mySalesToday')} value={formatNumber(summary.my_sale_count)} />
            <Metric size="sm" label={t('salesHistory.myRevenueToday')} value={formatRwf(summary.my_revenue)} />
            <Metric size="sm" label={t('salesHistory.myVoidedToday')} value={formatNumber(summary.my_voided_count)} tone={summary.my_voided_count ? 'danger' : undefined} />
            <Metric size="sm" label={t('salesHistory.shopLowStock')} value={formatNumber(summary.shop_low_stock_count)} tone={summary.shop_low_stock_count ? 'warning' : undefined} />
            <Metric size="sm" label={t('salesHistory.shopOutOfStock')} value={formatNumber(summary.shop_out_of_stock_count)} tone={summary.shop_out_of_stock_count ? 'danger' : undefined} />
          </div>
        </Panel>
      )}

      {showReturnsTab && (
        <Tabs label={t('salesHistory.title')} value={tab} onChange={setTab} className="page-tabs"
          items={[{ id: 'sales', label: t('salesHistory.salesTab'), count: sales?.length }, { id: 'returns', label: t('salesHistory.recentReturns'), count: returns?.length }]} />
      )}

      {tab === 'sales' && (
        <DataTable caption={t('salesHistory.title')} columns={saleColumns} rows={sales} loading={!sales} error={error} onRetry={load}
          onRowClick={(s) => setSelectedId(s.id)} rowLabel={(s) => t('salesHistory.openSale', { id: s.id })}
          searchable searchPlaceholder={t('salesHistory.search')} initialSort={{ key: 'id', dir: 'desc' }}
          empty={{ icon: ReceiptText, title: t('salesHistory.noSales'), description: t('salesHistory.noSalesHint') }} />
      )}
      {tab === 'returns' && (
        <DataTable caption={t('salesHistory.recentReturns')} columns={returnColumns} rows={returns} loading={!returns} error={error} onRetry={load}
          searchable empty={{ icon: Undo2, title: t('salesHistory.noReturns') }} />
      )}

      {selectedId && <SaleDetail saleId={selectedId} onClose={() => setSelectedId(null)} onChanged={load} />}
    </div>
  );
}
