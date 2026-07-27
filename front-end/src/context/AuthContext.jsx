import { useCallback, useMemo, useState } from 'react';
import api from '../api/axios';
import encryptedStorage from '../utils/encryptedStorage';
import { AUTH_STORAGE_KEY, AuthContext } from './authStore.js';

// Run the one-time plaintext->encrypted migration at module load rather than
// inside useState. As a lazy initialiser it ran on every AuthProvider mount and
// in StrictMode's double render, re-encrypting every storage key each time.
encryptedStorage.encryptAllExisting();

/**
 * Session provider. The context object and `useAuth` live in `authStore.js` so
 * this file exports only a component — see that file for why the split matters
 * for Fast Refresh.
 */
export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(() => encryptedStorage.getItem(AUTH_STORAGE_KEY));

  const login = useCallback(async (email, password) => {
    const { data } = await api.post('/auth/login', { email, password });
    if (!data?.token) {
      throw new Error('The server did not return a session token.');
    }
    encryptedStorage.setItem(AUTH_STORAGE_KEY, data);
    setUser(data);
    return data;
  }, []);

  const register = useCallback(async (name, email, password) => {
    const { data } = await api.post('/auth/register', { name, email, password });
    if (data?.token) {
      encryptedStorage.setItem(AUTH_STORAGE_KEY, data);
      setUser(data);
    }
    return data;
  }, []);

  const logout = useCallback(() => {
    // Only remove the user auth token; preserve app-wide settings
    // (forecast horizon, waterbody profiles, access settings, drafts, etc.)
    // so they survive across logout/login cycles.
    encryptedStorage.removeItem(AUTH_STORAGE_KEY);
    setUser(null);
  }, []);

  // A new context value object on every render forced every consumer to
  // re-render even when the session was unchanged.
  const value = useMemo(
    () => ({ user, login, register, logout }),
    [user, login, register, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export default AuthProvider;
