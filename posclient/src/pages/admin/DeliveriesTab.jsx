import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { RotateCw, Send } from 'lucide-react';
import client from '../../api/client';
import Button from '../../ui/Button';
import Dialog from '../../ui/Dialog';
import { StatusBadge, Tabs, DescriptionList } from '../../ui/display';
import DataTable from '../../ui/DataTable';
import { useToast } from '../../ui/Toast';
import { humanizeType } from '../../utils/notificationDisplay';
import { formatWhen } from '../../ui/format';
import AdminSection from './AdminSection';

const STATUSES = ['pending', 'sending', 'sent', 'failed', 'dead', 'skipped'];
const STATUS_TONE = { sent: 'success', pending: 'info', sending: 'info', failed: 'warning', dead: 'danger', skipped: 'neutral' };

export default function DeliveriesTab() {
  const { t } = useTranslation();
  const toast = useToast();
  const [status, setStatus] = useState('all');
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [detail, setDetail] = useState(null);

  const load = useCallback(async () => {
    try {
      const params = { limit: 100 };
      if (status !== 'all') params.status = status;
      setData((await client.get('/admin/deliveries', { params })).data);
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, [status]);

  useEffect(() => {
    load();
  }, [load]);

  async function resend(d) {
    await client.post(`/admin/deliveries/${d.id}/resend`);
    toast.success(t('admin.deliveries.resent'));
    setDetail(null);
    load();
  }

  const columns = [
    { key: 'created_at', header: t('common.date'), mobile: 'subtitle', render: (d) => formatWhen(d.created_at, t) },
    { key: 'subject', header: t('admin.deliveries.subject'), mobile: 'title', render: (d) => <span className="cell-stack"><span className="cell-strong">{d.subject}</span><span className="cell-note">{t(`notificationTypes.${d.type}`, { defaultValue: humanizeType(d.type) })}</span></span> },
    { key: 'recipient', header: t('admin.deliveries.recipient'), render: (d) => <span className="cell-stack"><span>{d.recipient_name}</span><span className="cell-note">{d.recipient_email || t('admin.deliveries.noEmail')}</span></span> },
    { key: 'status', header: t('common.status'), mobile: 'meta', render: (d) => <StatusBadge tone={STATUS_TONE[d.status]}>{t(`admin.deliveries.status.${d.status}`)}</StatusBadge> },
    { key: 'attempts', header: t('admin.deliveries.attempts'), align: 'right', mobile: 'value' },
  ];

  return (
    <AdminSection title={t('admin.sections.deliveries.title')} description={t('admin.sections.deliveries.description')}>
      <Tabs label={t('admin.sections.deliveries.title')} value={status} onChange={setStatus} className="page-tabs"
        items={[{ id: 'all', label: t('common.all') }, ...STATUSES.map((s) => ({ id: s, label: t(`admin.deliveries.status.${s}`), count: data?.by_status[s] || 0 }))]} />
      <DataTable caption={t('admin.sections.deliveries.title')} columns={columns} rows={data?.items} loading={!data} error={error} onRetry={load}
        onRowClick={setDetail} rowLabel={(d) => t('admin.deliveries.openNamed', { subject: d.subject })}
        empty={{ icon: Send, title: t('admin.deliveries.empty'), description: t('admin.deliveries.emptyHint') }} />

      {detail && (
        <Dialog title={detail.subject} description={`${detail.recipient_name} · ${detail.recipient_email || t('admin.deliveries.noEmail')}`} onClose={() => setDetail(null)}
          footer={['failed', 'dead', 'skipped'].includes(detail.status) ? <Button variant="primary" icon={RotateCw} onClick={() => resend(detail)}>{t('admin.deliveries.resend')}</Button> : null}>
          <DescriptionList items={[
            { label: t('common.status'), value: <StatusBadge tone={STATUS_TONE[detail.status]}>{t(`admin.deliveries.status.${detail.status}`)}</StatusBadge> },
            { label: t('admin.deliveries.attempts'), value: detail.attempts },
            detail.skip_reason && { label: t('admin.deliveries.skipReason'), value: t(`admin.deliveries.skip.${detail.skip_reason}`, { defaultValue: detail.skip_reason }) },
            detail.last_error && { label: t('admin.deliveries.lastError'), value: <code>{detail.last_error}</code> },
            detail.status === 'failed' && { label: t('admin.deliveries.nextAttempt'), value: formatWhen(detail.next_attempt_at, t) },
            detail.sent_at && { label: t('admin.deliveries.sentAt'), value: formatWhen(detail.sent_at, t) },
          ]} />
        </Dialog>
      )}
    </AdminSection>
  );
}
