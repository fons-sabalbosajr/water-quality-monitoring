/**
 * Raw chart colour tokens.
 *
 * Kept free of React imports so the contrast guarantees can be unit tested —
 * `chartTheme.js` layers the `useChartTheme()` hook on top of this.
 *
 * Recharts sets `stroke`/`fill` as SVG *presentation attributes*, which ignore
 * `var(--token)`. Chart colours therefore have to be resolved in JS rather than
 * in the stylesheet.
 */

export const LIGHT_CHART_THEME = {
  axis: '#64748b',
  grid: '#E2E8F6',
  // High-contrast line for regression/reference/trend overlays drawn on top of
  // the series colours.
  line: '#101F43',
  lineSoft: 'rgba(16, 31, 67, 0.45)',
  tooltipBg: '#ffffff',
  tooltipBorder: '#D6DBF6',
  text: '#101F43',
  textMuted: '#64748b',
  surface: '#ffffff',
};

export const DARK_CHART_THEME = {
  axis: '#94a3b8',
  grid: '#2d4a6a',
  // Must stay light: the previous hard-coded #101F43 was drawn on the #1e293b
  // dark card and was effectively invisible.
  line: '#e2e8f0',
  lineSoft: 'rgba(226, 232, 240, 0.55)',
  tooltipBg: '#1e293b',
  tooltipBorder: '#2d4a6a',
  text: '#e2e8f0',
  textMuted: '#94a3b8',
  surface: '#1e293b',
};

// Series palette is shared: these hues carry enough contrast on both
// backgrounds, so only the structural colours flip with the theme.
export const CHART_SERIES_COLORS = [
  '#446ACB', '#7CB675', '#e07b54', '#a78bfa', '#f59e0b',
  '#06b6d4', '#ec4899', '#84cc16', '#f97316', '#64748b', '#10b981',
];

export const getChartTheme = (theme) =>
  (theme === 'dark' ? DARK_CHART_THEME : LIGHT_CHART_THEME);

/** Parse #rgb / #rrggbb into [r, g, b]; returns null for anything else. */
export const parseHex = (hex) => {
  const value = String(hex || '').trim().replace(/^#/, '');
  const full = value.length === 3
    ? value.split('').map((c) => c + c).join('')
    : value;
  if (!/^[0-9a-f]{6}$/i.test(full)) return null;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
};

/** WCAG relative luminance, 0 (black) to 1 (white). */
export const relativeLuminance = (hex) => {
  const rgb = parseHex(hex);
  if (!rgb) return null;
  const [r, g, b] = rgb.map((channel) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return (0.2126 * r) + (0.7152 * g) + (0.0722 * b);
};

/** WCAG contrast ratio between two hex colours, 1 to 21. */
export const contrastRatio = (a, b) => {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  if (la === null || lb === null) return null;
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
};
