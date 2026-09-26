import { useCallback, useMemo, useState } from 'react';
import ProductGrid from '../components/ProductGrid';
import Cart from '../components/Cart';
import DayStatusBanner from '../components/businessDay/DayStatusBanner';
import { useBusinessDay } from '../context/BusinessDayContext';

export default function POSPage() {
  const { status } = useBusinessDay();
  const [refreshToken, setRefreshToken] = useState(0);
  const [items, setItems] = useState([]);

  const addItem = useCallback((product) => {
    const stock = Number(product.total_quantity);
    if (stock <= 0) return;
    setItems((prev) => {
      const existing = prev.find((i) => i.product_id === product.id);
      if (existing) {
        if (existing.quantity >= stock) return prev;
        return prev.map((i) => (i.product_id === product.id ? { ...i, quantity: i.quantity + 1 } : i));
      }
      return [...prev, { product_id: product.id, name: product.name, sku: product.sku, unit_price: Number(product.selling_price), quantity: 1, stock }];
    });
  }, []);

  const updateQuantity = useCallback((productId, delta) => {
    setItems((prev) => prev.map((i) => (i.product_id === productId ? { ...i, quantity: Math.min(i.stock, Math.max(1, i.quantity + delta)) } : i)));
  }, []);

  const removeItem = useCallback((productId) => {
    setItems((prev) => prev.filter((i) => i.product_id !== productId));
  }, []);

  const handleSold = useCallback(() => {
    setItems([]);
    setRefreshToken((t) => t + 1);
  }, []);

  const inCart = useMemo(() => Object.fromEntries(items.map((i) => [i.product_id, i.quantity])), [items]);

  return (
    <div className="pos">
      <DayStatusBanner />
      <div className="pos-body">
        <ProductGrid onAdd={addItem} refreshToken={refreshToken} inCart={inCart} />
        <Cart items={items} onUpdateQuantity={updateQuantity} onRemove={removeItem} onSold={handleSold}
          blocked={status !== null && status !== 'open'} />
      </div>
    </div>
  );
}
