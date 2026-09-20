import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import client from '../api/client';
import { useAuth } from '../context/AuthContext';
import RecordDeliveryModal from './RecordDeliveryModal';
import RecordPaymentModal from './RecordPaymentModal';
import ReceiptModal from './ReceiptModal';

export default function SupplierDetail({ supplierId, onClose }) {
  const { t } = useTranslation();
  const { hasPermission } = useAuth();
  const [supplier, setSupplier] = useState(null);
  const [deliveries, setDeliveries] = useState([]);
  const [showRecordDelivery, setShowRecordDelivery] = useState(false);
  const [payingDelivery, setPayingDelivery] = useState(null);
  const [receiptDeliveryId, setReceiptDeliveryId] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: supplierData }, { data: deliveryData }] = await Promise.all([
      client.get(`/suppliers/${supplierId}`),
      client.get('/supplier-deliveries', { params: { supplier_id: supplierId } }),
    ]);
    setSupplier(supplierData);
    setDeliveries(deliveryData);
    setLoading(false);
  }, [supplierId]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="detail-panel-overlay" onClick={onClose}>
      <div className="detail-panel" onClick={(e) => e.stopPropagation()}>
        <div className="detail-panel-header">
          <div>
            <h2>{supplier?.name || t('common.loading')}</h2>
            {supplier?.payment_terms && <span style={{ color: 'var(--ink-muted)', fontSize: 13 }}>{supplier.payment_terms}</span>}
          </div>
          <button className="icon-btn" onClick={onClose}>
            ×
          </button>
        </div>

        {supplier?.contact_phone && (
          <div style={{ fontSize: 13, color: 'var(--ink-muted)', marginBottom: 4 }}>{supplier.contact_phone}</div>
        )}
        {supplier?.contact_email && (
          <div style={{ fontSize: 13, color: 'var(--ink-muted)' }}>{supplier.contact_email}</div>
        )}

        <div className="section-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>{t('suppliers.deliveries')}</span>
          {hasPermission('supplier_deliveries.manage') && (
            <button className="btn" style={{ padding: '5px 10px', fontSize: 13 }} onClick={() => setShowRecordDelivery(true)}>
              {t('suppliers.recordDelivery')}
            </button>
          )}
        </div>

        {loading && <p style={{ color: 'var(--ink-muted)' }}>{t('common.loading')}</p>}

        {!loading && deliveries.length === 0 && (
          <p style={{ color: 'var(--ink-muted)', fontSize: 14 }}>{t('suppliers.noDeliveries')}</p>
        )}

        {deliveries.map((d) => {
          const balance = Number(d.total_amount) - Number(d.amount_paid);
          return (
            <div className="delivery-card" key={d.id}>
              <div className="delivery-card-top">
                <span className="delivery-card-date">{new Date(d.delivery_date).toLocaleDateString()}</span>
                <span className={`badge ${d.status}`}>{t(`badges.${d.status}`)}</span>
              </div>
              <div className="delivery-card-amounts">
                <span className="num">
                  {t('common.totalPaidSummary', {
                    total: Number(d.total_amount).toLocaleString(),
                    paid: Number(d.amount_paid).toLocaleString(),
                  })}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                {balance > 0 && hasPermission('supplier_payments.manage') && (
                  <button className="btn" style={{ fontSize: 13, padding: '6px 10px' }} onClick={() => setPayingDelivery(d)}>
                    {t('suppliers.recordPaymentOwed', { amount: balance.toLocaleString() })}
                  </button>
                )}
                <button className="btn" style={{ fontSize: 13, padding: '6px 10px' }} onClick={() => setReceiptDeliveryId(d.id)}>
                  {t('receipts.viewReceipt')}
                </button>
              </div>
            </div>
          );
        })}

        {showRecordDelivery && (
          <RecordDeliveryModal
            supplierId={supplierId}
            onClose={() => setShowRecordDelivery(false)}
            onRecorded={() => {
              setShowRecordDelivery(false);
              load();
            }}
          />
        )}

        {payingDelivery && (
          <RecordPaymentModal
            delivery={payingDelivery}
            onClose={() => setPayingDelivery(null)}
            onRecorded={() => {
              setPayingDelivery(null);
              load();
            }}
          />
        )}

        {receiptDeliveryId && (
          <ReceiptModal type="supplier-delivery" id={receiptDeliveryId} onClose={() => setReceiptDeliveryId(null)} />
        )}
      </div>
    </div>
  );
}
