import { useCallback, useEffect, useMemo, useState } from 'react';
import encryptedStorage from '../utils/encryptedStorage';
import { THEME_STORAGE_KEY, ThemeContext, VALID_THEMES } from './themeStore.js';

/**
 * Theme provider. The context object and `useTheme` live in `themeStore.js` so
 * this file exports only a component — see that file for why.
 */
export const ThemeProvider = ({ children }) => {
  const [theme, setTheme] = useState(() => {
    // encryptAllExisting() now runs once at AuthContext module load; calling it
    // here too meant the migration ran twice on every startup.
    const stored = encryptedStorage.getItem(THEME_STORAGE_KEY);
    return VALID_THEMES.includes(stored) ? stored : 'light';
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    // Lets the browser render native form controls and scrollbars in the
    // matching scheme instead of always-light chrome inside a dark page.
    document.documentElement.style.colorScheme = theme;
    encryptedStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  const toggle = useCallback(() => {
    setTheme((t) => (t === 'light' ? 'dark' : 'light'));
  }, []);

  const value = useMemo(() => ({ theme, toggle }), [theme, toggle]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

export default ThemeProvider;
