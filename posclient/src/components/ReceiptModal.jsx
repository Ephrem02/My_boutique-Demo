import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import client from '../api/client';
import { useAuth } from '../context/AuthContext';

// type: 'supplier-delivery' | 'institution-order'
export default function ReceiptModal({ type, id, onClose }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [record, setRecord] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const endpoint = type === 'supplier-delivery' ? `/supplier-deliveries/${id}` : `/institution-orders/${id}`;
    client.get(endpoint).then(({ data }) => {
      setRecord(data);
      setLoading(false);
    });
  }, [type, id]);

  if (loading || !record) {
    return (
      <div className="modal-overlay">
        <div className="modal-card">
          <p style={{ color: 'var(--ink-muted)' }}>{t('common.loading')}</p>
        </div>
      </div>
    );
  }

  const isSupplier = type === 'supplier-delivery';
  const counterpartyName = isSupplier ? record.supplier_name : record.institution_name;
  const dateLabel = isSupplier ? t('delivery.deliveryDate') : t('order.orderDate');
  const date = isSupplier ? record.delivery_date : record.order_date;
  const balance = Number(record.total_amount) - Number(record.amount_paid);

  return (
    <div className="modal-overlay">
      <div className="modal-card receipt-modal">
        <div className="receipt no-print-outside">
          <div className="receipt-header">
            <div className="receipt-brand">{t('nav.brand')}</div>
            <div className="receipt-title">
              {isSupplier ? t('receipts.deliveryReceipt') : t('receipts.orderReceipt')}
            </div>
          </div>

          <div className="receipt-meta">
            <div>
              <span className="receipt-meta-label">{t('receipts.receiptNo')}</span>
              <span>#{record.id}</span>
            </div>
            <div>
              <span className="receipt-meta-label">{dateLabel}</span>
              <span>{new Date(date).toLocaleDateString()}</span>
            </div>
          </div>

          <div className="receipt-party">
            <span className="receipt-meta-label">{isSupplier ? t('receipts.supplierLabel') : t('receipts.clientLabel')}</span>
            <div style={{ fontWeight: 600 }}>{counterpartyName}</div>
          </div>

          <table className="receipt-table">
            <thead>
              <tr>
                <th>{t('common.product')}</th>
                <th className="num">{t('delivery.qty')}</th>
                <th className="num">{t('order.unitPrice')}</th>
                <th className="num">{t('common.total')}</th>
              </tr>
            </thead>
            <tbody>
              {record.items.map((item) => {
                const unitPrice = Number(item.unit_cost ?? item.unit_price);
                return (
                  <tr key={item.id}>
                    <td>
                      {item.product_name}
                      <div style={{ fontSize: 11, color: 'var(--ink-muted)' }}>{item.sku}</div>
                    </td>
                    <td className="num">{item.quantity}</td>
                    <td className="num">{unitPrice.toLocaleString()}</td>
                    <td className="num">{(unitPrice * item.quantity).toLocaleString()}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <div className="receipt-totals">
            <div className="receipt-total-row">
              <span>{t('common.total')}</span>
              <span className="num">{Number(record.total_amount).toLocaleString()}</span>
            </div>
            <div className="receipt-total-row">
              <span>{t('receipts.amountPaid')}</span>
              <span className="num">{Number(record.amount_paid).toLocaleString()}</span>
            </div>
            <div className="receipt-total-row receipt-total-row-final">
              <span>{t('receipts.balanceDue')}</span>
              <span className="num">{balance.toLocaleString()}</span>
            </div>
          </div>

          {record.payments.length > 0 && (
            <>
              <div className="section-title">{t('receipts.paymentsReceived')}</div>
              <table className="receipt-table">
                <thead>
                  <tr>
                    <th>{t('common.date')}</th>
                    <th>{t('payment.method')}</th>
                    <th className="num">{t('payment.amount')}</th>
                  </tr>
                </thead>
                <tbody>
                  {record.payments.map((p) => (
                    <tr key={p.id}>
                      <td>{new Date(p.paid_date).toLocaleDateString()}</td>
                      <td>{t(`paymentMethods.${p.method}`, { defaultValue: p.method?.replace('_', ' ') || '—' })}</td>
                      <td className="num">{Number(p.amount).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          <div className="receipt-footer">
            {t('receipts.issuedBy', { name: user?.full_name, date: new Date().toLocaleString() })}
          </div>
        </div>

        <div className="modal-actions no-print">
          <button type="button" className="btn" onClick={onClose}>
            {t('common.close')}
          </button>
          <button type="button" className="btn btn-primary btn-block" onClick={() => window.print()}>
            {t('receipts.print')}
          </button>
        </div>
      </div>
    </div>
  );
}
