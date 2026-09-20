import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import client from '../api/client';
import { useAuth } from '../context/AuthContext';
import RecordOrderModal from './RecordOrderModal';
import RecordInstitutionPaymentModal from './RecordInstitutionPaymentModal';
import ReceiptModal from './ReceiptModal';

export default function InstitutionDetail({ institutionId, onClose }) {
  const { t } = useTranslation();
  const { hasPermission } = useAuth();
  const [institution, setInstitution] = useState(null);
  const [orders, setOrders] = useState([]);
  const [showRecordOrder, setShowRecordOrder] = useState(false);
  const [payingOrder, setPayingOrder] = useState(null);
  const [receiptOrderId, setReceiptOrderId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: institutionData }, { data: orderData }] = await Promise.all([
      client.get(`/institutions/${institutionId}`),
      client.get('/institution-orders', { params: { institution_id: institutionId } }),
    ]);
    setInstitution(institutionData);
    setOrders(orderData);
    setLoading(false);
  }, [institutionId]);

  useEffect(() => {
    load();
  }, [load]);

  async function markDelivered(orderId) {
    setError('');
    try {
      await client.post(`/institution-orders/${orderId}/deliver`);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="detail-panel-overlay" onClick={onClose}>
      <div className="detail-panel" onClick={(e) => e.stopPropagation()}>
        <div className="detail-panel-header">
          <div>
            <h2>{institution?.name || t('common.loading')}</h2>
            {institution && (
              <span className="badge paid" style={{ marginRight: 8 }}>
                {t(`institutions.types.${institution.type}`, { defaultValue: institution.type })}
              </span>
            )}
            {institution?.payment_terms && (
              <span style={{ color: 'var(--ink-muted)', fontSize: 13 }}>{institution.payment_terms}</span>
            )}
          </div>
          <button className="icon-btn" onClick={onClose}>
            ×
          </button>
        </div>

        {institution?.contact_person && (
          <div style={{ fontSize: 13, color: 'var(--ink-muted)', marginBottom: 4 }}>{institution.contact_person}</div>
        )}
        {institution?.contact_phone && (
          <div style={{ fontSize: 13, color: 'var(--ink-muted)' }}>{institution.contact_phone}</div>
        )}

        {error && <div className="error-banner" style={{ marginTop: 14 }}>{error}</div>}

        <div className="section-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>{t('institutions.orders')}</span>
          {hasPermission('institution_orders.manage') && (
            <button className="btn" style={{ padding: '5px 10px', fontSize: 13 }} onClick={() => setShowRecordOrder(true)}>
              {t('institutions.newOrder')}
            </button>
          )}
        </div>

        {loading && <p style={{ color: 'var(--ink-muted)' }}>{t('common.loading')}</p>}

        {!loading && orders.length === 0 && (
          <p style={{ color: 'var(--ink-muted)', fontSize: 14 }}>{t('institutions.noOrders')}</p>
        )}

        {orders.map((o) => {
          const balance = Number(o.total_amount) - Number(o.amount_paid);
          return (
            <div className="delivery-card" key={o.id}>
              <div className="delivery-card-top">
                <span className="delivery-card-date">{new Date(o.order_date).toLocaleDateString()}</span>
                <span className={`badge ${o.payment_status}`}>{t(`badges.${o.payment_status}`)}</span>
              </div>
              <div className="delivery-card-amounts">
                <span className="num">
                  {t('common.totalPaidSummary', {
                    total: Number(o.total_amount).toLocaleString(),
                    paid: Number(o.amount_paid).toLocaleString(),
                  })}
                </span>
                <span style={{ color: 'var(--ink-muted)' }}>
                  {o.delivery_status === 'delivered' ? t('badges.delivered') : t('badges.pendingDelivery')}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                {o.delivery_status === 'pending' && hasPermission('institution_orders.manage') && (
                  <button className="btn" style={{ fontSize: 13, padding: '6px 10px' }} onClick={() => markDelivered(o.id)}>
                    {t('institutions.markDelivered')}
                  </button>
                )}
                {balance > 0 && hasPermission('institution_payments.manage') && (
                  <button className="btn" style={{ fontSize: 13, padding: '6px 10px' }} onClick={() => setPayingOrder(o)}>
                    {t('suppliers.recordPaymentOwed', { amount: balance.toLocaleString() })}
                  </button>
                )}
                <button className="btn" style={{ fontSize: 13, padding: '6px 10px' }} onClick={() => setReceiptOrderId(o.id)}>
                  {t('receipts.viewReceipt')}
                </button>
              </div>
            </div>
          );
        })}

        {showRecordOrder && (
          <RecordOrderModal
            institutionId={institutionId}
            onClose={() => setShowRecordOrder(false)}
            onRecorded={() => {
              setShowRecordOrder(false);
              load();
            }}
          />
        )}

        {payingOrder && (
          <RecordInstitutionPaymentModal
            order={payingOrder}
            onClose={() => setPayingOrder(null)}
            onRecorded={() => {
              setPayingOrder(null);
              load();
            }}
          />
        )}

        {receiptOrderId && (
          <ReceiptModal type="institution-order" id={receiptOrderId} onClose={() => setReceiptOrderId(null)} />
        )}
      </div>
    </div>
  );
}
