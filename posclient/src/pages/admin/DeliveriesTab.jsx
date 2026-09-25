import { Fragment, useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import client from '../../api/client';
import { humanizeType } from '../../utils/notificationDisplay';

const STATUSES = ['pending', 'sending', 'sent', 'failed', 'dead', 'skipped'];
const STATUS_BADGE = { sent: 'paid', pending: 'partial', sending: 'partial', failed: 'partial', dead: 'unpaid', skipped: '' };
const PAGE_SIZE = 25;

export default function DeliveriesTab() {
  const { t } = useTranslation();
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState(null);

  const load = useCallback(async () => {
    try {
      const params = { page, limit: PAGE_SIZE };
      if (status) params.status = status;
      setData((await client.get('/admin/deliveries', { params })).data);
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }, [status, page]);

  useEffect(() => {
    load();
  }, [load]);

  async function resend(id) {
    try {
      await client.post(`/admin/deliveries/${id}/resend`);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <>
      {data && (
        <div className="tabs" style={{ marginBottom: 16 }}>
          <button className={`tab${status === '' ? ' active' : ''}`} onClick={() => { setStatus(''); setPage(1); }}>
            {t('admin.deliveries.all')}
          </button>
          {STATUSES.map((s) => (
            <button key={s} className={`tab${status === s ? ' active' : ''}`} onClick={() => { setStatus(s); setPage(1); }}>
              {t(`admin.deliveries.status.${s}`)} <span className="num">({data.by_status[s] || 0})</span>
            </button>
          ))}
        </div>
      )}
      {error && <div className="error-banner">{error}</div>}
      {data && (
        <table className="data-table">
          <thead>
            <tr>
              <th>{t('common.date')}</th>
              <th>{t('notifications.type')}</th>
              <th>{t('admin.deliveries.recipient')}</th>
              <th>{t('admin.deliveries.subject')}</th>
              <th>{t('common.status')}</th>
              <th>{t('admin.deliveries.attempts')}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((d) => (
              <Fragment key={d.id}>
                <tr className="clickable" onClick={() => setExpanded(expanded === d.id ? null : d.id)}>
                  <td>{new Date(d.created_at).toLocaleString()}</td>
                  <td>{t(`notificationTypes.${d.type}`, { defaultValue: humanizeType(d.type) })}</td>
                  <td>{d.recipient_name}<div className="hint">{d.recipient_email || t('admin.deliveries.noEmail')}</div></td>
                  <td style={{ fontSize: 13 }}>{d.subject}</td>
                  <td><span className={`badge ${STATUS_BADGE[d.status]}`}>{t(`admin.deliveries.status.${d.status}`)}</span></td>
                  <td className="num">{d.attempts}</td>
                  <td>
                    {['failed', 'dead', 'skipped'].includes(d.status) && (
                      <button className="btn btn-sm" onClick={(e) => { e.stopPropagation(); resend(d.id); }}>{t('admin.deliveries.resend')}</button>
                    )}
                  </td>
                </tr>
                {expanded === d.id && (
                  <tr key={`${d.id}-detail`}>
                    <td colSpan={7} style={{ background: 'var(--surface)', fontSize: 13 }}>
                      {d.skip_reason && <div><strong>{t('admin.deliveries.skipReason')}:</strong> {t(`admin.deliveries.skip.${d.skip_reason}`, { defaultValue: d.skip_reason })}</div>}
                      {d.last_error && <div><strong>{t('admin.deliveries.lastError')}:</strong> <code>{d.last_error}</code></div>}
                      {d.status === 'failed' && <div><strong>{t('admin.deliveries.nextAttempt')}:</strong> {new Date(d.next_attempt_at).toLocaleString()}</div>}
                      {d.sent_at && <div><strong>{t('admin.deliveries.sentAt')}:</strong> {new Date(d.sent_at).toLocaleString()}</div>}
                      {!d.skip_reason && !d.last_error && !d.sent_at && <div>{t('admin.deliveries.noDetail')}</div>}
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            {data.items.length === 0 && (
              <tr><td colSpan={7} style={{ color: 'var(--ink-muted)' }}>{t('admin.deliveries.empty')}</td></tr>
            )}
          </tbody>
        </table>
      )}
      {pages > 1 && (
        <div className="pager">
          <button className="btn" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>{t('common.previous')}</button>
          <span className="num">{t('common.pageOf', { page, pages })}</span>
          <button className="btn" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>{t('common.next')}</button>
        </div>
      )}
    </>
  );
}
