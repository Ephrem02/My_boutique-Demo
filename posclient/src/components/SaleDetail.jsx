import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import client from '../api/client';
import { useAuth } from '../context/AuthContext';
import ReturnModal from './ReturnModal';

export default function SaleDetail({ saleId, onClose, onChanged }) {
  const { t } = useTranslation();
  const { hasPermission } = useAuth();
  const [sale, setSale] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [returningItem, setReturningItem] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await client.get(`/sales/${saleId}`);
    setSale(data);
    setLoading(false);
  }, [saleId]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleVoid() {
    setError('');
    try {
      await client.post(`/sales/${saleId}/void`);
      await load();
      onChanged();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="detail-panel-overlay" onClick={onClose}>
      <div className="detail-panel" onClick={(e) => e.stopPropagation()}>
        <div className="detail-panel-header">
          <div>
            <h2>{t('saleDetail.title', { id: saleId })}</h2>
            {sale && <span style={{ color: 'var(--ink-muted)', fontSize: 13 }}>{new Date(sale.created_at).toLocaleString()}</span>}
          </div>
          <button className="icon-btn" onClick={onClose}>
            ×
          </button>
        </div>

        {error && <div className="error-banner">{error}</div>}
        {loading && <p style={{ color: 'var(--ink-muted)' }}>{t('common.loading')}</p>}

        {sale && (
          <>
            <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
              <span className={`badge ${sale.status === 'voided' ? 'unpaid' : 'paid'}`}>{t(`badges.${sale.status}`)}</span>
              <span style={{ fontSize: 13, color: 'var(--ink-muted)' }}>
                {sale.cashier_name} · {t(`paymentMethods.${sale.payment_method}`, { defaultValue: sale.payment_method.replace('_', ' ') })}
              </span>
            </div>

            <div className="section-title" style={{ marginTop: 8 }}>{t('saleDetail.items')}</div>
            {sale.items.map((item) => (
              <div className="delivery-card" key={item.id}>
                <div className="delivery-card-top">
                  <span>{item.product_name}</span>
                  <span className="num">{item.quantity} × {Number(item.unit_price).toLocaleString()}</span>
                </div>
                <div className="delivery-card-amounts">
                  <span style={{ color: 'var(--ink-muted)' }}>{item.sku}</span>
                  <span className="num">{(item.quantity * Number(item.unit_price)).toLocaleString()}</span>
                </div>
                {sale.status === 'completed' && hasPermission('returns.process') && (
                  <button
                    className="btn"
                    style={{ fontSize: 13, padding: '6px 10px' }}
                    onClick={() => setReturningItem(item)}
                  >
                    {t('saleDetail.processReturn')}
                  </button>
                )}
              </div>
            ))}

            <div className="cart-total-row" style={{ marginTop: 14 }}>
              <span className="cart-total-label">{t('common.total')}</span>
              <span className="cart-total-value num">{Number(sale.total_amount).toLocaleString()}</span>
            </div>

            {sale.status === 'completed' && hasPermission('sales.void') && (
              <button className="btn btn-danger btn-block" onClick={handleVoid}>
                {t('saleDetail.voidSale')}
              </button>
            )}
          </>
        )}

        {returningItem && (
          <ReturnModal
            saleItem={returningItem}
            onClose={() => setReturningItem(null)}
            onRecorded={() => {
              setReturningItem(null);
              load();
              onChanged();
            }}
          />
        )}
      </div>
    </div>
  );
}
