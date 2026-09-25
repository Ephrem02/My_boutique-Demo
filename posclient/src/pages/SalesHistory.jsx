import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import client from '../api/client';
import { useAuth } from '../context/AuthContext';
import SaleDetail from '../components/SaleDetail';
import StatTile from '../components/StatTile';

export default function SalesHistory() {
  const { t } = useTranslation();
  const { hasPermission } = useAuth();
  const [sales, setSales] = useState([]);
  const [returns, setReturns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  // Without sales.view_all the API only returns this user's own sales, so the
  // page becomes "My sales" with a personal summary instead of shop totals.
  const ownOnly = !hasPermission('sales.view_all');
  const [summary, setSummary] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const now = new Date();
      const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      const [{ data: salesData }, returnsRes, summaryRes] = await Promise.all([
        client.get('/sales'),
        hasPermission('returns.process') ? client.get('/returns') : Promise.resolve(null),
        ownOnly ? client.get('/reports/my-summary', { params: { from: today, to: today } }) : Promise.resolve(null),
      ]);
      setSales(salesData);
      if (returnsRes) setReturns(returnsRes.data.slice(0, 10));
      if (summaryRes) setSummary(summaryRes.data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="page-body">
      <div className="page-header">
        <h1>{ownOnly ? t('salesHistory.myTitle') : t('salesHistory.title')}</h1>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {summary && (
        <div className="unpaid-summary">
          <StatTile label={t('salesHistory.mySalesToday')} value={summary.my_sale_count} />
          <StatTile label={t('salesHistory.myRevenueToday')} value={`${summary.my_revenue.toLocaleString()} RWF`} />
          <StatTile label={t('salesHistory.myVoidedToday')} value={summary.my_voided_count} tone={summary.my_voided_count ? 'bad' : undefined} />
          <StatTile label={t('salesHistory.shopLowStock')} value={summary.shop_low_stock_count} tone={summary.shop_low_stock_count ? 'warn' : undefined} />
          <StatTile label={t('salesHistory.shopOutOfStock')} value={summary.shop_out_of_stock_count} tone={summary.shop_out_of_stock_count ? 'bad' : undefined} />
        </div>
      )}

      {!loading && (
        <table className="data-table" style={{ marginBottom: returns.length ? 28 : 0 }}>
          <thead>
            <tr>
              <th>{t('common.date')}</th>
              <th>{t('salesHistory.cashier')}</th>
              <th>{t('salesHistory.payment')}</th>
              <th>{t('common.total')}</th>
              <th>{t('common.status')}</th>
            </tr>
          </thead>
          <tbody>
            {sales.map((s) => (
              <tr key={s.id} className="clickable" onClick={() => setSelectedId(s.id)}>
                <td>{new Date(s.created_at).toLocaleString()}</td>
                <td>{s.cashier_name}</td>
                <td>{t(`paymentMethods.${s.payment_method}`, { defaultValue: s.payment_method.replace('_', ' ') })}</td>
                <td className="num">{Number(s.total_amount).toLocaleString()}</td>
                <td>
                  <span className={`badge ${s.status === 'voided' ? 'unpaid' : 'paid'}`}>{t(`badges.${s.status}`)}</span>
                </td>
              </tr>
            ))}
            {sales.length === 0 && (
              <tr>
                <td colSpan={5} style={{ color: 'var(--ink-muted)' }}>
                  {t('salesHistory.noSales')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}

      {returns.length > 0 && (
        <>
          <div className="section-title" style={{ marginTop: 0 }}>{t('salesHistory.recentReturns')}</div>
          <table className="data-table">
            <thead>
              <tr>
                <th>{t('common.date')}</th>
                <th>{t('common.product')}</th>
                <th>{t('salesHistory.qty')}</th>
                <th>{t('salesHistory.reason')}</th>
                <th>{t('salesHistory.restocked')}</th>
                <th>{t('salesHistory.processedBy')}</th>
              </tr>
            </thead>
            <tbody>
              {returns.map((r) => (
                <tr key={r.id}>
                  <td>{new Date(r.created_at).toLocaleString()}</td>
                  <td>{r.product_name}</td>
                  <td className="num">{r.quantity}</td>
                  <td style={{ color: 'var(--ink-muted)' }}>{r.reason || '—'}</td>
                  <td>{r.restocked ? t('common.yes') : t('salesHistory.writeOff')}</td>
                  <td>{r.processed_by_name}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {selectedId && (
        <SaleDetail saleId={selectedId} onClose={() => setSelectedId(null)} onChanged={load} />
      )}
    </div>
  );
}
