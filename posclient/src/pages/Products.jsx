import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import client from '../api/client';
import { useAuth } from '../context/AuthContext';
import ProductFormModal from '../components/ProductFormModal';
import CategoriesModal from '../components/CategoriesModal';
import { getProductIcon } from '../utils/productIcon';

export default function Products() {
  const { t } = useTranslation();
  const { hasPermission } = useAuth();
  const canManage = hasPermission('products.manage');

  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [showInactive, setShowInactive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editingProduct, setEditingProduct] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showCategories, setShowCategories] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = {};
      if (search) params.search = search;
      if (categoryId) params.category_id = categoryId;
      if (lowStockOnly) params.low_stock = 'true';
      if (showInactive && canManage) params.include_inactive = 'true';

      const [{ data: productData }, { data: categoryData }] = await Promise.all([
        client.get('/products', { params }),
        client.get('/categories'),
      ]);
      setProducts(productData);
      setCategories(categoryData);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, categoryId, lowStockOnly, showInactive]);

  useEffect(() => {
    const timer = setTimeout(load, 250);
    return () => clearTimeout(timer);
  }, [load]);

  async function toggleActive(product) {
    setError('');
    try {
      if (product.is_active) {
        await client.delete(`/products/${product.id}`);
      } else {
        await client.put(`/products/${product.id}`, { is_active: true });
      }
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="page-body">
      <div className="page-header">
        <h1>{t('products.title')}</h1>
        {canManage && (
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn" onClick={() => setShowCategories(true)}>
              {t('products.manageCategories')}
            </button>
            <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
              {t('products.newProduct')}
            </button>
          </div>
        )}
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div style={{ display: 'flex', gap: 10, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          className="search-input"
          style={{ maxWidth: 280 }}
          type="text"
          placeholder={t('products.searchPlaceholder')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          style={{ padding: '10px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-strong)' }}
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
        >
          <option value="">{t('products.allCategories')}</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <label style={{ fontSize: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={lowStockOnly} onChange={(e) => setLowStockOnly(e.target.checked)} />
          {t('products.lowStockOnly')}
        </label>
        {canManage && (
          <label style={{ fontSize: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
            <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
            {t('products.showDeactivated')}
          </label>
        )}
      </div>

      {!loading && (
        <table className="data-table">
          <thead>
            <tr>
              <th></th>
              <th>{t('products.sku')}</th>
              <th>{t('common.name')}</th>
              <th>{t('products.category')}</th>
              {canManage && <th>{t('products.cost')}</th>}
              <th>{t('products.sellingPrice')}</th>
              <th>{t('products.reorderLevel')}</th>
              <th>{t('products.stock')}</th>
              {canManage && <th></th>}
            </tr>
          </thead>
          <tbody>
            {products.map((p) => {
              const outOfStock = Number(p.total_quantity) <= 0;
              const low = Number(p.total_quantity) <= p.reorder_level && !outOfStock;
              return (
                <tr key={p.id}>
                  <td>
                    <span className="product-tile-image" style={{ width: 32, aspectRatio: '1 / 1' }}>
                      {p.image_url ? (
                        <img src={p.image_url} alt="" />
                      ) : (
                        <span className="product-tile-icon" style={{ fontSize: 18 }} aria-hidden="true">
                          {getProductIcon(p.name)}
                        </span>
                      )}
                    </span>
                  </td>
                  <td>{p.sku}</td>
                  <td>
                    {p.name}
                    {!p.is_active && (
                      <span className="badge unpaid" style={{ marginLeft: 8 }}>
                        {t('badges.deactivated')}
                      </span>
                    )}
                  </td>
                  <td>{p.category_name || '—'}</td>
                  {canManage && <td className="num">{Number(p.cost_price).toLocaleString()}</td>}
                  <td className="num">{Number(p.selling_price).toLocaleString()}</td>
                  <td className="num">{p.reorder_level}</td>
                  <td className={`num ${low ? 'low-text' : ''}`} style={low ? { color: 'var(--warn)', fontWeight: 500 } : undefined}>
                    {p.total_quantity}
                  </td>
                  {canManage && (
                    <td style={{ display: 'flex', gap: 6 }}>
                      <button className="btn" style={{ padding: '5px 10px', fontSize: 13 }} onClick={() => setEditingProduct(p)}>
                        {t('common.edit')}
                      </button>
                      <button
                        className={`btn ${p.is_active ? 'btn-danger' : ''}`}
                        style={{ padding: '5px 10px', fontSize: 13 }}
                        onClick={() => toggleActive(p)}
                      >
                        {p.is_active ? t('products.deactivate') : t('products.reactivate')}
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
            {products.length === 0 && (
              <tr>
                <td colSpan={canManage ? 9 : 8} style={{ color: 'var(--ink-muted)' }}>
                  {t('products.noProducts')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}

      {showCreate && (
        <ProductFormModal
          onClose={() => setShowCreate(false)}
          onSaved={() => {
            setShowCreate(false);
            load();
          }}
        />
      )}

      {editingProduct && (
        <ProductFormModal
          product={editingProduct}
          onClose={() => setEditingProduct(null)}
          onSaved={() => {
            setEditingProduct(null);
            load();
          }}
        />
      )}

      {showCategories && <CategoriesModal onClose={() => setShowCategories(false)} onChanged={load} />}
    </div>
  );
}
