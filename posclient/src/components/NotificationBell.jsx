import { useState, useEffect, useRef, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Bell, BellOff, CheckCheck } from 'lucide-react';
import client from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useNotifications } from '../context/NotificationContext';
import { linkFor } from '../utils/notificationDisplay';
import { StatusBadge, SEVERITY_TONE, EmptyState, ErrorState } from '../ui/display';
import { formatWhen } from '../ui/format';

/** Header bell: unread count + a panel with the latest notifications. */
export default function NotificationBell() {
  const { t } = useTranslation();
  const { hasPermission } = useAuth();
  const { unread, setUnread, version, mode } = useNotifications();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  const ref = useRef(null);
  const buttonRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const { data } = await client.get('/notifications', { params: { limit: 8 } });
      setItems(data.items);
      setUnread(data.unread);
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, [setUnread]);

  useEffect(() => {
    if (open) load();
  }, [open, version, load]);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  async function openItem(n) {
    if (!n.read_at) {
      const res = await client.patch(`/notifications/${n.id}/read`, { read: true }).catch(() => null);
      if (res) setUnread(res.data.unread);
    }
    setOpen(false);
    navigate(linkFor(n, hasPermission) || '/notifications');
  }

  async function markAllRead() {
    await client.post('/notifications/read-all');
    setUnread(0);
    load();
  }

  return (
    <div className="popover-anchor" ref={ref}>
      <button
        ref={buttonRef}
        type="button"
        className="icon-button bell-button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="true"
        aria-label={t('notifications.bellLabel', { count: unread })}
        title={mode === 'polling' ? t('notifications.pollingMode') : t('notifications.title')}
      >
        <Bell aria-hidden="true" />
        {unread > 0 && <span className="count-badge num" aria-hidden="true">{unread > 99 ? '99+' : unread}</span>}
      </button>

      {open && (
        <div className="popover popover-right notification-panel" role="dialog" aria-label={t('notifications.title')}>
          <div className="notification-panel-header">
            <h2 className="notification-panel-title">{t('notifications.title')}</h2>
            {unread > 0 && (
              <button type="button" className="btn btn-link btn-sm" onClick={markAllRead}>
                <CheckCheck className="btn-icon" aria-hidden="true" />
                {t('notifications.markAllRead')}
              </button>
            )}
          </div>
          <div className="notification-panel-list">
            {error && <div className="notification-panel-pad"><ErrorState error={error} onRetry={load} /></div>}
            {!error && items && items.length === 0 && (
              <EmptyState compact icon={BellOff} title={t('notifications.emptyTitle')} description={t('notifications.emptyHint')} />
            )}
            {!error && !items && <div className="notification-panel-pad text-muted">{t('common.loading')}</div>}
            {items?.map((n) => (
              <button key={n.id} type="button" className={`notification-item${n.read_at ? '' : ' unread'}`} onClick={() => openItem(n)}>
                <span className="notification-item-top">
                  <StatusBadge tone={SEVERITY_TONE[n.severity]}>{t(`notifications.severities.${n.severity}`)}</StatusBadge>
                  <span className="notification-item-time">{formatWhen(n.created_at, t)}</span>
                  {!n.read_at && <span className="unread-dot"><span className="sr-only">{t('notifications.unread')}</span></span>}
                </span>
                <span className="notification-item-title">{n.title}</span>
                <span className="notification-item-body">{n.body}</span>
                {n.occurrence_count > 1 && <span className="notification-item-time">{t('notifications.occurrences', { count: n.occurrence_count })}</span>}
              </button>
            ))}
          </div>
          <div className="notification-panel-footer">
            <Link to="/notifications" onClick={() => setOpen(false)}>{t('notifications.viewAll')}</Link>
            <Link to="/settings?section=notifications" onClick={() => setOpen(false)}>{t('notifications.preferences')}</Link>
          </div>
        </div>
      )}
    </div>
  );
}
