import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import client from '../api/client';
import { useAuth } from '../context/AuthContext';

function isoDaysAgo(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function StatTile({ label, value, tone }) {
  return (
    <div className="unpaid-card" style={tone === 'bad' ? { background: 'var(--danger-soft)' } : { background: 'var(--accent-soft)' }}>
      <div className="unpaid-card-name">{label}</div>
      <div className="unpaid-card-amount num" style={{ color: tone === 'bad' ? 'var(--danger)' : 'var(--accent-ink)' }}>
        {value}
      </div>
    </div>
  );
}

export default function Reports() {
  const { t } = useTranslation();
  const { hasPermission } = useAuth();
  const [from, setFrom] = useState(isoDaysAgo(30));
  const [to, setTo] = useState(isoDaysAgo(0));
  const [salesSummary, setSalesSummary] = useState(null);
  const [topProducts, setTopProducts] = useState([]);
  const [shrinkage, setShrinkage] = useState(null);
  const [financial, setFinancial] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const canSales = hasPermission('reports.sales.view');
  const canShrinkage = hasPermission('reports.shrinkage.view');
  const canFinancial = hasPermission('reports.financial.view');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = { from, to };
      const requests = [];
      if (canSales) {
        requests.push(client.get('/reports/sales-summary', { params }));
        requests.push(client.get('/reports/top-products', { params: { ...params, limit: 8 } }));
      }
      if (canShrinkage) requests.push(client.get('/reports/shrinkage', { params }));
      if (canFinancial) requests.push(client.get('/reports/financial-summary', { params }));

      const results = await Promise.all(requests);
      let i = 0;
      if (canSales) {
        setSalesSummary(results[i++].data);
        setTopProducts(results[i++].data);
      }
      if (canShrinkage) setShrinkage(results[i++].data);
      if (canFinancial) setFinancial(results[i++].data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="page-body">
      <div className="page-header">
        <h1>{t('reports.title')}</h1>
      </div>

      <div style={{ display: 'flex', gap: 10, marginBottom: 20, alignItems: 'center' }}>
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="from">{t('reports.from')}</label>
          <input id="from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="to">{t('reports.to')}</label>
          <input id="to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}
      {!canSales && !canShrinkage && !canFinancial && (
        <p style={{ color: 'var(--ink-muted)' }}>{t('reports.noPermission')}</p>
      )}

      {!loading && canFinancial && financial && (
        <>
          <div className="section-title" style={{ marginTop: 0 }}>{t('reports.financialSummary')}</div>
          <div className="unpaid-summary">
            <StatTile label={t('reports.revenue')} value={financial.revenue.toLocaleString()} />
            <StatTile label={t('reports.posRevenue')} value={financial.pos_revenue.toLocaleString()} />
            <StatTile label={t('reports.institutionRevenue')} value={financial.institution_revenue.toLocaleString()} />
            <StatTile label={t('reports.cogs')} value={financial.cogs.toLocaleString()} />
            <StatTile label={t('reports.grossProfit')} value={financial.gross_profit.toLocaleString()} />
            <StatTile label={t('reports.shrinkageValue')} value={financial.shrinkage_value.toLocaleString()} tone="bad" />
            <StatTile
              label={t('reports.netProfit')}
              value={financial.net_profit.toLocaleString()}
              tone={financial.net_profit < 0 ? 'bad' : undefined}
            />
            <StatTile label={t('reports.supplierPayablesOwed')} value={financial.supplier_payables_outstanding.toLocaleString()} tone="bad" />
            <StatTile label={t('reports.institutionReceivablesDue')} value={financial.institution_receivables_outstanding.toLocaleString()} />
          </div>
        </>
      )}

      {!loading && canSales && salesSummary && (
        <>
          <div className="section-title">{t('reports.salesSection')}</div>
          <div className="unpaid-summary">
            <StatTile label={t('reports.salesCount')} value={salesSummary.sale_count} />
            <StatTile label={t('reports.revenue')} value={salesSummary.revenue.toLocaleString()} />
            <StatTile
              label={t('reports.voidedSales')}
              value={salesSummary.voided_count}
              tone={salesSummary.voided_count > 0 ? 'bad' : undefined}
            />
          </div>

          <table className="data-table" style={{ marginBottom: 28 }}>
            <thead>
              <tr>
                <th>{t('reports.paymentMethod')}</th>
                <th>{t('nav.sales')}</th>
                <th>{t('reports.revenue')}</th>
              </tr>
            </thead>
            <tbody>
              {salesSummary.by_payment_method.map((r) => (
                <tr key={r.payment_method}>
                  <td>{t(`paymentMethods.${r.payment_method}`, { defaultValue: r.payment_method.replace('_', ' ') })}</td>
                  <td className="num">{r.sale_count}</td>
                  <td className="num">{r.revenue.toLocaleString()}</td>
                </tr>
              ))}
              {salesSummary.by_payment_method.length === 0 && (
                <tr>
                  <td colSpan={3} style={{ color: 'var(--ink-muted)' }}>
                    {t('reports.noSalesInPeriod')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          <div className="section-title">{t('reports.topProducts')}</div>
          <table className="data-table" style={{ marginBottom: 28 }}>
            <thead>
              <tr>
                <th>{t('common.product')}</th>
                <th>{t('products.sku')}</th>
                <th>{t('reports.qtySold')}</th>
                <th>{t('reports.revenue')}</th>
              </tr>
            </thead>
            <tbody>
              {topProducts.map((p) => (
                <tr key={p.product_id}>
                  <td>{p.name}</td>
                  <td>{p.sku}</td>
                  <td className="num">{p.quantity_sold}</td>
                  <td className="num">{p.revenue.toLocaleString()}</td>
                </tr>
              ))}
              {topProducts.length === 0 && (
                <tr>
                  <td colSpan={4} style={{ color: 'var(--ink-muted)' }}>
                    {t('reports.noSalesInPeriod')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </>
      )}

      {!loading && canShrinkage && shrinkage && (
        <>
          <div className="section-title">{t('reports.shrinkageSection')}</div>
          <div className="unpaid-summary">
            <StatTile label={t('reports.totalQuantityLost')} value={shrinkage.quantity} tone="bad" />
            <StatTile label={t('reports.totalValueLost')} value={shrinkage.value.toLocaleString()} tone="bad" />
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>{t('reports.cause')}</th>
                <th>{t('common.quantity')}</th>
                <th>{t('reports.value')}</th>
              </tr>
            </thead>
            <tbody>
              {shrinkage.by_cause.map((r) => (
                <tr key={r.cause}>
                  <td>{t(`causes.${r.cause}`, { defaultValue: r.cause })}</td>
                  <td className="num">{r.quantity}</td>
                  <td className="num">{r.value.toLocaleString()}</td>
                </tr>
              ))}
              {shrinkage.by_cause.length === 0 && (
                <tr>
                  <td colSpan={3} style={{ color: 'var(--ink-muted)' }}>
                    {t('reports.noShrinkageInPeriod')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
