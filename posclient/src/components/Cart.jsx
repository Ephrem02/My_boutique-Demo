import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Banknote, CreditCard, Minus, Plus, ShoppingCart, Smartphone, Trash2 } from 'lucide-react';
import client from '../api/client';
import Button, { IconButton } from '../ui/Button';
import Dialog from '../ui/Dialog';
import { EmptyState, ErrorState } from '../ui/display';
import { useToast } from '../ui/Toast';
import useBreakpoint from '../ui/useBreakpoint';
import { formatRwf } from '../ui/format';

// MTN and Airtel are separate so the daily closing can report each network
const PAYMENT_METHODS = [
  { id: 'cash', icon: Banknote },
  { id: 'mtn_mobile_money', icon: Smartphone },
  { id: 'airtel_money', icon: Smartphone },
  { id: 'card', icon: CreditCard },
];

function CartContents({ items, total, onUpdateQuantity, onRemove, paymentMethod, setPaymentMethod, error, loading, blocked, onCheckout }) {
  const { t } = useTranslation();
  return (
    <>
      <div className="cart-items">
        {items.length === 0 ? (
          <EmptyState compact icon={ShoppingCart} title={t('pos.cartEmptyTitle')} description={t('pos.cartEmpty')} />
        ) : (
          <ul className="cart-list" aria-label={t('pos.cart')}>
            {items.map((item) => (
              <li className="cart-item" key={item.product_id}>
                <div className="cart-item-info">
                  <div className="cart-item-name">{item.name}</div>
                  <div className="cart-item-price num">{formatRwf(item.unit_price)} {t('pos.each')}</div>
                </div>
                <div className="qty-control" role="group" aria-label={t('pos.quantityFor', { name: item.name })}>
                  <IconButton icon={Minus} label={t('pos.decrease', { name: item.name })} variant="secondary" size="sm"
                    onClick={() => (item.quantity <= 1 ? onRemove(item.product_id) : onUpdateQuantity(item.product_id, -1))} />
                  <span className="qty-value num" aria-live="polite">{item.quantity}</span>
                  <IconButton icon={Plus} label={t('pos.increase', { name: item.name })} variant="secondary" size="sm"
                    disabled={item.quantity >= item.stock} onClick={() => onUpdateQuantity(item.product_id, 1)} />
                </div>
                <div className="cart-item-subtotal num">{formatRwf(item.unit_price * item.quantity)}</div>
                <IconButton icon={Trash2} label={t('pos.remove', { name: item.name })} size="sm" onClick={() => onRemove(item.product_id)} className="cart-item-remove" />
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="cart-footer">
        {error && <ErrorState error={error} action={t('errors.actions.sale')} />}
        <fieldset className="payment-methods">
          <legend className="payment-legend">{t('pos.paymentMethod')}</legend>
          {PAYMENT_METHODS.map(({ id, icon: Icon }) => (
            <label key={id} className={`payment-option${paymentMethod === id ? ' selected' : ''}`}>
              <input type="radio" name="payment-method" value={id} checked={paymentMethod === id} onChange={() => setPaymentMethod(id)} />
              <Icon aria-hidden="true" />
              <span>{t(`paymentMethods.${id}`)}</span>
            </label>
          ))}
        </fieldset>
        <div className="cart-total-row">
          <span className="cart-total-label">{t('common.total')}</span>
          <span className="cart-total-value num">{formatRwf(total)}</span>
        </div>
        <Button variant="primary" size="lg" block disabled={items.length === 0 || blocked} loading={loading}
          loadingText={t('pos.completingSale')} onClick={onCheckout}>
          {t('pos.completeSale')}
        </Button>
      </div>
    </>
  );
}

/**
 * Cart + checkout. Tablet/desktop: a side panel. Phone: a sticky summary bar
 * that opens the full cart as a bottom sheet (items, 2x2 payment grid, total,
 * complete) - a sale is add → review → complete, no extra screens.
 */
export default function Cart({ items, onUpdateQuantity, onRemove, onSold, blocked = false }) {
  const { t } = useTranslation();
  const toast = useToast();
  const { isMobile } = useBreakpoint();
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const total = useMemo(() => items.reduce((sum, i) => sum + i.unit_price * i.quantity, 0), [items]);
  const count = items.reduce((sum, i) => sum + i.quantity, 0);

  async function handleCheckout() {
    if (loading) return;
    setError(null);
    setLoading(true);
    try {
      await client.post('/sales', {
        payment_method: paymentMethod,
        items: items.map((i) => ({ product_id: i.product_id, quantity: i.quantity })),
      });
      toast.success(t('pos.saleCompleted', { total: formatRwf(total), method: t(`paymentMethods.${paymentMethod}`) }));
      setSheetOpen(false);
      onSold();
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }

  const contents = (
    <CartContents items={items} total={total} onUpdateQuantity={onUpdateQuantity} onRemove={onRemove}
      paymentMethod={paymentMethod} setPaymentMethod={setPaymentMethod} error={error} loading={loading}
      blocked={blocked} onCheckout={handleCheckout} />
  );

  if (isMobile) {
    return (
      <>
        {items.length > 0 && (
          <div className="cart-bar">
            <div className="cart-bar-summary">
              <span className="cart-bar-count">{t('pos.itemsCount', { count })}</span>
              <span className="cart-bar-total num">{formatRwf(total)}</span>
            </div>
            <Button variant="primary" size="lg" onClick={() => setSheetOpen(true)} icon={ShoppingCart}>{t('pos.review')}</Button>
          </div>
        )}
        {sheetOpen && (
          <Dialog title={t('pos.cart')} onClose={() => setSheetOpen(false)} dismissible={!loading} className="cart-sheet">
            {contents}
          </Dialog>
        )}
      </>
    );
  }

  return (
    <aside className="cart-panel" aria-label={t('pos.cart')}>
      <div className="cart-header">
        <h2>{t('pos.cart')}</h2>
        {count > 0 && <span className="text-secondary">{t('pos.itemsCount', { count })}</span>}
      </div>
      {contents}
    </aside>
  );
}
