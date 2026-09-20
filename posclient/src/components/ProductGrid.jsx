import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import client from '../api/client';
import { getProductIcon } from '../utils/productIcon';

export default function ProductGrid({ onAdd, refreshToken }) {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchProducts = useCallback(async (q) => {
    setLoading(true);
    setError('');
    try {
      const { data } = await client.get('/products', { params: q ? { search: q } : {} });
      setProducts(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => fetchProducts(search), 250);
    return () => clearTimeout(timer);
  }, [search, fetchProducts]);

  // Re-fetch after a sale so shelf quantities reflect what was just sold
  useEffect(() => {
    fetchProducts(search);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshToken]);

  return (
    <div className="product-pane">
      <div className="search-row">
        <input
          className="search-input"
          type="text"
          placeholder={t('pos.searchPlaceholder')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          autoFocus
        />
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="product-grid">
        {!loading &&
          products.map((p) => {
            const outOfStock = Number(p.total_quantity) <= 0;
            const low = Number(p.total_quantity) <= p.reorder_level && !outOfStock;
            return (
              <button
                key={p.id}
                className="product-tile"
                disabled={outOfStock}
                onClick={() => onAdd(p)}
                title={outOfStock ? t('pos.outOfStock') : p.name}
              >
                <span className="product-tile-image">
                  {p.image_url ? (
                    <img src={p.image_url} alt={p.name} />
                  ) : (
                    <span className="product-tile-icon" aria-hidden="true">{getProductIcon(p.name)}</span>
                  )}
                </span>
                <span className="product-tile-name">{p.name}</span>
                <span className="product-tile-sku">{p.sku}</span>
                <span className={`product-tile-stock num ${low ? 'low' : ''}`}>
                  {outOfStock ? t('pos.outOfStock') : t('pos.inStock', { count: p.total_quantity })}
                </span>
                <span className="product-tile-price num">
                  {Number(p.selling_price).toLocaleString()}
                </span>
              </button>
            );
          })}
        {!loading && products.length === 0 && <p style={{ color: 'var(--ink-muted)' }}>{t('pos.noProductsFound')}</p>}
      </div>
    </div>
  );
}
