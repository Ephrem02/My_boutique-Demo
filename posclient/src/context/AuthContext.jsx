import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import client from '../api/client';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // The session token lives in an httpOnly cookie, invisible to JS, so on
  // load we ask the server who (if anyone) it belongs to.
  useEffect(() => {
    let cancelled = false;
    client
      .get('/auth/me')
      .then(({ data }) => {
        if (!cancelled) setUser(data.user);
      })
      .catch(() => {
        if (!cancelled) setUser(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (email, password) => {
    const { data } = await client.post('/auth/login', { email, password });
    setUser(data.user);
    return data.user;
  }, []);

  const logout = useCallback(async () => {
    try {
      await client.post('/auth/logout');
    } finally {
      setUser(null);
    }
  }, []);

  // Called when the server ends a live session (password reset, account
  // disabled): if /me no longer accepts the cookie, drop to the login screen.
  const recheckSession = useCallback(async () => {
    try {
      const { data } = await client.get('/auth/me');
      setUser(data.user);
    } catch {
      setUser(null);
    }
  }, []);

  const hasPermission = useCallback(
    (...codes) => user?.permissions?.some((p) => codes.includes(p)) ?? false,
    [user]
  );

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, hasPermission, recheckSession }}>{children}</AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
