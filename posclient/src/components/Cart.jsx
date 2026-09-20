import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import client from '../api/client';

const PAYMENT_METHODS = ['cash', 'mobile_money', 'card', 'bank_transfer'];

export default function Cart({ items, onUpdateQuantity, onRemove, onSold }) {
  const { t } = useTranslation();
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const total = useMemo(() => items.reduce((sum, i) => sum + i.unit_price * i.quantity, 0), [items]);

  async function handleCheckout() {
    setError('');
    setLoading(true);
    try {
      await client.post('/sales', {
        payment_method: paymentMethod,
        items: items.map((i) => ({
          product_id: i.product_id,
          quantity: i.quantity,
          unit_price: i.unit_price,
        })),
      });
      onSold();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="cart-panel">
      <div className="cart-header">
        <h2>{t('pos.cart')}</h2>
      </div>

      <div className="cart-items">
        {items.length === 0 && <div className="cart-empty">{t('pos.cartEmpty')}</div>}
        {items.map((item) => (
          <div className="cart-item" key={item.product_id}>
            <div className="cart-item-info">
              <div className="cart-item-name">{item.name}</div>
              <div className="cart-item-price">
                {item.unit_price.toLocaleString()} {t('pos.each')}
              </div>
            </div>
            <div className="qty-control">
              <button
                className="qty-btn"
                onClick={() => onUpdateQuantity(item.product_id, -1)}
                disabled={item.quantity <= 1}
              >
                −
              </button>
              <span className="qty-value num">{item.quantity}</span>
              <button
                className="qty-btn"
                onClick={() => onUpdateQuantity(item.product_id, 1)}
                disabled={item.quantity >= item.stock}
                title={item.quantity >= item.stock ? t('pos.noStockTitle') : undefined}
              >
                +
              </button>
            </div>
            <div className="cart-item-subtotal num">{(item.unit_price * item.quantity).toLocaleString()}</div>
            <button className="cart-item-remove" onClick={() => onRemove(item.product_id)} title={t('common.close')}>
              ×
            </button>
          </div>
        ))}
      </div>

      <div className="cart-footer">
        {error && <div className="error-banner">{error}</div>}

        <div className="payment-methods">
          {PAYMENT_METHODS.map((m) => (
            <button
              key={m}
              className={`payment-method-btn${paymentMethod === m ? ' selected' : ''}`}
              onClick={() => setPaymentMethod(m)}
              type="button"
            >
              {t(`paymentMethods.${m}`)}
            </button>
          ))}
        </div>

        <div className="cart-total-row">
          <span className="cart-total-label">{t('common.total')}</span>
          <span className="cart-total-value num">{total.toLocaleString()}</span>
        </div>

        <button
          className="btn btn-primary btn-block"
          disabled={items.length === 0 || loading}
          onClick={handleCheckout}
        >
          {loading ? t('pos.completingSale') : t('pos.completeSale')}
        </button>
      </div>
    </div>
  );
}
