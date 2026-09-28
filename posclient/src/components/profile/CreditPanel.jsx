import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Gauge, SlidersHorizontal } from 'lucide-react';
import client from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import Dialog from '../../ui/Dialog';
import Button from '../../ui/Button';
import { Checkbox, Field, Input } from '../../ui/Field';
import { Alert, ErrorState, Metric, Panel, SkeletonPanel, StatusBadge } from '../../ui/display';
import DataTable from '../../ui/DataTable';
import { useToast } from '../../ui/Toast';
import { formatRwf, formatDate } from '../../ui/format';
import { ReasonDialog } from '../businessDay/Dialogs';

export const EXCEPTION_TONE = { pending: 'warning', approved: 'info', used: 'success', rejected: 'neutral', expired: 'neutral' };

function CreditLimitDialog({ party, status, onClose, onSaved }) {
  const { t } = useTranslation();
  const [enabled, setEnabled] = useState(status.credit_enabled);
  const [limit, setLimit] = useState(status.credit_limit === null ? '' : String(status.credit_limit));
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await client.put(`/institutions/${party.id}/credit`, { credit_enabled: enabled, credit_limit: limit === '' ? null : Number(limit), reason: reason || undefined });
      onSaved();
    } catch (err) {
      setError(err);
      setSaving(false);
    }
  }

  return (
    <Dialog title={t('credit.setTitle', { name: party.name })} description={t('credit.setHint')} size="sm" onClose={onClose} onSubmit={save}
      footer={(
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" variant="primary" loading={saving} loadingText={t('common.saving')}>{t('common.save')}</Button>
        </>
      )}
    >
      {error && <ErrorState error={error} />}
      <Checkbox label={t('credit.enabled')} description={t('credit.enabledHint')} checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
      <Field label={t('credit.limitRwf')} hint={t('credit.limitHint')}>
        <Input type="number" inputMode="numeric" min="0" step="1" value={limit} onChange={(e) => setLimit(e.target.value)} disabled={!enabled} />
      </Field>
      <Field label={t('credit.changeReason')}>
        <Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
      </Field>
    </Dialog>
  );
}

/** Customer 360°: limit, exposure, available credit, and over-limit requests. */
export default function CreditPanel({ party, onChanged }) {
  const { t } = useTranslation();
  const toast = useToast();
  const { hasPermission, user } = useAuth();
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);
  const [dialog, setDialog] = useState(null);
  const canManage = hasPermission('credit.manage');

  const load = useCallback(async () => {
    try {
      const { data } = await client.get(`/finance/customer/parties/${party.id}/credit`);
      setStatus(data);
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, [party.id]);

  useEffect(() => {
    load();
  }, [load]);

  if (error) return <ErrorState error={error} onRetry={load} />;
  if (!status) return <SkeletonPanel lines={3} />;

  const done = (message) => {
    setDialog(null);
    toast.success(message);
    load();
    onChanged?.();
  };
  const limitLabel = !status.credit_enabled ? t('credit.noCredit') : status.credit_limit === null ? t('credit.noLimit') : formatRwf(status.credit_limit);

  return (
    <Panel title={t('credit.title')} icon={Gauge} subtitle={t('credit.exposureHint')} className="profile-section"
      actions={canManage && <Button icon={SlidersHorizontal} onClick={() => setDialog({ type: 'limit' })}>{t('credit.change')}</Button>}>
      {status.over_limit && <Alert tone="danger" title={t('credit.overLimitNow', { amount: formatRwf(status.exposure - status.effective_limit) })} />}
      <div className="ledger-summary">
        <Metric label={t('credit.limit')} value={limitLabel} />
        <Metric label={t('credit.exposure')} value={formatRwf(status.exposure)} />
        <Metric label={t('credit.available')} value={status.available === null ? '—' : formatRwf(status.available)}
          tone={status.available === 0 && status.effective_limit !== null ? 'warning' : undefined} />
        <Metric label={t('finance.overdue')} value={formatRwf(status.overdue)} tone={status.overdue > 0 ? 'danger' : undefined} />
      </div>

      {status.recent_exceptions.length > 0 && (
        <DataTable
          caption={t('credit.exceptions')}
          columns={[
            { key: 'created_at', header: t('common.date'), mobile: 'subtitle', render: (e) => formatDate(e.business_date) },
            { key: 'amount', header: t('credit.overBy'), align: 'right', mobile: 'value', render: (e) => formatRwf(e.amount) },
            { key: 'reason', header: t('credit.reason'), mobile: 'title' },
            { key: 'who', header: t('credit.requestedBy'), render: (e) => (e.approval === 'inline' ? t('credit.inlineBy', { name: e.decided_by_name }) : e.requested_by_name) },
            {
              key: 'status', header: t('common.status'), mobile: 'meta',
              render: (e) => (
                <>
                  <StatusBadge tone={EXCEPTION_TONE[e.status]}>{t(`credit.statuses.${e.status}`)}</StatusBadge>
                  {e.order_id && <span className="text-muted"> · #{e.order_id}</span>}
                </>
              ),
            },
            canManage && {
              key: 'actions', header: t('common.actions'),
              render: (e) => (e.status === 'pending' && e.requested_by !== user?.id ? (
                <span className="record-card-actions">
                  <Button size="sm" variant="primary" onClick={() => setDialog({ type: 'approve', ex: e })}>{t('credit.approve')}</Button>
                  <Button size="sm" onClick={() => setDialog({ type: 'reject', ex: e })}>{t('credit.reject')}</Button>
                </span>
              ) : null),
            },
          ].filter(Boolean)}
          rows={status.recent_exceptions}
          pageSize={5}
        />
      )}

      {dialog?.type === 'limit' && <CreditLimitDialog party={party} status={status} onClose={() => setDialog(null)} onSaved={() => done(t('credit.saved'))} />}
      {(dialog?.type === 'approve' || dialog?.type === 'reject') && (
        <ReasonDialog
          title={dialog.type === 'approve' ? t('credit.approveTitle') : t('credit.rejectTitle')}
          description={t('credit.decideHint', { name: dialog.ex.requested_by_name, amount: formatRwf(dialog.ex.amount), reason: dialog.ex.reason })}
          label={dialog.type === 'approve' ? t('businessDay.review.note') : t('businessDay.review.reason')}
          required={dialog.type === 'reject'} minLength={dialog.type === 'reject' ? 3 : 0} danger={dialog.type === 'reject'}
          confirmLabel={dialog.type === 'approve' ? t('credit.approve') : t('credit.reject')}
          onClose={() => setDialog(null)}
          onSubmit={async (note) => {
            await client.post(`/credit-exceptions/${dialog.ex.id}/decision`, { decision: dialog.type, note: note || undefined });
            done(dialog.type === 'approve' ? t('credit.approved') : t('credit.rejected'));
          }}
        />
      )}
    </Panel>
  );
}
