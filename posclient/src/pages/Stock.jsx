import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeftRight, Boxes, History, PackagePlus, TriangleAlert } from 'lucide-react';
import client from '../api/client';
import { useAuth } from '../context/AuthContext';
import StockMovementDialog from '../components/StockMovementDialog';
import { PageHeader, StatusBadge, Tabs } from '../ui/display';
import DataTable from '../ui/DataTable';
import Button from '../ui/Button';
import { useToast } from '../ui/Toast';
import { formatNumber, formatWhen } from '../ui/format';

const MOVEMENT_TONE = {
  stock_in: 'success', returned: 'info', transfer_in: 'neutral', transfer_out: 'neutral', sold: 'neutral', damaged: 'danger', adjustment: 'warning',
  returned_to_supplier: 'warning',
};

export default function Stock() {
  const { t } = useTranslation();
  const toast = useToast();
  const { hasPermission } = useAuth();
  // Movement history names who did what - hidden from cashiers (least privilege)
  const canSeeMovements = hasPermission('stock.movements.view');
  const [levels, setLevels] = useState(null);
  const [movements, setMovements] = useState(null);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState('levels');
  const [dialog, setDialog] = useState(null);

  const load = useCallback(async () => {
    try {
      const [{ data: levelData }, movementRes] = await Promise.all([
        client.get('/stock/levels'),
        canSeeMovements ? client.get('/stock/movements') : Promise.resolve(null),
      ]);
      setLevels(levelData);
      setMovements(movementRes ? movementRes.data.slice(0, 200) : []);
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, [canSeeMovements]);

  useEffect(() => {
    load();
  }, [load]);

  const location = (name) => t(`locations.${name}`, { defaultValue: name.replace('_', ' ') });

  const levelColumns = [
    { key: 'name', header: t('common.product'), sortable: true, mobile: 'title' },
    { key: 'sku', header: t('products.sku'), sortable: true, mobile: 'subtitle', render: (l) => <span className="text-secondary">{l.sku}</span> },
    { key: 'location', header: t('common.location'), sortable: true, mobile: 'meta', render: (l) => <StatusBadge tone="neutral" dot={false}>{location(l.location)}</StatusBadge> },
    {
      key: 'quantity', header: t('common.quantity'), align: 'right', sortable: true, mobile: 'value', sortValue: (l) => Number(l.quantity),
      render: (l) => (Number(l.quantity) === 0 ? <StatusBadge tone="danger">{t('products.stockOut')}</StatusBadge> : formatNumber(l.quantity)),
    },
  ];

  const movementColumns = [
    { key: 'created_at', header: t('common.date'), sortable: true, mobile: 'subtitle', render: (m) => formatWhen(m.created_at, t) },
    { key: 'product_name', header: t('common.product'), sortable: true, mobile: 'title' },
    { key: 'type', header: t('common.type'), sortable: true, mobile: 'meta', render: (m) => <StatusBadge tone={MOVEMENT_TONE[m.type]}>{t(`movementTypes.${m.type}`, { defaultValue: m.type })}</StatusBadge> },
    { key: 'location', header: t('common.location'), sortable: true, render: (m) => location(m.location) },
    { key: 'quantity', header: t('common.quantity'), align: 'right', sortable: true, mobile: 'value', sortValue: (m) => Number(m.quantity), render: (m) => formatNumber(m.quantity) },
    { key: 'performed_by_name', header: t('stock.by'), sortable: true },
    { key: 'notes', header: t('common.notes'), render: (m) => <span className="text-secondary">{m.notes || '—'}</span> },
  ];

  const recorded = (kind) => (product) => {
    setDialog(null);
    toast.success(t(`stock.${kind}Done`, { name: product?.name || '' }));
    load();
  };

  return (
    <div className="page">
      <PageHeader
        title={t('stock.title')}
        subtitle={t('stock.subtitle')}
        actions={(
          <>
            {hasPermission('stock.adjust') && <Button variant="danger" icon={TriangleAlert} onClick={() => setDialog('damage')}>{t('stock.reportDamage')}</Button>}
            {hasPermission('stock.transfer') && <Button icon={ArrowLeftRight} onClick={() => setDialog('transfer')}>{t('stock.transferStock')}</Button>}
            {hasPermission('stock.intake') && <Button variant="primary" icon={PackagePlus} onClick={() => setDialog('intake')}>{t('stock.stockIntake')}</Button>}
          </>
        )}
      />

      {canSeeMovements && (
        <Tabs label={t('stock.title')} value={tab} onChange={setTab} className="page-tabs"
          items={[{ id: 'levels', label: t('stock.currentLevels') }, { id: 'movements', label: t('stock.recentMovements') }]} />
      )}

      {tab === 'levels' && (
        <DataTable caption={t('stock.currentLevels')} columns={levelColumns} rows={levels} rowKey={(l) => `${l.product_id}-${l.location}`}
          loading={!levels} error={error} onRetry={load} searchable searchPlaceholder={t('products.searchPlaceholder')}
          initialSort={{ key: 'name', dir: 'asc' }} empty={{ icon: Boxes, title: t('stock.noStockRecorded'), description: t('stock.noStockHint') }} />
      )}
      {tab === 'movements' && canSeeMovements && (
        <DataTable caption={t('stock.recentMovements')} columns={movementColumns} rows={movements} loading={!movements} error={error} onRetry={load}
            searchable searchPlaceholder={t('stock.searchMovements')} empty={{ icon: History, title: t('stock.noMovements'), description: t('stock.noMovementsHint') }} />
      )}

      {dialog && <StockMovementDialog kind={dialog} onClose={() => setDialog(null)} onRecorded={recorded(dialog)} />}
    </div>
  );
}
