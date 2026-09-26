import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ImagePlus } from 'lucide-react';
import client from '../api/client';
import { useAuth } from '../context/AuthContext';
import { getProductIcon } from '../utils/productIcon';
import Dialog from '../ui/Dialog';
import Button from '../ui/Button';
import { Field, Input, Select } from '../ui/Field';
import { ErrorState } from '../ui/display';

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
  const [error, setError] = useState(null);
  const [imageError, setImageError] = useState('');
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef(null);

  useEffect(() => {
    client.get('/categories').then(({ data }) => setCategories(data)).catch(() => {});
    if (!isEdit && canRecordStock) {
      client.get('/stock/locations').then(({ data }) => {
        setLocations(data);
        const frontShelf = data.find((l) => l.name === 'front_shelf');
        if (frontShelf) setInitialLocationId(String(frontShelf.id));
      }).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const update = (field, value) => setForm((f) => ({ ...f, [field]: value }));

  async function handleFileSelected(e) {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow picking the same file again later
    if (!file) return;
    if (!file.type.startsWith('image/')) return setImageError(t('products.imageFileTypeError'));
    if (file.size > MAX_IMAGE_BYTES) return setImageError(t('products.imageFileSizeError'));
    setImageError('');
    setUploading(true);
    try {
      const body = new FormData();
      body.append('image', file);
      const { data } = await client.post('/uploads/product-image', body);
      update('image_url', data.url);
    } catch (err) {
      setImageError(err.message);
    } finally {
      setUploading(false);
    }
  }

  async function handleSubmit() {
    setError(null);
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
      setError(err);
      setLoading(false);
    }
  }

  return (
    <Dialog
      title={isEdit ? t('products.editProduct') : t('products.newProductTitle')}
      size="lg"
      onClose={onClose}
      onSubmit={handleSubmit}
      footer={(
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" variant="primary" loading={loading} loadingText={t('common.saving')}>
            {isEdit ? t('products.saveChanges') : t('products.addProduct')}
          </Button>
        </>
      )}
    >
      {error && <ErrorState error={error} action={t('errors.actions.product')} />}

      <div className="form-section-title">{t('products.sectionDetails')}</div>
      <div className="form-row">
        <Field label={t('products.sku')} required hint={isEdit ? t('products.skuLocked') : undefined}>
          <Input value={form.sku} onChange={(e) => update('sku', e.target.value)} required disabled={isEdit} autoFocus={!isEdit} />
        </Field>
        <Field label={t('common.name')} required>
          <Input value={form.name} onChange={(e) => update('name', e.target.value)} required autoFocus={isEdit} />
        </Field>
      </div>
      <div className="form-row">
        <Field label={t('products.category')}>
          <Select value={form.category_id} onChange={(e) => update('category_id', e.target.value)}>
            <option value="">{t('products.noCategory')}</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        <Field label={t('products.unit')}>
          <Select value={form.unit} onChange={(e) => update('unit', e.target.value)}>
            {UNITS.map((u) => <option key={u} value={u}>{t(`products.units.${u}`)}</option>)}
          </Select>
        </Field>
      </div>

      <div className="form-section-title">{t('products.sectionPricing')}</div>
      <div className="form-row">
        <Field label={t('products.costPriceRwf')}>
          <Input type="number" inputMode="numeric" min="0" value={form.cost_price} onChange={(e) => update('cost_price', e.target.value)} />
        </Field>
        <Field label={t('products.sellingPriceRwf')} hint={!canSetPrice ? t('products.sellingPriceLocked') : undefined}>
          <Input type="number" inputMode="numeric" min="0" value={form.selling_price} onChange={(e) => update('selling_price', e.target.value)} disabled={!canSetPrice} />
        </Field>
        <Field label={t('products.reorderLevel')} hint={t('products.reorderHint')}>
          <Input type="number" inputMode="numeric" min="0" value={form.reorder_level} onChange={(e) => update('reorder_level', e.target.value)} />
        </Field>
      </div>

      <div className="form-section-title">{t('products.sectionPhoto')}</div>
      <div className="photo-field">
        <span className="product-thumb product-thumb-lg" aria-hidden="true">
          {form.image_url ? <img src={form.image_url} alt="" onError={(e) => { e.currentTarget.hidden = true; }} /> : getProductIcon(form.name)}
        </span>
        <div className="photo-field-inputs">
          <Field label={t('products.imageUrl')} error={imageError || undefined}>
            <Input value={form.image_url} onChange={(e) => update('image_url', e.target.value)} placeholder={t('products.imageUrlPlaceholder')} />
          </Field>
          <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileSelected} hidden />
          <Button icon={ImagePlus} onClick={() => fileInputRef.current?.click()} loading={uploading} loadingText={t('products.uploadingPhoto')}>
            {t('products.uploadPhoto')}
          </Button>
        </div>
      </div>

      {!isEdit && canRecordStock && (
        <>
          <div className="form-section-title">{t('products.initialStock')}</div>
          <div className="form-row">
            <Field label={t('products.quantityOnHand')} hint={t('products.initialStockHint')}>
              <Input type="number" inputMode="numeric" min="0" value={initialQuantity} onChange={(e) => setInitialQuantity(e.target.value)} placeholder="0" />
            </Field>
            <Field label={t('common.location')}>
              <Select value={initialLocationId} onChange={(e) => setInitialLocationId(e.target.value)}>
                {locations.map((l) => <option key={l.id} value={l.id}>{t(`locations.${l.name}`, { defaultValue: l.name.replace('_', ' ') })}</option>)}
              </Select>
            </Field>
          </div>
        </>
      )}
    </Dialog>
  );
}
