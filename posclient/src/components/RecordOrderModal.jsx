import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import client from '../api/client';

function emptyLine() {
  return { product_id: '', quantity: '', unit_price: '' };
}

export default function RecordOrderModal({ institutionId, onClose, onRecorded }) {
  const { t } = useTranslation();
  const [products, setProducts] = useState([]);
  const [orderDate, setOrderDate] = useState(new Date().toISOString().slice(0, 10));
  const [deliveryDate, setDeliveryDate] = useState('');
  const [lines, setLines] = useState([emptyLine()]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    client.get('/products').then(({ data }) => setProducts(data));
  }, []);

  function updateLine(index, field, value) {
    setLines((ls) => ls.map((l, i) => (i === index ? { ...l, [field]: value } : l)));
  }

  function addLine() {
    setLines((ls) => [...ls, emptyLine()]);
  }

  function removeLine(index) {
    setLines((ls) => ls.filter((_, i) => i !== index));
  }

  const total = lines.reduce((sum, l) => sum + (Number(l.quantity) || 0) * (Number(l.unit_price) || 0), 0);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    const items = lines
      .filter((l) => l.product_id && l.quantity && l.unit_price)
      .map((l) => ({ product_id: Number(l.product_id), quantity: Number(l.quantity), unit_price: Number(l.unit_price) }));

    if (!items.length) {
      setError(t('common.atLeastOneLineItem'));
      return;
    }

    setLoading(true);
    try {
      const { data } = await client.post('/institution-orders', {
        institution_id: institutionId,
        order_date: orderDate,
        delivery_date: deliveryDate || null,
        items,
      });
      onRecorded(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="modal-overlay">
      <form className="modal-card" style={{ width: 480 }} onSubmit={handleSubmit}>
        <h2>{t('order.title')}</h2>
        <p className="hint">{t('order.hint')}</p>

        {error && <div className="error-banner">{error}</div>}

        <div style={{ display: 'flex', gap: 10 }}>
          <div className="field" style={{ flex: 1 }}>
            <label htmlFor="order_date">{t('order.orderDate')}</label>
            <input
              id="order_date"
              type="date"
              value={orderDate}
              onChange={(e) => setOrderDate(e.target.value)}
              required
            />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label htmlFor="delivery_date">{t('order.deliveryDateOptional')}</label>
            <input id="delivery_date" type="date" value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} />
          </div>
        </div>

        <div className="section-title">{t('delivery.items')}</div>
        <div className="line-items">
          {lines.map((line, i) => (
            <div className="line-item-row" key={i}>
              <select value={line.product_id} onChange={(e) => updateLine(i, 'product_id', e.target.value)}>
                <option value="">{t('common.selectProduct')}</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <input
                type="number"
                min="1"
                placeholder={t('delivery.qty')}
                value={line.quantity}
                onChange={(e) => updateLine(i, 'quantity', e.target.value)}
              />
              <input
                type="number"
                min="0"
                placeholder={t('order.unitPrice')}
                value={line.unit_price}
                onChange={(e) => updateLine(i, 'unit_price', e.target.value)}
              />
              <button
                type="button"
                className="line-item-remove"
                onClick={() => removeLine(i)}
                disabled={lines.length === 1}
              >
                ×
              </button>
            </div>
          ))}
          <button type="button" className="add-line-btn" onClick={addLine}>
            {t('delivery.addAnotherItem')}
          </button>
        </div>

        <div className="form-total">
          <span>{t('common.total')}</span>
          <span className="num">{total.toLocaleString()}</span>
        </div>

        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="btn btn-primary btn-block" disabled={loading}>
            {loading ? t('common.recording') : t('order.createOrder')}
          </button>
        </div>
      </form>
    </div>
  );
}
