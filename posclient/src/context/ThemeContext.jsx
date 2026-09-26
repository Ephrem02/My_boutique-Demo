import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import client from '../api/client';
import { useAuth } from './AuthContext';

// Appearance: 'light' | 'dark' | 'system'. The choice is saved to the user's
// account (so it follows them to any device - important on shared tills)
// and cached in localStorage so index.html can apply it before first paint.
const STORAGE_KEY = 'appearance';
const ThemeContext = createContext(null);
const darkQuery = () => window.matchMedia('(prefers-color-scheme: dark)');

function readStored() {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return ['light', 'dark', 'system'].includes(v) ? v : 'system';
  } catch {
    return 'system';
  }
}

function apply(preference) {
  const dark = preference === 'dark' || (preference === 'system' && darkQuery().matches);
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  return dark ? 'dark' : 'light';
}

export function ThemeProvider({ children }) {
  const { user } = useAuth();
  const [preference, setPreferenceState] = useState(readStored);
  const [resolved, setResolved] = useState(() => apply(readStored()));

  // A signed-in user's saved choice wins over this device's cache.
  useEffect(() => {
    const saved = user?.preferences?.appearance;
    if (saved && saved !== preference) setPreferenceState(saved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  useEffect(() => {
    setResolved(apply(preference));
    try {
      localStorage.setItem(STORAGE_KEY, preference);
    } catch {
      // storage blocked - the theme still applies for this session
    }
    if (preference !== 'system') return undefined;
    const query = darkQuery();
    const onChange = () => setResolved(apply('system'));
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, [preference]);

  const setPreference = useCallback(
    async (next) => {
      setPreferenceState(next);
      if (user) {
        await client.put('/auth/me/preferences', { appearance: next }).catch(() => {});
      }
    },
    [user]
  );

  return <ThemeContext.Provider value={{ preference, resolved, setPreference }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
