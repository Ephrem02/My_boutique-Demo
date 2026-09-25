import { useState, useEffect, useRef, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import client from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useNotifications } from '../context/NotificationContext';
import { SEVERITY_BADGE, linkFor, timeAgo } from '../utils/notificationDisplay';

export default function NotificationBell() {
  const { t } = useTranslation();
  const { hasPermission } = useAuth();
  const { unread, setUnread, version, mode } = useNotifications();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [error, setError] = useState('');
  const ref = useRef(null);

  const load = useCallback(async () => {
    try {
      const { data } = await client.get('/notifications', { params: { limit: 8 } });
      setItems(data.items);
      setUnread(data.unread);
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }, [setUnread]);

  useEffect(() => {
    if (open) load();
  }, [open, version, load]);

  useEffect(() => {
    if (!open) return undefined;
    const onClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  async function openItem(n) {
    if (!n.read_at) {
      const { data } = await client.patch(`/notifications/${n.id}/read`, { read: true }).catch(() => ({ data: null }));
      if (data) setUnread(data.unread);
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
    <div className="notif-bell" ref={ref}>
      <button
        className="icon-btn notif-bell-btn"
        onClick={() => setOpen((o) => !o)}
        aria-label={t('notifications.bellLabel', { count: unread })}
        aria-expanded={open}
        title={mode === 'polling' ? t('notifications.pollingMode') : undefined}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unread > 0 && <span className="notif-count num">{unread > 99 ? '99+' : unread}</span>}
      </button>

      {open && (
        <div className="notif-dropdown" role="dialog" aria-label={t('notifications.title')}>
          <div className="notif-dropdown-header">
            <strong>{t('notifications.title')}</strong>
            {unread > 0 && (
              <button className="link-btn" onClick={markAllRead}>
                {t('notifications.markAllRead')}
              </button>
            )}
          </div>
          {error && <div className="error-banner" style={{ margin: 10 }}>{error}</div>}
          <div className="notif-list">
            {items.length === 0 && !error && <p className="notif-empty">{t('notifications.empty')}</p>}
            {items.map((n) => (
              <button key={n.id} className={`notif-item${n.read_at ? '' : ' unread'}`} onClick={() => openItem(n)}>
                <span className={`notif-dot ${SEVERITY_BADGE[n.severity]}`} aria-hidden="true" />
                <span className="notif-item-text">
                  <span className="notif-item-title">{n.title}</span>
                  <span className="notif-item-body">{n.body}</span>
                  <span className="notif-item-meta">
                    {timeAgo(n.created_at, t)}
                    {n.occurrence_count > 1 && ` · ${t('notifications.occurrences', { count: n.occurrence_count })}`}
                  </span>
                </span>
              </button>
            ))}
          </div>
          <div className="notif-dropdown-footer">
            <Link to="/notifications" onClick={() => setOpen(false)}>{t('notifications.viewAll')}</Link>
            <Link to="/notifications/settings" onClick={() => setOpen(false)}>{t('notifications.preferences')}</Link>
          </div>
        </div>
      )}
    </div>
  );
}
