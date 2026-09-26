import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import client from '../api/client';
import Dialog from '../ui/Dialog';
import Button from '../ui/Button';
import { Field, Input, Select } from '../ui/Field';
import { ErrorState } from '../ui/display';

// One dialog for the three manual stock actions (replaces three near-copies).
const KINDS = {
  intake: { endpoint: '/stock/intake', defaultLocation: 'store_room', submitVariant: 'primary' },
  transfer: { endpoint: '/stock/transfer', submitVariant: 'primary' },
  damage: { endpoint: '/stock/damage', submitVariant: 'danger' },
};

export default function StockMovementDialog({ kind, onClose, onRecorded }) {
  const { t } = useTranslation();
  const config = KINDS[kind];
  const [products, setProducts] = useState([]);
  const [locations, setLocations] = useState([]);
  const [form, setForm] = useState({ productId: '', locationId: '', fromLocationId: '', toLocationId: '', quantity: '', notes: '' });
  const [fieldErrors, setFieldErrors] = useState({});
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    Promise.all([client.get('/products'), client.get('/stock/locations')])
      .then(([p, l]) => {
        setProducts(p.data);
        setLocations(l.data);
        const preset = config.defaultLocation && l.data.find((loc) => loc.name === config.defaultLocation);
        if (preset) setForm((f) => ({ ...f, locationId: String(preset.id) }));
      })
      .catch(setError);
  }, [config.defaultLocation]);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const locationLabel = (l) => t(`locations.${l.name}`, { defaultValue: l.name.replace('_', ' ') });
  const selected = products.find((p) => String(p.id) === form.productId);

  async function submit() {
    const errors = {};
    if (!form.productId) errors.productId = t('validation.required');
    if (!form.quantity || Number(form.quantity) < 1 || !Number.isInteger(Number(form.quantity))) errors.quantity = t('validation.wholeNumber');
    if (kind === 'transfer') {
      if (!form.fromLocationId) errors.fromLocationId = t('validation.required');
      if (!form.toLocationId) errors.toLocationId = t('validation.required');
      if (form.fromLocationId && form.fromLocationId === form.toLocationId) errors.toLocationId = t('stock.sameLocationError');
    } else if (!form.locationId) {
      errors.locationId = t('validation.required');
    }
    setFieldErrors(errors);
    if (Object.keys(errors).length) return;

    setError(null);
    setLoading(true);
    try {
      const body = { product_id: Number(form.productId), quantity: Number(form.quantity), notes: form.notes || undefined };
      if (kind === 'transfer') {
        body.from_location_id = Number(form.fromLocationId);
        body.to_location_id = Number(form.toLocationId);
      } else {
        body.location_id = Number(form.locationId);
      }
      await client.post(config.endpoint, body);
      onRecorded(selected);
    } catch (err) {
      setError(err);
      setLoading(false);
    }
  }

  const locationSelect = (key, label) => (
    <Field label={label} required error={fieldErrors[key]}>
      <Select value={form[key]} onChange={set(key)}>
        <option value="">{t('common.selectLocation')}</option>
        {locations.map((l) => <option key={l.id} value={l.id}>{locationLabel(l)}</option>)}
      </Select>
    </Field>
  );

  return (
    <Dialog
      title={t(`stock.${kind}Title`)}
      description={t(`stock.${kind}Hint`)}
      onClose={onClose}
      onSubmit={submit}
      footer={(
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" variant={config.submitVariant} loading={loading} loadingText={t('common.recording')}>{t(`stock.${kind}Submit`)}</Button>
        </>
      )}
    >
      {error && <ErrorState error={error} action={t('errors.actions.stock')} />}
      <Field label={t('common.product')} required error={fieldErrors.productId}>
        <Select value={form.productId} onChange={set('productId')} autoFocus>
          <option value="">{t('common.selectProduct')}</option>
          {products.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>)}
        </Select>
      </Field>
      {kind === 'transfer' ? (
        <div className="form-row">
          {locationSelect('fromLocationId', t('stock.from'))}
          {locationSelect('toLocationId', t('stock.to'))}
        </div>
      ) : (
        locationSelect('locationId', t('common.location'))
      )}
      <Field label={t('common.quantity')} required error={fieldErrors.quantity}>
        <Input type="number" inputMode="numeric" min="1" step="1" value={form.quantity} onChange={set('quantity')} />
      </Field>
      <Field label={t('common.notesOptional')}>
        <Input value={form.notes} onChange={set('notes')} maxLength={500} />
      </Field>
    </Dialog>
  );
}
