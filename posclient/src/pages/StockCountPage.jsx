import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Ban, CheckCircle2, ClipboardCheck, Save, Send, XCircle } from 'lucide-react';
import client from '../api/client';
import { useIdempotencyKey } from '../api/idempotency';
import { useAuth } from '../context/AuthContext';
import DocumentActions from '../components/documents/DocumentActions';
import { ReasonDialog } from '../components/businessDay/Dialogs';
import { COUNT_TONE } from '../components/stock/StockCounts';
import Button from '../ui/Button';
import DataTable from '../ui/DataTable';
import { Checkbox, Input, Select } from '../ui/Field';
import { Alert, ErrorState, Metric, PageHeader, SkeletonPanel, StatusBadge } from '../ui/display';
import { useToast } from '../ui/Toast';
import { formatRwf, formatWhen, formatNumber } from '../ui/format';

const REASONS = ['miscount', 'theft', 'spoilage', 'other'];

/**
 * One stock count: enter what is physically there (blind counts hide the
 * system figure from counters), submit, then a manager who did not count
 * approves or rejects the differences.
 */
export default function StockCountPage() {
  const { id } = useParams();
  const { t } = useTranslation();
  const toast = useToast();
  const { hasPermission, user } = useAuth();
  const idem = useIdempotencyKey();
  const [count, setCount] = useState(null);
  const [edits, setEdits] = useState({}); // lineId -> { counted_qty, reason, note }
  const [onlyDifferences, setOnlyDifferences] = useState(true);
  const [error, setError] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [dialog, setDialog] = useState(null);

  const load = useCallback(async () => {
    try {
      const { data } = await client.get(`/stock-counts/${id}`);
      setCount(data);
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const value = (line, field) => (edits[line.id]?.[field] !== undefined ? edits[line.id][field] : line[field] ?? '');
  const edit = (line, field, v) => setEdits((e) => ({ ...e, [line.id]: { ...e[line.id], [field]: v } }));
  const dirty = Object.keys(edits).length;

  async function save() {
    if (!dirty) return;
    const lines = Object.entries(edits).map(([lineId, e]) => ({ id: Number(lineId), ...e }));
    await client.put(`/stock-counts/${id}/lines`, { lines });
    setEdits({});
  }

  async function run(action) {
    setActionError(null);
    try {
      await action();
      await load();
    } catch (err) {
      setActionError(err);
    }
  }

  const rows = useMemo(() => {
    if (!count) return [];
    if (count.status === 'counting' || !onlyDifferences) return count.lines;
    return count.lines.filter((l) => l.variance);
  }, [count, onlyDifferences]);

  if (error && !count) return <div className="page"><ErrorState error={error} onRetry={load} /></div>;
  if (!count) return <div className="page"><SkeletonPanel lines={10} /></div>;

  const counting = count.status === 'counting';
  const tookPart = [count.started_by, count.submitted_by].includes(user?.id) || count.lines.some((l) => l.counted_by === user?.id);
  const canDecide = count.status === 'submitted' && hasPermission('stock.count.approve') && !tookPart;
  const counted = count.lines.filter((l) => value(l, 'counted_qty') !== '').length;
  const showSystem = !count.system_hidden;
  const location = (l) => t(`locations.${l.location}`, { defaultValue: l.location });

  const columns = [
    { key: 'product_name', header: t('common.product'), mobile: 'title', render: (l) => <>{l.product_name}<div className="text-muted">{l.sku}</div></>, searchValue: (l) => `${l.product_name} ${l.sku}` },
    { key: 'location', header: t('common.location'), mobile: 'meta', render: location },
    showSystem && { key: 'expected_qty', header: t('counts.expected'), align: 'right', render: (l) => formatNumber(l.expected_qty) },
    {
      key: 'counted_qty', header: t('counts.counted'), align: 'right', mobile: counting ? 'detail' : 'value',
      render: (l) => (counting ? (
        <Input type="number" inputMode="numeric" min="0" step="1" className="count-input" value={value(l, 'counted_qty')}
          aria-label={t('counts.countedOf', { name: l.product_name, location: location(l) })}
          onChange={(e) => edit(l, 'counted_qty', e.target.value === '' ? null : e.target.value)} />
      ) : formatNumber(l.counted_qty)),
    },
    showSystem && {
      key: 'variance', header: t('counts.difference'), align: 'right',
      render: (l) => {
        const c = value(l, 'counted_qty');
        const v = counting ? (c === '' || c === null ? null : Number(c) - l.expected_qty) : l.variance;
        if (v === null) return '—';
        return <span className={v < 0 ? 'text-danger' : v > 0 ? 'text-info' : undefined}>{v > 0 ? `+${v}` : v}</span>;
      },
    },
    !counting && { key: 'variance_value', header: t('counts.valueAtCost'), align: 'right', render: (l) => formatRwf(l.variance_value, { signed: true }) },
    {
      key: 'reason', header: t('counts.reason'),
      render: (l) => (counting ? (
        <Select value={value(l, 'reason')} onChange={(e) => edit(l, 'reason', e.target.value || null)} aria-label={t('counts.reasonFor', { name: l.product_name })}>
          <option value="">{t('counts.noReason')}</option>
          {REASONS.map((r) => <option key={r} value={r}>{t(`counts.reasons.${r}`)}</option>)}
        </Select>
      ) : (l.reason ? `${t(`counts.reasons.${l.reason}`)}${l.note ? ` · ${l.note}` : ''}` : '—')),
    },
  ].filter(Boolean);

  return (
    <div className="page">
      <PageHeader
        title={t('counts.pageTitle', { number: count.number })}
        subtitle={`${count.location_id ? location(count.lines[0] || {}) : t('counts.allLocations')} · ${t('counts.startedBy', { name: count.started_by_name, when: formatWhen(count.started_at, t) })}`}
        actions={(
          <>
            <Button icon={ArrowLeft} to="/stock?tab=counts">{t('counts.title')}</Button>
            <DocumentActions path={`/stock-counts/${count.id}`} params={{ kind: counting ? 'sheet' : 'report' }}
              filename={`${count.number}-${counting ? 'sheet' : 'differences'}.pdf`} printLabel={counting ? t('counts.printSheet') : t('counts.printReport')} />
          </>
        )}
      >
        <div className="record-card-badges profile-badges">
          <StatusBadge tone={COUNT_TONE[count.status]}>{t(`counts.statuses.${count.status}`)}</StatusBadge>
          {count.blind && <StatusBadge tone="neutral">{t('counts.blindBadge')}</StatusBadge>}
        </div>
      </PageHeader>

      {count.system_hidden && <Alert tone="info" title={t('counts.blindTitle')}>{t('counts.blindBody')}</Alert>}
      {count.status === 'submitted' && tookPart && hasPermission('stock.count.approve') && <Alert tone="info" title={t('counts.otherManager')} />}
      {count.decision_note && !counting && <Alert tone={count.status === 'rejected' ? 'danger' : 'info'} title={t(`counts.statuses.${count.status}`)}>{count.decided_by_name ? `${count.decided_by_name}: ` : ''}{count.decision_note}</Alert>}
      {actionError && <ErrorState error={actionError} />}

      {!counting && count.lines_with_difference !== null && (
        <div className="ledger-summary">
          <Metric label={t('counts.differences')} value={formatNumber(count.lines_with_difference)} hint={t('counts.ofLines', { count: count.lines.length })} />
          <Metric label={t('counts.shortage')} value={formatRwf(count.shortage_value)} tone={count.shortage_value > 0 ? 'danger' : undefined} />
          <Metric label={t('counts.overage')} value={formatRwf(count.overage_value)} />
        </div>
      )}

      <DataTable
        caption={t('counts.lines')}
        columns={columns}
        rows={rows}
        searchable
        searchPlaceholder={t('products.searchPlaceholder')}
        pageSize={50}
        toolbar={!counting && <Checkbox label={t('counts.onlyDifferences')} checked={onlyDifferences} onChange={(e) => setOnlyDifferences(e.target.checked)} className="filter-check" />}
        empty={{ icon: ClipboardCheck, title: t('counts.noDifferences') }}
      />

      <div className="panel-footer-actions">
        {counting && (
          <>
            <span className="field-hint">{t('counts.countedProgress', { counted, total: count.lines.length })}</span>
            {(count.started_by === user?.id || hasPermission('stock.count.approve')) && <Button icon={Ban} onClick={() => setDialog('cancel')}>{t('counts.cancel')}</Button>}
            <Button icon={Save} disabled={!dirty} onClick={() => run(async () => { await save(); toast.success(t('counts.saved')); })}>{t('counts.save')}</Button>
            <Button variant="primary" icon={Send} onClick={() => run(async () => {
              await save();
              const { data } = await client.post(`/stock-counts/${id}/submit`, {}, idem.config());
              idem.reset();
              toast.success(data.status === 'approved' ? t('counts.submittedClean') : t('counts.submitted'));
            })}>{t('counts.submit')}</Button>
          </>
        )}
        {canDecide && (
          <>
            <Button icon={XCircle} onClick={() => setDialog('reject')}>{t('counts.reject')}</Button>
            <Button variant="primary" icon={CheckCircle2} onClick={() => setDialog('approve')}>{t('counts.approve')}</Button>
          </>
        )}
      </div>

      {(dialog === 'approve' || dialog === 'reject') && (
        <ReasonDialog
          title={dialog === 'approve' ? t('counts.approveTitle') : t('counts.rejectTitle')}
          description={dialog === 'approve' ? t('counts.approveHint', { count: count.lines_with_difference }) : t('counts.rejectHint')}
          label={dialog === 'approve' ? t('businessDay.review.note') : t('businessDay.review.reason')}
          required={dialog === 'reject'} minLength={dialog === 'reject' ? 3 : 0} danger={dialog === 'reject'}
          confirmLabel={dialog === 'approve' ? t('counts.approve') : t('counts.reject')}
          onClose={() => setDialog(null)}
          onSubmit={async (note) => {
            await client.post(`/stock-counts/${id}/decision`, { decision: dialog, note: note || undefined });
            setDialog(null);
            toast.success(dialog === 'approve' ? t('counts.approved') : t('counts.rejected'));
            load();
          }}
        />
      )}
      {dialog === 'cancel' && (
        <ReasonDialog title={t('counts.cancelTitle')} label={t('businessDay.review.reason')} minLength={3} danger confirmLabel={t('counts.cancel')}
          onClose={() => setDialog(null)}
          onSubmit={async (reason) => {
            await client.post(`/stock-counts/${id}/cancel`, { reason });
            setDialog(null);
            toast.success(t('counts.cancelled'));
            load();
          }} />
      )}
    </div>
  );
}
