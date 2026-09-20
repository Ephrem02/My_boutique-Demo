import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import client from '../api/client';

function emptyLine() {
  return { product_id: '', quantity: '', unit_cost: '' };
}

export default function RecordDeliveryModal({ supplierId, onClose, onRecorded }) {
  const { t } = useTranslation();
  const [products, setProducts] = useState([]);
  const [deliveryDate, setDeliveryDate] = useState(new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState('');
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

  const total = lines.reduce((sum, l) => sum + (Number(l.quantity) || 0) * (Number(l.unit_cost) || 0), 0);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    const items = lines
      .filter((l) => l.product_id && l.quantity && l.unit_cost)
      .map((l) => ({ product_id: Number(l.product_id), quantity: Number(l.quantity), unit_cost: Number(l.unit_cost) }));

    if (!items.length) {
      setError(t('common.atLeastOneLineItem'));
      return;
    }

    setLoading(true);
    try {
      const { data } = await client.post('/supplier-deliveries', {
        supplier_id: supplierId,
        delivery_date: deliveryDate,
        payment_due_date: dueDate || null,
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
        <h2>{t('delivery.title')}</h2>
        <p className="hint">{t('delivery.hint')}</p>

        {error && <div className="error-banner">{error}</div>}

        <div style={{ display: 'flex', gap: 10 }}>
          <div className="field" style={{ flex: 1 }}>
            <label htmlFor="delivery_date">{t('delivery.deliveryDate')}</label>
            <input
              id="delivery_date"
              type="date"
              value={deliveryDate}
              onChange={(e) => setDeliveryDate(e.target.value)}
              required
            />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label htmlFor="due_date">{t('delivery.paymentDueOptional')}</label>
            <input id="due_date" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
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
                placeholder={t('delivery.unitCost')}
                value={line.unit_cost}
                onChange={(e) => updateLine(i, 'unit_cost', e.target.value)}
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
            {loading ? t('common.recording') : t('delivery.recordDelivery')}
          </button>
        </div>
      </form>
    </div>
  );
}
