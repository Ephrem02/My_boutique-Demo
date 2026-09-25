import { useCallback, useState } from 'react';
import ProductGrid from '../components/ProductGrid';
import Cart from '../components/Cart';
import DayStatusBanner from '../components/businessDay/DayStatusBanner';

export default function POSPage() {
  const [refreshToken, setRefreshToken] = useState(0);
  const [items, setItems] = useState([]);
  // Selling needs an OPEN business day; null = still checking
  const [dayStatus, setDayStatus] = useState(null);

  const addItem = useCallback((product) => {
    const stock = Number(product.total_quantity);
    if (stock <= 0) return;

    setItems((prev) => {
      const existing = prev.find((i) => i.product_id === product.id);
      if (existing) {
        if (existing.quantity >= stock) return prev;
        return prev.map((i) => (i.product_id === product.id ? { ...i, quantity: i.quantity + 1 } : i));
      }
      return [
        ...prev,
        {
          product_id: product.id,
          name: product.name,
          sku: product.sku,
          unit_price: Number(product.selling_price),
          quantity: 1,
          stock,
        },
      ];
    });
  }, []);

  const updateQuantity = useCallback((productId, delta) => {
    setItems((prev) =>
      prev.map((i) =>
        i.product_id === productId ? { ...i, quantity: Math.min(i.stock, Math.max(1, i.quantity + delta)) } : i
      )
    );
  }, []);

  const removeItem = useCallback((productId) => {
    setItems((prev) => prev.filter((i) => i.product_id !== productId));
  }, []);

  const handleSold = useCallback(() => {
    setItems([]);
    setRefreshToken((t) => t + 1);
  }, []);

  return (
    <>
      <DayStatusBanner onStatus={setDayStatus} />
      <div className="pos-body">
        <ProductGrid onAdd={addItem} refreshToken={refreshToken} />
        <Cart items={items} onUpdateQuantity={updateQuantity} onRemove={removeItem} onSold={handleSold} blocked={dayStatus !== null && dayStatus !== 'open'} />
      </div>
    </>
  );
}
