import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import client from '../api/client';

export default function StockIntakeModal({ onClose, onRecorded }) {
  const { t } = useTranslation();
  const [products, setProducts] = useState([]);
  const [locations, setLocations] = useState([]);
  const [productId, setProductId] = useState('');
  const [locationId, setLocationId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    Promise.all([client.get('/products'), client.get('/stock/locations')]).then(([p, l]) => {
      setProducts(p.data);
      setLocations(l.data);
      const storeRoom = l.data.find((loc) => loc.name === 'store_room');
      if (storeRoom) setLocationId(String(storeRoom.id));
    });
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (!productId || !locationId || !quantity) {
      setError(t('common.fillRequiredFields'));
      return;
    }
    setLoading(true);
    try {
      await client.post('/stock/intake', {
        product_id: Number(productId),
        location_id: Number(locationId),
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
        <h2>{t('stock.intakeTitle')}</h2>
        <p className="hint">{t('stock.intakeHint')}</p>
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
        <div className="field">
          <label htmlFor="location">{t('common.location')}</label>
          <select id="location" value={locationId} onChange={(e) => setLocationId(e.target.value)} required>
            <option value="">{t('common.selectLocation')}</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {t(`locations.${l.name}`, { defaultValue: l.name.replace('_', ' ') })}
              </option>
            ))}
          </select>
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
            {loading ? t('common.recording') : t('stock.recordIntake')}
          </button>
        </div>
      </form>
    </div>
  );
}
