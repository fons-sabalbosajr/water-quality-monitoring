import { useMemo } from 'react';
import { useTheme } from '../context/themeStore';
import { CHART_SERIES_COLORS, getChartTheme } from './chartPalette.js';

/**
 * Theme-aware chart tokens.
 *
 * Recharts sets `stroke`/`fill` as SVG *presentation attributes*, which do not
 * accept `var(--token)` — a CSS custom property there is ignored and the
 * element falls back to its default paint. Chart colours therefore have to be
 * resolved in JS rather than in the stylesheet, which is why this hook exists
 * instead of a CSS rule.
 *
 * Several charts had hard-coded light-theme colours (the scatter regression
 * line was `#101F43`, near-black, drawn on a `#1e293b` dark card — effectively
 * invisible). Use these tokens for any axis, grid, reference or trend line so
 * every chart stays readable in both themes.
 *
 * Raw values and the contrast helpers live in `chartPalette.js` so they can be
 * unit tested without React.
 */
export { CHART_SERIES_COLORS, getChartTheme } from './chartPalette.js';

export const useChartTheme = () => {
  const { theme } = useTheme();

  return useMemo(() => {
    const tokens = getChartTheme(theme);
    return {
      ...tokens,
      isDark: theme === 'dark',
      series: CHART_SERIES_COLORS,
      // Ready-made props so call sites stay short and consistent.
      tick: { fontSize: 10, fill: tokens.axis },
      tickSm: { fontSize: 11, fill: tokens.axis },
      axisLine: { stroke: tokens.grid },
      tooltip: {
        contentStyle: {
          fontSize: 12,
          borderRadius: 8,
          background: tokens.tooltipBg,
          border: `1px solid ${tokens.tooltipBorder}`,
          color: tokens.text,
        },
        labelStyle: { color: tokens.text },
        itemStyle: { color: tokens.text },
      },
      legend: { fontSize: '0.68rem', color: tokens.textMuted },
    };
  }, [theme]);
};

export default useChartTheme;
