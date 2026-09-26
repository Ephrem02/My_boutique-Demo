import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { FileCheck2 } from 'lucide-react';
import client from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useNotifications } from '../context/NotificationContext';
import { ReasonDialog } from '../components/businessDay/Dialogs';
import { PageHeader, StatusBadge, Tabs } from '../ui/display';
import DataTable from '../ui/DataTable';
import Button from '../ui/Button';
import { useToast } from '../ui/Toast';
import { formatRwf, formatWhen } from '../ui/format';
import { dayTitle } from '../components/businessDay/ClosingReport';

const STATUS_TONE = { pending: 'warning', approved: 'success', rejected: 'danger' };

// Reviewers (day.review) see every request and decide them - never their own.
// Everyone else sees only the requests they made.
export default function Corrections() {
  const { t } = useTranslation();
  const toast = useToast();
  const { hasPermission, user } = useAuth();
  const { version } = useNotifications();
  const canReview = hasPermission('day.review');
  const [status, setStatus] = useState(canReview ? 'pending' : 'all');
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [deciding, setDeciding] = useState(null);

  const load = useCallback(async () => {
    try {
      setRows((await client.get('/corrections', { params: status !== 'all' ? { status } : {} })).data);
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, [status]);

  useEffect(() => {
    load();
  }, [load, version]);

  const columns = [
    { key: 'business_date', header: t('businessDay.businessDate'), sortable: true, mobile: 'subtitle', render: (r) => dayTitle(t, r) },
    { key: 'field', header: t('businessDay.correction.field'), mobile: 'title', render: (r) => t(`businessDay.fields.${r.field}`) },
    { key: 'change', header: t('businessDay.correction.change'), align: 'right', mobile: 'value', render: (r) => `${formatRwf(r.original_value)} → ${formatRwf(r.requested_value)}` },
    { key: 'reason', header: t('businessDay.correction.reason'), render: (r) => <span>{r.reason}{r.explanation && <span className="cell-note">{r.explanation}</span>}</span> },
    { key: 'requested_by_name', header: t('businessDay.correction.requestedBy'), render: (r) => <span>{r.requested_by_name}<span className="cell-note">{formatWhen(r.requested_at, t)}</span></span> },
    {
      key: 'status', header: t('common.status'), mobile: 'meta',
      render: (r) => (
        <span>
          <StatusBadge tone={STATUS_TONE[r.status]}>{t(`businessDay.correctionStatus.${r.status}`)}</StatusBadge>
          {r.reviewed_by_name && <span className="cell-note">{r.reviewed_by_name}{r.review_reason ? `: ${r.review_reason}` : ''}</span>}
        </span>
      ),
    },
    canReview && {
      key: 'actions', header: <span className="sr-only">{t('common.actions')}</span>, mobile: 'meta',
      render: (r) => {
        if (r.status !== 'pending') return null;
        if (r.requested_by === user.id) return <span className="cell-note">{t('businessDay.correction.ownRequest')}</span>;
        return (
          <span className="row-actions">
            <Button size="sm" variant="primary" onClick={() => setDeciding({ row: r, decision: 'approve' })}>{t('businessDay.correction.approve')}</Button>
            <Button size="sm" onClick={() => setDeciding({ row: r, decision: 'reject' })}>{t('businessDay.correction.reject')}</Button>
          </span>
        );
      },
    },
  ].filter(Boolean);

  return (
    <div className="page">
      <PageHeader title={canReview ? t('businessDay.correctionsReview') : t('businessDay.myCorrections')} subtitle={t('businessDay.correctionsSubtitle')} />
      <Tabs label={t('businessDay.corrections')} value={status} onChange={setStatus} className="page-tabs"
        items={['pending', 'approved', 'rejected', 'all'].map((s) => ({ id: s, label: s === 'all' ? t('common.all') : t(`businessDay.correctionStatus.${s}`) }))} />
      <DataTable caption={t('businessDay.corrections')} columns={columns} rows={rows} loading={!rows} error={error} onRetry={load}
        empty={{ icon: FileCheck2, title: t('businessDay.correction.none'), description: canReview ? t('businessDay.correction.noneReviewHint') : t('businessDay.correction.noneHint') }} />

      {deciding && (
        <ReasonDialog
          title={deciding.decision === 'approve' ? t('businessDay.correction.approveTitle') : t('businessDay.correction.rejectTitle')}
          description={`${t(`businessDay.fields.${deciding.row.field}`)}: ${formatRwf(deciding.row.original_value)} → ${formatRwf(deciding.row.requested_value)}`}
          label={t('businessDay.review.reason')}
          required={deciding.decision === 'reject'}
          minLength={deciding.decision === 'reject' ? 5 : 0}
          danger={deciding.decision === 'reject'}
          confirmLabel={deciding.decision === 'approve' ? t('businessDay.correction.approve') : t('businessDay.correction.reject')}
          onClose={() => setDeciding(null)}
          onSubmit={async (reason) => {
            await client.post(`/corrections/${deciding.row.id}/decision`, { decision: deciding.decision, reason });
            toast.success(deciding.decision === 'approve' ? t('businessDay.correction.approvedToast') : t('businessDay.correction.rejectedToast'));
            setDeciding(null);
            load();
          }}
        />
      )}
    </div>
  );
}
