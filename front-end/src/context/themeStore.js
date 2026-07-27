import { createContext, useContext } from 'react';

/**
 * Theme context object and consumer hook — kept in a component-free module for
 * the same Fast Refresh reason documented in `authStore.js`: a `createContext()`
 * call that shares a file with its provider gets a new identity on every hot
 * swap, silently detaching every consumer from the mounted provider.
 */
export const ThemeContext = createContext(null);

export const THEME_STORAGE_KEY = 'wqm_theme';
export const VALID_THEMES = ['light', 'dark'];

/**
 * Falls back to the light theme rather than throwing.
 *
 * Unlike auth, a missing theme is not a correctness problem — several consumers
 * (charts, the Cesium map) can legitimately render before/outside the provider,
 * and crashing the page over a colour token would be worse than defaulting.
 */
export const useTheme = () => useContext(ThemeContext) || { theme: 'light', toggle: () => {} };
