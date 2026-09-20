import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import client from '../api/client';

export default function RecordPaymentModal({ delivery, onClose, onRecorded }) {
  const { t } = useTranslation();
  const balance = Number(delivery.total_amount) - Number(delivery.amount_paid);
  const [amount, setAmount] = useState(balance > 0 ? balance : '');
  const [paidDate, setPaidDate] = useState(new Date().toISOString().slice(0, 10));
  const [method, setMethod] = useState('cash');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { data } = await client.post(`/supplier-deliveries/${delivery.id}/payments`, {
        amount: Number(amount),
        paid_date: paidDate,
        method,
      });
      onRecorded(data.delivery);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="modal-overlay">
      <form className="modal-card" onSubmit={handleSubmit}>
        <h2>{t('payment.title')}</h2>
        <p className="hint">{t('payment.balanceOwed', { amount: balance.toLocaleString() })}</p>

        {error && <div className="error-banner">{error}</div>}

        <div className="field">
          <label htmlFor="amount">{t('payment.amount')}</label>
          <input
            id="amount"
            type="number"
            min="1"
            step="1"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
            autoFocus
          />
        </div>
        <div className="field">
          <label htmlFor="paid_date">{t('payment.datePaid')}</label>
          <input id="paid_date" type="date" value={paidDate} onChange={(e) => setPaidDate(e.target.value)} required />
        </div>
        <div className="field">
          <label htmlFor="method">{t('payment.method')}</label>
          <select id="method" value={method} onChange={(e) => setMethod(e.target.value)}>
            <option value="cash">{t('paymentMethods.cash')}</option>
            <option value="mobile_money">{t('paymentMethods.mobile_money')}</option>
            <option value="bank_transfer">{t('paymentMethods.bank_transfer')}</option>
          </select>
        </div>

        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="btn btn-primary btn-block" disabled={loading}>
            {loading ? t('common.recording') : t('payment.recordPayment')}
          </button>
        </div>
      </form>
    </div>
  );
}
