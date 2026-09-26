import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Printer } from 'lucide-react';
import client from '../api/client';
import { useAuth } from '../context/AuthContext';
import Dialog from '../ui/Dialog';
import Button from '../ui/Button';
import { ErrorState, SkeletonPanel } from '../ui/display';
import { formatRwf, formatDate, formatDateTime, formatNumber } from '../ui/format';

// type: 'supplier-delivery' | 'institution-order'. Printing shows only the
// .receipt block (see print rules in pages.css), always in light colours.
export default function ReceiptModal({ type, id, onClose }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [record, setRecord] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    const endpoint = type === 'supplier-delivery' ? `/supplier-deliveries/${id}` : `/institution-orders/${id}`;
    client.get(endpoint).then(({ data }) => setRecord(data)).catch(setError);
  }, [type, id]);

  const isSupplier = type === 'supplier-delivery';
  const footer = (
    <>
      <Button onClick={onClose}>{t('common.close')}</Button>
      <Button variant="primary" icon={Printer} onClick={() => window.print()} disabled={!record}>{t('receipts.print')}</Button>
    </>
  );

  const payments = (record?.transactions || []).filter((p) => p.type === 'payment' && !p.reversed_by && p.invoice_id === record.id);

  return (
    <Dialog title={isSupplier ? t('receipts.deliveryReceipt') : t('receipts.orderReceipt')} hideTitle onClose={onClose} footer={footer}>
      {error && <ErrorState error={error} />}
      {!record && !error && <SkeletonPanel lines={8} />}
      {record && (
        <div className="receipt">
          <div className="receipt-header">
            <div className="receipt-brand">{t('nav.brand')}</div>
            <div className="receipt-title">{isSupplier ? t('receipts.deliveryReceipt') : t('receipts.orderReceipt')}</div>
          </div>
          <div className="receipt-meta">
            <div><span className="receipt-label">{t('receipts.receiptNo')}</span><span className="num">#{record.id}</span></div>
            <div><span className="receipt-label">{isSupplier ? t('delivery.deliveryDate') : t('order.orderDate')}</span><span>{formatDate(isSupplier ? record.delivery_date : record.order_date)}</span></div>
          </div>
          <div className="receipt-party">
            <span className="receipt-label">{isSupplier ? t('receipts.supplierLabel') : t('receipts.clientLabel')}</span>
            <strong>{isSupplier ? record.supplier_name : record.institution_name}</strong>
          </div>

          <table className="receipt-table">
            <thead>
              <tr>
                <th scope="col">{t('common.product')}</th>
                <th scope="col" className="align-right">{t('delivery.qty')}</th>
                <th scope="col" className="align-right">{t('order.unitPrice')}</th>
                <th scope="col" className="align-right">{t('common.total')}</th>
              </tr>
            </thead>
            <tbody>
              {record.items.map((item) => {
                const unitPrice = Number(item.unit_cost ?? item.unit_price);
                return (
                  <tr key={item.id}>
                    <td>{item.product_name}<div className="receipt-sku">{item.sku}</div></td>
                    <td className="align-right num">{formatNumber(item.quantity)}</td>
                    <td className="align-right num">{formatRwf(unitPrice)}</td>
                    <td className="align-right num">{formatRwf(unitPrice * item.quantity)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <dl className="receipt-totals">
            {Number(record.discount_amount) > 0 && <div><dt>{t('finance.discount')}</dt><dd className="num">{formatRwf(-record.discount_amount)}</dd></div>}
            <div><dt>{t('common.total')}</dt><dd className="num">{formatRwf(record.total_amount)}</dd></div>
            {record.returns_total > 0 && <div><dt>{t('finance.returns')}</dt><dd className="num">{formatRwf(-record.returns_total)}</dd></div>}
            <div><dt>{t('receipts.amountPaid')}</dt><dd className="num">{formatRwf(record.amount_paid)}</dd></div>
            <div className="receipt-total-final">
              <dt>{record.balance < 0 ? t('finance.creditBalance') : t('receipts.balanceDue')}</dt>
              <dd className="num">{formatRwf(Math.abs(record.balance))}</dd>
            </div>
          </dl>

          {payments.length > 0 && (
            <>
              <div className="receipt-section">{t('receipts.paymentsReceived')}</div>
              <table className="receipt-table">
                <thead>
                  <tr>
                    <th scope="col">{t('common.date')}</th>
                    <th scope="col">{t('payment.method')}</th>
                    <th scope="col" className="align-right">{t('payment.amount')}</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((p) => (
                    <tr key={p.id}>
                      <td>{formatDate(p.txn_date)}</td>
                      <td>{t(`paymentMethods.${p.method}`, { defaultValue: p.method?.replace('_', ' ') || '—' })}</td>
                      <td className="align-right num">{formatRwf(p.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
          <div className="receipt-footer">{t('receipts.issuedBy', { name: user?.full_name, date: formatDateTime(new Date()) })}</div>
        </div>
      )}
    </Dialog>
  );
}
