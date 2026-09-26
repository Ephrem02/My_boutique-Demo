import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Package, Plus, Search, Tags } from 'lucide-react';
import client from '../api/client';
import { useAuth } from '../context/AuthContext';
import ProductFormModal from '../components/ProductFormModal';
import CategoriesModal from '../components/CategoriesModal';
import { getProductIcon } from '../utils/productIcon';
import { PageHeader, StatusBadge } from '../ui/display';
import DataTable from '../ui/DataTable';
import Button from '../ui/Button';
import { Checkbox, Select } from '../ui/Field';
import { useToast } from '../ui/Toast';
import { formatRwf, formatNumber } from '../ui/format';

function stockBadge(p, t) {
  const qty = Number(p.total_quantity);
  if (qty <= 0) return <StatusBadge tone="danger">{t('products.stockOut')}</StatusBadge>;
  if (qty <= p.reorder_level) return <StatusBadge tone="warning">{t('products.stockLow', { count: formatNumber(qty) })}</StatusBadge>;
  return <span className="num">{formatNumber(qty)}</span>;
}

export default function Products() {
  const { t } = useTranslation();
  const toast = useToast();
  const { hasPermission } = useAuth();
  const canManage = hasPermission('products.manage');
  const [params] = useSearchParams();

  const [products, setProducts] = useState(null);
  const [categories, setCategories] = useState([]);
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [lowStockOnly, setLowStockOnly] = useState(params.get('filter') === 'low');
  const [showInactive, setShowInactive] = useState(false);
  const [error, setError] = useState(null);
  const [editingProduct, setEditingProduct] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showCategories, setShowCategories] = useState(false);

  const load = useCallback(async () => {
    try {
      const query = {};
      if (search) query.search = search;
      if (categoryId) query.category_id = categoryId;
      if (lowStockOnly) query.low_stock = 'true';
      if (showInactive && canManage) query.include_inactive = 'true';
      const [{ data: productData }, { data: categoryData }] = await Promise.all([
        client.get('/products', { params: query }),
        client.get('/categories'),
      ]);
      setProducts(productData);
      setCategories(categoryData);
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, [search, categoryId, lowStockOnly, showInactive, canManage]);

  useEffect(() => {
    const timer = setTimeout(load, 250);
    return () => clearTimeout(timer);
  }, [load]);

  async function toggleActive(product) {
    try {
      if (product.is_active) await client.delete(`/products/${product.id}`);
      else await client.put(`/products/${product.id}`, { is_active: true });
      toast.success(product.is_active ? t('products.deactivated', { name: product.name }) : t('products.reactivated', { name: product.name }));
      load();
    } catch (err) {
      setError(err);
    }
  }

  const columns = [
    {
      key: 'name', header: t('common.name'), sortable: true, mobile: 'title',
      render: (p) => (
        <span className="product-cell">
          <span className="product-thumb" aria-hidden="true">
            {p.image_url ? <img src={p.image_url} alt="" /> : getProductIcon(p.name)}
          </span>
          <span>
            <span className="product-cell-name">{p.name}</span>
            {!p.is_active && <StatusBadge tone="neutral">{t('badges.deactivated')}</StatusBadge>}
          </span>
        </span>
      ),
    },
    { key: 'sku', header: t('products.sku'), sortable: true, mobile: 'subtitle', render: (p) => <span className="text-secondary">{p.sku}</span> },
    { key: 'category_name', header: t('products.category'), sortable: true, render: (p) => p.category_name || '—' },
    canManage && { key: 'cost_price', header: t('products.cost'), align: 'right', sortable: true, sortValue: (p) => Number(p.cost_price), render: (p) => formatRwf(p.cost_price) },
    { key: 'selling_price', header: t('products.sellingPrice'), align: 'right', sortable: true, mobile: 'value', sortValue: (p) => Number(p.selling_price), render: (p) => formatRwf(p.selling_price) },
    { key: 'reorder_level', header: t('products.reorderLevel'), align: 'right', sortable: true, sortValue: (p) => Number(p.reorder_level), render: (p) => formatNumber(p.reorder_level) },
    { key: 'total_quantity', header: t('products.stock'), align: 'right', sortable: true, mobile: 'meta', sortValue: (p) => Number(p.total_quantity), render: (p) => stockBadge(p, t) },
    canManage && {
      key: 'actions', header: <span className="sr-only">{t('common.actions')}</span>, mobile: 'meta',
      render: (p) => (
        <span className="row-actions" onClick={(e) => e.stopPropagation()} role="presentation">
          <Button size="sm" onClick={() => setEditingProduct(p)} aria-label={t('products.editNamed', { name: p.name })}>{t('common.edit')}</Button>
          <Button size="sm" variant={p.is_active ? 'danger' : 'secondary'} onClick={() => toggleActive(p)}>
            {p.is_active ? t('products.deactivate') : t('products.reactivate')}
          </Button>
        </span>
      ),
    },
  ].filter(Boolean);

  return (
    <div className="page">
      <PageHeader
        title={t('products.title')}
        subtitle={products ? t('products.count', { count: products.length }) : undefined}
        actions={canManage && (
          <>
            <Button icon={Tags} onClick={() => setShowCategories(true)}>{t('products.manageCategories')}</Button>
            <Button variant="primary" icon={Plus} onClick={() => setShowCreate(true)}>{t('products.newProduct')}</Button>
          </>
        )}
      />

      <DataTable
        caption={t('products.title')}
        columns={columns}
        rows={products}
        loading={!products}
        error={error}
        onRetry={load}
        initialSort={{ key: 'name', dir: 'asc' }}
        empty={{
          icon: Package,
          title: lowStockOnly ? t('products.noLowStock') : t('products.noProducts'),
          description: canManage && !lowStockOnly ? t('products.noProductsHint') : undefined,
          action: canManage && !lowStockOnly ? <Button variant="primary" icon={Plus} onClick={() => setShowCreate(true)}>{t('products.newProduct')}</Button> : null,
        }}
        toolbar={(
          <div className="filters">
            <label className="table-search">
              <Search aria-hidden="true" />
              <span className="sr-only">{t('products.searchPlaceholder')}</span>
              <input type="search" className="input" placeholder={t('products.searchPlaceholder')} value={search} onChange={(e) => setSearch(e.target.value)} />
            </label>
            <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} aria-label={t('products.category')} className="filter-select">
              <option value="">{t('products.allCategories')}</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
            <Checkbox label={t('products.lowStockOnly')} checked={lowStockOnly} onChange={(e) => setLowStockOnly(e.target.checked)} className="filter-check" />
            {canManage && <Checkbox label={t('products.showDeactivated')} checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} className="filter-check" />}
          </div>
        )}
      />

      {showCreate && (
        <ProductFormModal onClose={() => setShowCreate(false)} onSaved={(p) => { setShowCreate(false); toast.success(t('products.created', { name: p.name })); load(); }} />
      )}
      {editingProduct && (
        <ProductFormModal product={editingProduct} onClose={() => setEditingProduct(null)}
          onSaved={(p) => { setEditingProduct(null); toast.success(t('products.saved', { name: p.name })); load(); }} />
      )}
      {showCategories && <CategoriesModal onClose={() => setShowCategories(false)} onChanged={load} />}
    </div>
  );
}
