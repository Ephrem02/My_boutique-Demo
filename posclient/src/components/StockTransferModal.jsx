import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import client from '../api/client';

export default function StockTransferModal({ onClose, onRecorded }) {
  const { t } = useTranslation();
  const [products, setProducts] = useState([]);
  const [locations, setLocations] = useState([]);
  const [productId, setProductId] = useState('');
  const [fromLocationId, setFromLocationId] = useState('');
  const [toLocationId, setToLocationId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    Promise.all([client.get('/products'), client.get('/stock/locations')]).then(([p, l]) => {
      setProducts(p.data);
      setLocations(l.data);
    });
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (!productId || !fromLocationId || !toLocationId || !quantity) {
      setError(t('common.fillRequiredFields'));
      return;
    }
    if (fromLocationId === toLocationId) {
      setError(t('stock.sameLocationError'));
      return;
    }
    setLoading(true);
    try {
      await client.post('/stock/transfer', {
        product_id: Number(productId),
        from_location_id: Number(fromLocationId),
        to_location_id: Number(toLocationId),
        quantity: Number(quantity),
        notes: notes || undefined,
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
        <h2>{t('stock.transferTitle')}</h2>
        <p className="hint">{t('stock.transferHint')}</p>
        {error && <div className="error-banner">{error}</div>}

        <div className="field">
          <label htmlFor="product">{t('common.product')}</label>
          <select id="product" value={productId} onChange={(e) => setProductId(e.target.value)} required>
            <option value="">{t('common.selectProduct')}</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <div className="field" style={{ flex: 1 }}>
            <label htmlFor="from">{t('stock.from')}</label>
            <select id="from" value={fromLocationId} onChange={(e) => setFromLocationId(e.target.value)} required>
              <option value="">{t('stock.select')}</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {t(`locations.${l.name}`, { defaultValue: l.name.replace('_', ' ') })}
                </option>
              ))}
            </select>
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label htmlFor="to">{t('stock.to')}</label>
            <select id="to" value={toLocationId} onChange={(e) => setToLocationId(e.target.value)} required>
              <option value="">{t('stock.select')}</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {t(`locations.${l.name}`, { defaultValue: l.name.replace('_', ' ') })}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="field">
          <label htmlFor="quantity">{t('common.quantity')}</label>
          <input id="quantity" type="number" min="1" value={quantity} onChange={(e) => setQuantity(e.target.value)} required />
        </div>
        <div className="field">
          <label htmlFor="notes">{t('common.notesOptional')}</label>
          <input id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>

        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="btn btn-primary btn-block" disabled={loading}>
            {loading ? t('stock.transferring') : t('stock.transfer')}
          </button>
        </div>
      </form>
    </div>
  );
}
