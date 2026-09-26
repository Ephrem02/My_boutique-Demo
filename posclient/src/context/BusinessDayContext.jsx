import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import client from '../api/client';
import { useAuth } from './AuthContext';
import { useNotifications } from './NotificationContext';

// One shared copy of /business-days/dashboard for the header status pill,
// the till banner and the dashboard page. Refreshes when a notification
// arrives (closing events push through SSE) and every minute otherwise.
const REFRESH_MS = 60 * 1000;
const BusinessDayContext = createContext(null);

export function BusinessDayProvider({ children }) {
  const { user, hasPermission } = useAuth();
  const { version } = useNotifications();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const enabled = !!user && hasPermission('day.view');

  const refresh = useCallback(async () => {
    if (!enabled) return;
    try {
      setData((await client.get('/business-days/dashboard')).data);
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      setData(null);
      return undefined;
    }
    refresh();
    const timer = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(timer);
  }, [enabled, refresh, version]);

  // 'open' | 'closing_in_progress' | 'none' | null (unknown / no access)
  const status = !data ? null : data.today ? data.today.day.status : 'none';

  return (
    <BusinessDayContext.Provider value={{ data, error, status, loading: enabled && !data && !error, refresh }}>
      {children}
    </BusinessDayContext.Provider>
  );
}

export function useBusinessDay() {
  const ctx = useContext(BusinessDayContext);
  if (!ctx) throw new Error('useBusinessDay must be used within BusinessDayProvider');
  return ctx;
}
