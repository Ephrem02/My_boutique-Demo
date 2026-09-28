import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ClipboardList, ClipboardPlus } from 'lucide-react';
import client from '../../api/client';
import { useIdempotencyKey } from '../../api/idempotency';
import { useAuth } from '../../context/AuthContext';
import Dialog from '../../ui/Dialog';
import Button from '../../ui/Button';
import DataTable from '../../ui/DataTable';
import { Checkbox, Field, Input, Select, Textarea } from '../../ui/Field';
import { ErrorState, StatusBadge } from '../../ui/display';
import { formatRwf, formatWhen } from '../../ui/format';

export const COUNT_TONE = { counting: 'info', submitted: 'warning', approved: 'success', rejected: 'danger', cancelled: 'neutral' };

function NewCountDialog({ onClose, onStarted }) {
  const { t } = useTranslation();
  const { hasPermission } = useAuth();
  const idem = useIdempotencyKey();
  const [locations, setLocations] = useState([]);
  const [categories, setCategories] = useState([]);
  const [products, setProducts] = useState([]);
  const [locationId, setLocationId] = useState('');
  const [scope, setScope] = useState('all');
  const [categoryId, setCategoryId] = useState('');
  const [picked, setPicked] = useState(new Set());
  const [query, setQuery] = useState('');
  const [blind, setBlind] = useState(true);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const isManager = hasPermission('stock.count.approve');

  useEffect(() => {
    client.get('/stock/locations').then(({ data }) => setLocations(data)).catch(setError);
    client.get('/categories').then(({ data }) => setCategories(data)).catch(() => setCategories([]));
    client.get('/products').then(({ data }) => setProducts(data)).catch(() => setProducts([]));
  }, []);

  const matching = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? products.filter((p) => `${p.name} ${p.sku}`.toLowerCase().includes(q)) : products;
  }, [products, query]);

  async function submit() {
    setError(null);
    setLoading(true);
    try {
      const { data } = await client.post('/stock-counts', {
        location_id: locationId ? Number(locationId) : undefined, scope,
        ...(scope === 'category' && { category_id: Number(categoryId) }),
        ...(scope === 'products' && { product_ids: [...picked] }),
        blind: isManager ? blind : true, notes: notes || undefined,
      }, idem.config());
      idem.reset();
      onStarted(data);
    } catch (err) {
      setError(err);
      setLoading(false);
    }
  }

  const toggle = (id) => setPicked((s) => {
    const next = new Set(s);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });

  return (
    <Dialog title={t('counts.newTitle')} description={t('counts.newHint')} onClose={onClose} onSubmit={submit}
      footer={(
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" variant="primary" loading={loading} loadingText={t('common.saving')}>{t('counts.start')}</Button>
        </>
      )}
    >
      {error && <ErrorState error={error} />}
      <div className="form-row">
        <Field label={t('common.location')}>
          <Select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
            <option value="">{t('counts.allLocations')}</option>
            {locations.map((l) => <option key={l.id} value={l.id}>{t(`locations.${l.name}`, { defaultValue: l.name })}</option>)}
          </Select>
        </Field>
        <Field label={t('counts.what')}>
          <Select value={scope} onChange={(e) => setScope(e.target.value)}>
            <option value="all">{t('counts.scope.all')}</option>
            <option value="category">{t('counts.scope.category')}</option>
            <option value="products">{t('counts.scope.products')}</option>
          </Select>
        </Field>
      </div>
      {scope === 'category' && (
        <Field label={t('counts.category')} required>
          <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} required>
            <option value="">{t('counts.chooseCategory')}</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
      )}
      {scope === 'products' && (
        <fieldset className="fieldset">
          <legend className="field-label">{t('counts.pickProducts', { count: picked.size })}</legend>
          <Input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('products.searchPlaceholder')} aria-label={t('products.searchPlaceholder')} />
          <ul className="count-product-picker">
            {matching.slice(0, 100).map((p) => (
              <li key={p.id}><Checkbox label={`${p.name} · ${p.sku}`} checked={picked.has(p.id)} onChange={() => toggle(p.id)} /></li>
            ))}
          </ul>
        </fieldset>
      )}
      {isManager && <Checkbox label={t('counts.blind')} description={t('counts.blindHint')} checked={blind} onChange={(e) => setBlind(e.target.checked)} />}
      <Field label={t('finance.notes')}><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={1000} /></Field>
    </Dialog>
  );
}

/** Stock page tab: every count, newest first; start a new one. */
export default function StockCounts() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await client.get('/stock-counts');
      setRows(data);
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const startButton = hasPermission('stock.count') && <Button variant="primary" icon={ClipboardPlus} onClick={() => setCreating(true)}>{t('counts.new')}</Button>;
  return (
    <>
      <DataTable
        caption={t('counts.title')}
        columns={[
          { key: 'number', header: t('counts.number'), sortable: true, mobile: 'title' },
          { key: 'location', header: t('common.location'), mobile: 'subtitle', render: (c) => (c.location ? t(`locations.${c.location}`, { defaultValue: c.location }) : t('counts.allLocations')) },
          { key: 'status', header: t('common.status'), mobile: 'meta', render: (c) => <StatusBadge tone={COUNT_TONE[c.status]}>{t(`counts.statuses.${c.status}`)}</StatusBadge> },
          { key: 'progress', header: t('counts.progress'), align: 'right', render: (c) => `${c.counted_count} / ${c.line_count}` },
          { key: 'differences', header: t('counts.differences'), align: 'right', mobile: 'value', render: (c) => (c.lines_with_difference === null ? '—' : c.lines_with_difference) },
          { key: 'shortage_value', header: t('counts.shortage'), align: 'right', render: (c) => (c.shortage_value === null ? '—' : formatRwf(c.shortage_value)) },
          { key: 'started', header: t('counts.started'), render: (c) => `${c.started_by_name} · ${formatWhen(c.started_at, t)}` },
        ]}
        rows={rows}
        loading={!rows}
        error={error}
        onRetry={load}
        onRowClick={(c) => navigate(`/stock-counts/${c.id}`)}
        rowLabel={(c) => t('common.openNamed', { name: c.number })}
        toolbar={startButton}
        empty={{ icon: ClipboardList, title: t('counts.none'), description: t('counts.noneHint'), action: startButton || null }}
      />
      {creating && <NewCountDialog onClose={() => setCreating(false)} onStarted={(c) => navigate(`/stock-counts/${c.id}`)} />}
    </>
  );
}
