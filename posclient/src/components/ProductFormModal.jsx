import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import client from '../api/client';
import { useAuth } from '../context/AuthContext';
import { getProductIcon } from '../utils/productIcon';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const UNITS = ['pcs', 'kg', 'litre', 'box', 'pack'];

export default function ProductFormModal({ product, onClose, onSaved }) {
  const { t } = useTranslation();
  const { hasPermission } = useAuth();
  const canSetPrice = hasPermission('pricing.manage');
  const canRecordStock = hasPermission('stock.intake');
  const isEdit = Boolean(product);

  const [categories, setCategories] = useState([]);
  const [locations, setLocations] = useState([]);
  const [form, setForm] = useState({
    sku: product?.sku || '',
    name: product?.name || '',
    category_id: product?.category_id || '',
    unit: product?.unit || 'pcs',
    cost_price: product?.cost_price ?? '',
    selling_price: product?.selling_price ?? '',
    reorder_level: product?.reorder_level ?? 0,
    image_url: product?.image_url || '',
  });
  const [initialQuantity, setInitialQuantity] = useState('');
  const [initialLocationId, setInitialLocationId] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef(null);

  useEffect(() => {
    client.get('/categories').then(({ data }) => setCategories(data));
    if (!isEdit && canRecordStock) {
      client.get('/stock/locations').then(({ data }) => {
        setLocations(data);
        const frontShelf = data.find((l) => l.name === 'front_shelf');
        if (frontShelf) setInitialLocationId(String(frontShelf.id));
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function handleFileSelected(e) {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow picking the same file again later
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setError(t('products.imageFileTypeError'));
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setError(t('products.imageFileSizeError'));
      return;
    }

    setError('');
    setUploading(true);
    try {
      const body = new FormData();
      body.append('image', file);
      const { data } = await client.post('/uploads/product-image', body);
      update('image_url', data.url);
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const payload = {
        name: form.name,
        category_id: form.category_id || null,
        unit: form.unit,
        cost_price: Number(form.cost_price) || 0,
        reorder_level: Number(form.reorder_level) || 0,
        image_url: form.image_url.trim() || null,
      };
      if (canSetPrice) payload.selling_price = Number(form.selling_price) || 0;

      if (isEdit) {
        const { data } = await client.put(`/products/${product.id}`, payload);
        onSaved(data);
      } else {
        const { data } = await client.post('/products', { ...payload, sku: form.sku });

        if (canRecordStock && Number(initialQuantity) > 0 && initialLocationId) {
          await client.post('/stock/intake', {
            product_id: data.id,
            location_id: Number(initialLocationId),
            quantity: Number(initialQuantity),
            notes: 'Initial stock on product setup',
          });
        }

        onSaved(data);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="modal-overlay">
      <form className="modal-card" onSubmit={handleSubmit}>
        <h2>{isEdit ? t('products.editProduct') : t('products.newProductTitle')}</h2>
        {error && <div className="error-banner">{error}</div>}

        <div className="field">
          <label htmlFor="sku">{t('products.sku')}</label>
          <input
            id="sku"
            value={form.sku}
            onChange={(e) => update('sku', e.target.value)}
            required
            disabled={isEdit}
            autoFocus={!isEdit}
          />
        </div>
        <div className="field">
          <label htmlFor="name">{t('common.name')}</label>
          <input id="name" value={form.name} onChange={(e) => update('name', e.target.value)} required autoFocus={isEdit} />
        </div>
        <div className="field">
          <label htmlFor="image_url">{t('products.imageUrl')}</label>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 8 }}>
            <span className="product-tile-image" style={{ width: 48, aspectRatio: '1 / 1', flexShrink: 0 }}>
              {form.image_url ? (
                <img src={form.image_url} alt="" onError={(e) => { e.target.style.display = 'none'; }} />
              ) : (
                <span className="product-tile-icon" style={{ fontSize: 22 }} aria-hidden="true">
                  {getProductIcon(form.name)}
                </span>
              )}
            </span>
            <input
              id="image_url"
              style={{ flex: 1 }}
              value={form.image_url}
              onChange={(e) => update('image_url', e.target.value)}
              placeholder={t('products.imageUrlPlaceholder')}
            />
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleFileSelected}
            style={{ display: 'none' }}
          />
          <button
            type="button"
            className="btn"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
          >
            {uploading ? t('products.uploadingPhoto') : t('products.uploadPhoto')}
          </button>
        </div>
        <div className="field">
          <label htmlFor="category">{t('products.category')}</label>
          <select id="category" value={form.category_id} onChange={(e) => update('category_id', e.target.value)}>
            <option value="">{t('products.noCategory')}</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="unit">{t('products.unit')}</label>
          <select id="unit" value={form.unit} onChange={(e) => update('unit', e.target.value)}>
            {UNITS.map((u) => (
              <option key={u} value={u}>
                {t(`products.units.${u}`)}
              </option>
            ))}
          </select>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <div className="field" style={{ flex: 1 }}>
            <label htmlFor="cost_price">{t('products.costPrice')}</label>
            <input
              id="cost_price"
              type="number"
              min="0"
              value={form.cost_price}
              onChange={(e) => update('cost_price', e.target.value)}
            />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label htmlFor="selling_price">{t('products.sellingPrice')}</label>
            <input
              id="selling_price"
              type="number"
              min="0"
              value={form.selling_price}
              onChange={(e) => update('selling_price', e.target.value)}
              disabled={!canSetPrice}
              title={!canSetPrice ? t('products.sellingPriceLocked') : undefined}
            />
          </div>
        </div>
        <div className="field">
          <label htmlFor="reorder_level">{t('products.reorderLevel')}</label>
          <input
            id="reorder_level"
            type="number"
            min="0"
            value={form.reorder_level}
            onChange={(e) => update('reorder_level', e.target.value)}
          />
        </div>

        {!isEdit && canRecordStock && (
          <>
            <div className="section-title" style={{ marginTop: 6 }}>{t('products.initialStock')}</div>
            <div style={{ display: 'flex', gap: 10 }}>
              <div className="field" style={{ flex: 1 }}>
                <label htmlFor="initial_quantity">{t('products.quantityOnHand')}</label>
                <input
                  id="initial_quantity"
                  type="number"
                  min="0"
                  value={initialQuantity}
                  onChange={(e) => setInitialQuantity(e.target.value)}
                  placeholder="0"
                />
              </div>
              <div className="field" style={{ flex: 1 }}>
                <label htmlFor="initial_location">{t('common.location')}</label>
                <select id="initial_location" value={initialLocationId} onChange={(e) => setInitialLocationId(e.target.value)}>
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {t(`locations.${l.name}`, { defaultValue: l.name.replace('_', ' ') })}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <p className="hint" style={{ margin: '0 0 14px' }}>{t('products.initialStockHint')}</p>
          </>
        )}

        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="btn btn-primary btn-block" disabled={loading}>
            {loading ? t('common.saving') : isEdit ? t('products.saveChanges') : t('products.addProduct')}
          </button>
        </div>
      </form>
    </div>
  );
}
