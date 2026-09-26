import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Archive, ArchiveRestore, BellOff, CheckCheck, ChevronLeft, ChevronRight, Mail, MailOpen, Settings } from 'lucide-react';
import client from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useNotifications } from '../context/NotificationContext';
import { linkFor, humanizeType } from '../utils/notificationDisplay';
import { PageHeader, StatusBadge, SEVERITY_TONE, Tabs, EmptyState, ErrorState, SkeletonPanel } from '../ui/display';
import Button, { IconButton } from '../ui/Button';
import { Select } from '../ui/Field';
import { formatWhen } from '../ui/format';

const PAGE_SIZE = 20;
const CATEGORIES = ['inventory', 'sales', 'purchasing', 'operations', 'users', 'security', 'system'];

export default function Notifications() {
  const { t } = useTranslation();
  const { hasPermission } = useAuth();
  const { setUnread, version } = useNotifications();
  const navigate = useNavigate();
  const [view, setView] = useState('all');
  const [category, setCategory] = useState('');
  const [severity, setSeverity] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const params = { page, limit: PAGE_SIZE };
      if (view === 'unread') params.status = 'unread';
      if (view === 'archived') params.archived = 'true';
      if (category) params.category = category;
      if (severity) params.severity = severity;
      const res = await client.get('/notifications', { params });
      setData(res.data);
      setUnread(res.data.unread);
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, [view, category, severity, page, setUnread]);

  useEffect(() => {
    load();
  }, [load, version]);

  async function toggleRead(n) {
    const res = await client.patch(`/notifications/${n.id}/read`, { read: !n.read_at });
    setUnread(res.data.unread);
    load();
  }

  async function toggleArchive(n) {
    const res = await client.patch(`/notifications/${n.id}/archive`, { archived: !n.archived_at });
    setUnread(res.data.unread);
    load();
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

  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;
  const filtered = category || severity;
  return (
    <div className="page page-narrow">
      <PageHeader
        title={t('notifications.title')}
        subtitle={data ? t('notifications.unreadCount', { count: data.unread }) : undefined}
        actions={(
          <>
            <Button icon={Settings} to="/settings?section=notifications">{t('notifications.preferences')}</Button>
            <Button variant="primary" icon={CheckCheck} onClick={markAllRead} disabled={!data?.unread}>{t('notifications.markAllRead')}</Button>
          </>
        )}
      />

      <div className="notification-filters">
        <Tabs label={t('notifications.title')} value={view} onChange={(v) => { setView(v); setPage(1); }}
          items={['all', 'unread', 'archived'].map((v) => ({ id: v, label: t(`notifications.view_${v}`) }))} />
        <div className="filters">
          <Select value={category} onChange={(e) => { setCategory(e.target.value); setPage(1); }} aria-label={t('notifications.category')} className="filter-select">
            <option value="">{t('notifications.allCategories')}</option>
            {CATEGORIES.map((c) => <option key={c} value={c}>{t(`notifications.categories.${c}`)}</option>)}
          </Select>
          <Select value={severity} onChange={(e) => { setSeverity(e.target.value); setPage(1); }} aria-label={t('notifications.severity')} className="filter-select">
            <option value="">{t('notifications.allSeverities')}</option>
            {['critical', 'warning', 'info'].map((s) => <option key={s} value={s}>{t(`notifications.severities.${s}`)}</option>)}
          </Select>
        </div>
      </div>

      {error && <ErrorState error={error} onRetry={load} />}
      {!data && !error && <SkeletonPanel lines={6} />}
      {data && data.items.length === 0 && (
        <EmptyState icon={BellOff}
          title={view === 'archived' ? t('notifications.emptyArchived') : filtered ? t('notifications.emptyFiltered') : t('notifications.emptyTitle')}
          description={view === 'archived' || filtered ? undefined : t('notifications.emptyHint')} />
      )}

      {data && data.items.length > 0 && (
        <ul className="notification-list">
          {data.items.map((n) => (
            <li key={n.id} className={`notification-card${n.read_at ? '' : ' unread'}`}>
              <button type="button" className="notification-card-main" onClick={() => open(n)}>
                <span className="notification-item-top">
                  <StatusBadge tone={SEVERITY_TONE[n.severity]}>{t(`notifications.severities.${n.severity}`)}</StatusBadge>
                  <span className="notification-item-time">{t(`notificationTypes.${n.type}`, { defaultValue: humanizeType(n.type) })} · {formatWhen(n.created_at, t)}</span>
                  {!n.read_at && <span className="unread-dot"><span className="sr-only">{t('notifications.unread')}</span></span>}
                </span>
                <span className="notification-item-title">{n.title}</span>
                <span className="notification-card-body">{n.body}</span>
                {n.occurrence_count > 1 && <span className="notification-item-time">{t('notifications.occurrences', { count: n.occurrence_count })}</span>}
              </button>
              <div className="notification-card-actions">
                <IconButton icon={n.read_at ? Mail : MailOpen} label={n.read_at ? t('notifications.markUnread') : t('notifications.markRead')} onClick={() => toggleRead(n)} />
                <IconButton icon={n.archived_at ? ArchiveRestore : Archive} label={n.archived_at ? t('notifications.unarchive') : t('notifications.archive')} onClick={() => toggleArchive(n)} />
              </div>
            </li>
          ))}
        </ul>
      )}

      {pages > 1 && (
        <nav className="pagination" aria-label={t('common.pagination')}>
          <span className="pagination-info num">{t('common.pageOf', { page, pages })}</span>
          <div className="pagination-buttons">
            <IconButton icon={ChevronLeft} variant="secondary" label={t('common.previous')} disabled={page <= 1} onClick={() => setPage((p) => p - 1)} />
            <IconButton icon={ChevronRight} variant="secondary" label={t('common.next')} disabled={page >= pages} onClick={() => setPage((p) => p + 1)} />
          </div>
        </nav>
      )}
    </div>
  );
}
