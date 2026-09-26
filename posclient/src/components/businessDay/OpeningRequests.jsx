import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DoorOpen } from 'lucide-react';
import client from '../../api/client';
import Dialog from '../../ui/Dialog';
import Button from '../../ui/Button';
import { Field, Input, Textarea } from '../../ui/Field';
import { Alert, DescriptionList, ErrorState, Panel } from '../../ui/display';
import { formatRwf, formatDate, formatTime } from '../../ui/format';
import { ReasonDialog } from './Dialogs';

/**
 * Opening the business day is approval-controlled: cashiers and store keepers
 * ask (day.open.request), a store manager approves or rejects
 * (day.open.review). The API enforces all of it - these components only
 * present the workflow.
 */
export function RequestOpeningDialog({ businessDate, onClose, onDone }) {
  const { t } = useTranslation();
  const [float, setFloat] = useState('');
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await client.post('/business-days/opening-requests', { opening_float: Number(float), reason: reason.trim(), note: note.trim() || undefined });
      onDone();
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <Dialog
      title={t('businessDay.request.title')}
      description={t('businessDay.request.hint')}
      size="sm"
      onClose={onClose}
      onSubmit={submit}
      footer={(
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" variant="primary" loading={busy} loadingText={t('common.sending')} disabled={reason.trim().length < 3}>
            {t('businessDay.request.submit')}
          </Button>
        </>
      )}
    >
      {error && <ErrorState error={error} action={t('errors.actions.openingRequest')} />}
      <DescriptionList items={[{ label: t('businessDay.businessDate'), value: formatDate(businessDate, { weekday: true }) }]} />
      <Field label={t('businessDay.request.float')} required>
        <Input type="number" inputMode="numeric" min="0" step="1" required autoFocus value={float} onChange={(e) => setFloat(e.target.value)} />
      </Field>
      <Field label={t('businessDay.request.reason')} required hint={t('common.minChars', { count: 3 })}>
        <Input required maxLength={500} placeholder={t('businessDay.request.reasonPlaceholder')} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      <Field label={t('businessDay.request.note')}>
        <Textarea maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
    </Dialog>
  );
}

/** For a requester: where their request stands (nothing when there's none yet). */
export function MyOpeningRequest({ request, onRequestAgain }) {
  const { t } = useTranslation();
  if (!request) return null;
  if (request.status === 'pending') {
    return (
      <Alert tone="info" title={t('businessDay.request.pendingTitle')}>
        {t('businessDay.request.pendingText', { time: formatTime(request.requested_at) })}
      </Alert>
    );
  }
  if (request.status === 'rejected') {
    return (
      <Alert tone="warning" title={t('businessDay.request.rejectedTitle')}
        action={onRequestAgain ? <Button size="sm" onClick={onRequestAgain}>{t('businessDay.request.requestAgain')}</Button> : null}>
        {t('businessDay.request.rejectedText', { name: request.reviewed_by_name, comment: request.manager_comment })}
      </Alert>
    );
  }
  return null;
}

/** For a store manager: one card per pending request, with Approve / Reject. */
export function OpeningRequestCards({ requests, onDecided }) {
  const { t } = useTranslation();
  const [dialog, setDialog] = useState(null); // { kind: 'approve' | 'reject', request }

  const decide = async (kind, request, comment) => {
    await client.post(`/business-days/opening-requests/${request.id}/${kind}`, { comment });
    setDialog(null);
    onDecided(t(kind === 'approve' ? 'businessDay.request.approved' : 'businessDay.request.rejected'));
  };

  return (
    <>
      {requests.map((r) => (
        <Panel key={r.id} className="opening-request" title={t('businessDay.request.cardTitle')} icon={DoorOpen}>
          <DescriptionList items={[
            { label: t('businessDay.request.requestedBy'), value: r.requested_by_name },
            { label: t('businessDay.businessDate'), value: formatDate(r.business_date, { weekday: true }) },
            { label: t('businessDay.request.reason'), value: r.reason },
            r.note && { label: t('businessDay.request.note'), value: r.note },
            { label: t('businessDay.request.float'), value: formatRwf(r.opening_float) },
            { label: t('businessDay.request.requestedAt'), value: formatTime(r.requested_at) },
          ].filter(Boolean)} />
          <div className="panel-footer-actions">
            <Button onClick={() => setDialog({ kind: 'reject', request: r })}>{t('businessDay.request.reject')}</Button>
            <Button variant="primary" onClick={() => setDialog({ kind: 'approve', request: r })}>{t('businessDay.request.approve')}</Button>
          </div>
        </Panel>
      ))}
      {dialog?.kind === 'approve' && (
        <ReasonDialog title={t('businessDay.request.approveTitle')} required={false} label={t('businessDay.request.comment')}
          description={t('businessDay.request.approveHint', { amount: formatRwf(dialog.request.opening_float), name: dialog.request.requested_by_name })}
          confirmLabel={t('businessDay.request.approve')} onClose={() => setDialog(null)}
          onSubmit={(comment) => decide('approve', dialog.request, comment)} />
      )}
      {dialog?.kind === 'reject' && (
        <ReasonDialog title={t('businessDay.request.rejectTitle')} minLength={3} danger label={t('businessDay.request.rejectReason')}
          description={t('businessDay.request.rejectHint', { name: dialog.request.requested_by_name })}
          confirmLabel={t('businessDay.request.reject')} onClose={() => setDialog(null)}
          onSubmit={(comment) => decide('reject', dialog.request, comment)} />
      )}
    </>
  );
}
