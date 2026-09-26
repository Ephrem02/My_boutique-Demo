import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Search, PackageSearch } from 'lucide-react';
import client from '../api/client';
import { getProductIcon } from '../utils/productIcon';
import { EmptyState, ErrorState, Skeleton } from '../ui/display';
import { formatRwf, formatNumber } from '../ui/format';

/**
 * Product picker for the till. Tablet/desktop: a grid of tiles. Phone: a
 * compact list with a large + button per row (the whole row adds too).
 */
export default function ProductGrid({ onAdd, refreshToken, inCart = {} }) {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const [products, setProducts] = useState(null);
  const [error, setError] = useState(null);

  const fetchProducts = useCallback(async (q) => {
    try {
      const { data } = await client.get('/products', { params: q ? { search: q } : {} });
      setProducts(data);
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => fetchProducts(search), 250);
    return () => clearTimeout(timer);
  }, [search, fetchProducts]);

  // Re-fetch after a sale so shelf quantities reflect what was just sold
  useEffect(() => {
    if (refreshToken) fetchProducts(search);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshToken]);

  return (
    <div className="product-pane">
      <label className="pos-search">
        <Search aria-hidden="true" />
        <span className="sr-only">{t('pos.searchPlaceholder')}</span>
        <input className="input" type="search" placeholder={t('pos.searchPlaceholder')} value={search}
          onChange={(e) => setSearch(e.target.value)} autoComplete="off" />
      </label>

      {error && <ErrorState error={error} onRetry={() => fetchProducts(search)} />}

      {!products && !error && (
        <div className="product-grid" aria-busy="true">
          {Array.from({ length: 8 }, (_, i) => <Skeleton key={i} height={148} radius="var(--radius-md)" />)}
        </div>
      )}

      {products && products.length === 0 && (
        <EmptyState icon={PackageSearch} title={t('pos.noProductsFound')} description={search ? t('pos.noProductsHint', { query: search }) : undefined} />
      )}

      {products && products.length > 0 && (
        <ul className="product-grid" aria-label={t('pos.products')}>
          {products.map((p) => {
            const stock = Number(p.total_quantity);
            const outOfStock = stock <= 0;
            const low = stock <= p.reorder_level && !outOfStock;
            const qty = inCart[p.id] || 0;
            const stockText = outOfStock ? t('pos.outOfStock') : t('pos.inStock', { count: formatNumber(stock) });
            return (
              <li key={p.id}>
                <button
                  type="button"
                  className={`product-tile${qty ? ' in-cart' : ''}`}
                  disabled={outOfStock || qty >= stock}
                  onClick={() => onAdd(p)}
                  aria-label={t('pos.addToCart', { name: p.name, price: formatRwf(p.selling_price), stock: stockText })}
                >
                  <span className="product-tile-image" aria-hidden="true">
                    {p.image_url ? <img src={p.image_url} alt="" /> : <span className="product-tile-emoji">{getProductIcon(p.name)}</span>}
                  </span>
                  <span className="product-tile-body">
                    <span className="product-tile-name">{p.name}</span>
                    <span className={`product-tile-stock${low ? ' low' : ''}${outOfStock ? ' out' : ''}`}>{stockText}</span>
                  </span>
                  <span className="product-tile-price num">{formatRwf(p.selling_price)}</span>
                  <span className="product-tile-add" aria-hidden="true">
                    {qty ? <span className="num">{qty}</span> : <Plus />}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
