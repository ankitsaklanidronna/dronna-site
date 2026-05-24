import { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../services/supabaseClient.js';
import { hasAuthSession, isAccessTokenFresh, normalizeAuthUser, readStoredAuthUser, removeStoredAuthUser, writeStoredAuthUser } from '../utils/authStorage.js';

export const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const restoreUser = async () => {
      const storedUser = readStoredAuthUser();
      if (!storedUser) {
        setLoading(false);
        return;
      }

      if (!hasAuthSession(storedUser)) {
        removeStoredAuthUser();
        setUser(null);
        setLoading(false);
        return;
      }

      try {
        let isAdmin = false;

        if (storedUser?.access_token || storedUser?.refresh_token) {
          const status = await supabase.getAdminStatus(storedUser.access_token);
          isAdmin = Boolean(status?.isAdmin);
        }

        const latestStoredUser = readStoredAuthUser() || storedUser;
        const nextUser = { ...latestStoredUser, isAdmin };
        setUser(nextUser);
        writeStoredAuthUser(nextUser);
      } catch {
        removeStoredAuthUser();
        setUser(null);
      } finally {
        setLoading(false);
      }
    };

    restoreUser();
  }, []);

  const login = async (userData) => {
    const storedUser = readStoredAuthUser();
    const mergedUser = {
      ...storedUser,
      ...normalizeAuthUser(userData),
      access_token: userData?.access_token || storedUser?.access_token,
      refresh_token: userData?.refresh_token || storedUser?.refresh_token
    };

    let isAdmin = false;
    if (mergedUser?.access_token || mergedUser?.refresh_token) {
      try {
        const status = await supabase.getAdminStatus(mergedUser.access_token);
        isAdmin = Boolean(status?.isAdmin);
      } catch {
        isAdmin = false;
      }
    }

    const latestStoredUser = readStoredAuthUser();
    const bestAccessToken =
      (isAccessTokenFresh(latestStoredUser?.access_token) && latestStoredUser?.access_token) ||
      (isAccessTokenFresh(mergedUser.access_token) && mergedUser.access_token) ||
      latestStoredUser?.access_token ||
      mergedUser.access_token;
    const u = {
      ...(latestStoredUser || mergedUser),
      ...mergedUser,
      access_token: bestAccessToken,
      refresh_token: latestStoredUser?.refresh_token || mergedUser.refresh_token,
      isAdmin
    };
    setUser(u);
    writeStoredAuthUser(u);
    return u;
  };
  const logout = () => {
    setUser(null);
    removeStoredAuthUser();
  };

  return <AuthContext.Provider value={{ user, login, logout, loading }}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
