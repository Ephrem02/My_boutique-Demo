import { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import client from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useNotifications } from '../context/NotificationContext';
import { SEVERITY_BADGE, linkFor, humanizeType } from '../utils/notificationDisplay';

const PAGE_SIZE = 20;
const CATEGORIES = ['inventory', 'sales', 'purchasing', 'operations', 'users', 'security', 'system'];

export default function Notifications() {
  const { t } = useTranslation();
  const { hasPermission } = useAuth();
  const { setUnread, version } = useNotifications();
  const navigate = useNavigate();
  const [view, setView] = useState('all'); // all | unread | archived
  const [category, setCategory] = useState('');
  const [severity, setSeverity] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState({ items: [], total: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = { page, limit: PAGE_SIZE };
      if (view === 'unread') params.status = 'unread';
      if (view === 'archived') params.archived = 'true';
      if (category) params.category = category;
      if (severity) params.severity = severity;
      const res = await client.get('/notifications', { params });
      setData(res.data);
      setUnread(res.data.unread);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [view, category, severity, page, setUnread]);

  useEffect(() => {
    load();
  }, [load, version]);

  async function act(n, action) {
    try {
      const res = action === 'read'
        ? await client.patch(`/notifications/${n.id}/read`, { read: !n.read_at })
        : await client.patch(`/notifications/${n.id}/archive`, { archived: !n.archived_at });
      setUnread(res.data.unread);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function open(n) {
    if (!n.read_at) await client.patch(`/notifications/${n.id}/read`, { read: true }).catch(() => {});
    const to = linkFor(n, hasPermission);
    if (to) navigate(to);
    else load();
  }

  async function markAllRead() {
    await client.post('/notifications/read-all');
    setUnread(0);
    load();
  }

  const pages = Math.max(1, Math.ceil(data.total / PAGE_SIZE));

  return (
    <div className="page-body">
      <div className="page-header">
        <h1>{t('notifications.title')}</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <Link className="btn" to="/notifications/settings">{t('notifications.preferences')}</Link>
          <button className="btn btn-primary" onClick={markAllRead}>{t('notifications.markAllRead')}</button>
        </div>
      </div>

      <div className="toolbar">
        <div className="tabs" role="tablist">
          {['all', 'unread', 'archived'].map((v) => (
            <button key={v} role="tab" aria-selected={view === v} className={`tab${view === v ? ' active' : ''}`} onClick={() => { setView(v); setPage(1); }}>
              {t(`notifications.view_${v}`)}
            </button>
          ))}
        </div>
        <select value={category} onChange={(e) => { setCategory(e.target.value); setPage(1); }} aria-label={t('notifications.category')}>
          <option value="">{t('notifications.allCategories')}</option>
          {CATEGORIES.map((c) => <option key={c} value={c}>{t(`notifications.categories.${c}`)}</option>)}
        </select>
        <select value={severity} onChange={(e) => { setSeverity(e.target.value); setPage(1); }} aria-label={t('notifications.severity')}>
          <option value="">{t('notifications.allSeverities')}</option>
          {['critical', 'warning', 'info'].map((s) => <option key={s} value={s}>{t(`notifications.severities.${s}`)}</option>)}
        </select>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {!loading && data.items.length === 0 && <p style={{ color: 'var(--ink-muted)' }}>{t('notifications.empty')}</p>}

      <div className="notif-page-list">
        {data.items.map((n) => (
          <div key={n.id} className={`notif-card${n.read_at ? '' : ' unread'}`}>
            <div className="notif-card-main" onClick={() => open(n)} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && open(n)}>
              <div className="notif-card-top">
                <span className={`badge ${SEVERITY_BADGE[n.severity]}`}>{t(`notifications.severities.${n.severity}`)}</span>
                <span className="notif-card-type">{t(`notificationTypes.${n.type}`, { defaultValue: humanizeType(n.type) })}</span>
                <span className="notif-card-date">{new Date(n.created_at).toLocaleString()}</span>
              </div>
              <div className="notif-card-title">{n.title}</div>
              <div className="notif-card-body">{n.body}</div>
              {n.occurrence_count > 1 && <div className="notif-card-date">{t('notifications.occurrences', { count: n.occurrence_count })}</div>}
            </div>
            <div className="notif-card-actions">
              <button className="link-btn" onClick={() => act(n, 'read')}>
                {n.read_at ? t('notifications.markUnread') : t('notifications.markRead')}
              </button>
              <button className="link-btn" onClick={() => act(n, 'archive')}>
                {n.archived_at ? t('notifications.unarchive') : t('notifications.archive')}
              </button>
            </div>
          </div>
        ))}
      </div>

      {pages > 1 && (
        <div className="pager">
          <button className="btn" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>{t('common.previous')}</button>
          <span className="num">{t('common.pageOf', { page, pages })}</span>
          <button className="btn" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>{t('common.next')}</button>
        </div>
      )}
    </div>
  );
}
