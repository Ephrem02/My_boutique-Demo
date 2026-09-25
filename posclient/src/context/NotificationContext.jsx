import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import client, { API_BASE_URL } from '../api/client';
import { useAuth } from './AuthContext';

// Live unread count for the signed-in user.
// Primary: Server-Sent Events (/notifications/stream) - the server pushes the
// new count the moment a notification commits. Fallback: if the stream keeps
// failing (proxy strips it, server restarting, old browser), poll the count
// every 60s and retry live mode every 5 minutes.
// Only a count travels over the stream; content is fetched via the normal API.
const POLL_MS = 60 * 1000;
const RETRY_LIVE_MS = 5 * 60 * 1000;
const MAX_STREAM_ERRORS = 3;

const NotificationContext = createContext(null);

export function NotificationProvider({ children }) {
  const { user, recheckSession } = useAuth();
  const [unread, setUnread] = useState(0);
  const [mode, setMode] = useState('off'); // 'live' | 'polling' | 'off'
  // Bumped whenever the server says something changed, so open lists refetch.
  const [version, setVersion] = useState(0);
  const sourceRef = useRef(null);

  const refresh = useCallback(async () => {
    try {
      const { data } = await client.get('/notifications/unread-count');
      setUnread(data.count);
      setVersion((v) => v + 1);
    } catch {
      // ignore - the next poll or push will catch up
    }
  }, []);

  useEffect(() => {
    if (!user) {
      setUnread(0);
      setMode('off');
      return undefined;
    }

    let pollTimer = null;
    let retryTimer = null;
    let errors = 0;
    let disposed = false;

    const startPolling = () => {
      setMode('polling');
      refresh();
      pollTimer = setInterval(refresh, POLL_MS);
      retryTimer = setTimeout(() => {
        clearInterval(pollTimer);
        if (!disposed) startLive();
      }, RETRY_LIVE_MS);
    };

    const startLive = () => {
      if (typeof EventSource === 'undefined') return startPolling();
      const source = new EventSource(`${API_BASE_URL}/notifications/stream`, { withCredentials: true });
      sourceRef.current = source;
      source.addEventListener('open', () => {
        errors = 0;
        setMode('live');
      });
      source.addEventListener('unread', (e) => {
        try {
          setUnread(JSON.parse(e.data).count);
          setVersion((v) => v + 1);
        } catch {
          // malformed event - ignore
        }
      });
      source.addEventListener('session-ended', () => {
        source.close();
        recheckSession?.();
      });
      source.onerror = () => {
        errors += 1;
        if (errors >= MAX_STREAM_ERRORS) {
          source.close();
          sourceRef.current = null;
          if (!disposed) startPolling();
        }
      };
    };

    startLive();
    return () => {
      disposed = true;
      sourceRef.current?.close();
      sourceRef.current = null;
      clearInterval(pollTimer);
      clearTimeout(retryTimer);
    };
  }, [user, refresh, recheckSession]);

  return (
    <NotificationContext.Provider value={{ unread, setUnread, mode, version, refresh }}>
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotifications() {
  const ctx = useContext(NotificationContext);
  if (!ctx) throw new Error('useNotifications must be used within NotificationProvider');
  return ctx;
}
