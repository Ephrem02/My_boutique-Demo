import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import client from '../api/client';

export default function ReturnModal({ saleItem, onClose, onRecorded }) {
  const { t } = useTranslation();
  const [quantity, setQuantity] = useState(saleItem.quantity - (saleItem.returned_quantity || 0));
  const [reason, setReason] = useState('');
  const [restocked, setRestocked] = useState(true);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await client.post('/returns', {
        sale_item_id: saleItem.id,
        quantity: Number(quantity),
        reason: reason || undefined,
        restocked,
      });
      onRecorded();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="modal-overlay">
      <form className="modal-card" onSubmit={handleSubmit}>
        <h2>{t('returnModal.title')}</h2>
        <p className="hint">
          {t('returnModal.summary', {
            product: saleItem.product_name,
            quantity: saleItem.quantity,
            price: Number(saleItem.unit_price).toLocaleString(),
          })}
        </p>
        {error && <div className="error-banner">{error}</div>}

        <div className="field">
          <label htmlFor="quantity">{t('returnModal.quantityReturned')}</label>
          <input
            id="quantity"
            type="number"
            min="1"
            max={saleItem.quantity}
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            required
            autoFocus
          />
        </div>
        <div className="field">
          <label htmlFor="reason">{t('salesHistory.reason')}</label>
          <input id="reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('returnModal.reasonPlaceholder')} />
        </div>
        <div className="field">
          <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input type="checkbox" checked={restocked} onChange={(e) => setRestocked(e.target.checked)} />
            {t('returnModal.restockLabel')}
          </label>
        </div>

        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="btn btn-primary btn-block" disabled={loading}>
            {loading ? t('common.recording') : t('returnModal.title')}
          </button>
        </div>
      </form>
    </div>
  );
}
