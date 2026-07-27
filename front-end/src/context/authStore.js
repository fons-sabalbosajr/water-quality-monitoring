import { createContext, useContext } from 'react';

/**
 * Auth context object and consumer hook.
 *
 * These deliberately live in a module that exports **no components**.
 *
 * When `createContext()` sits in the same file as `<AuthProvider>`, React Fast
 * Refresh hot-swaps that file on edit and re-runs the module body — producing a
 * *new* context object. The already-mounted provider keeps publishing to the old
 * object while `useContext` now reads the new one, so every consumer silently
 * falls back to the default value. That is what produced
 * "useAuth must be used inside an <AuthProvider>" on a correctly nested tree.
 *
 * A module with only non-component exports is not hot-swapped in isolation, so
 * this context object keeps a stable identity for the life of the session. The
 * `react-refresh/only-export-components` lint rule exists to enforce exactly
 * this split; it was previously disabled in the provider file.
 */
export const AuthContext = createContext(null);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === null) {
    throw new Error('useAuth must be used inside an <AuthProvider>.');
  }
  return context;
};

export const AUTH_STORAGE_KEY = 'wqm_user';
