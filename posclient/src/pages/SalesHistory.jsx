import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import client from '../api/client';
import { useAuth } from '../context/AuthContext';
import SaleDetail from '../components/SaleDetail';

export default function SalesHistory() {
  const { t } = useTranslation();
  const { hasPermission } = useAuth();
  const [sales, setSales] = useState([]);
  const [returns, setReturns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const requests = [client.get('/sales')];
      if (hasPermission('returns.process')) requests.push(client.get('/returns'));
      const [{ data: salesData }, returnsRes] = await Promise.all(requests);
      setSales(salesData);
      if (returnsRes) setReturns(returnsRes.data.slice(0, 10));
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
        <h1>{t('salesHistory.title')}</h1>
      </div>

      {error && <div className="error-banner">{error}</div>}

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
