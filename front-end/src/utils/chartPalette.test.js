import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CHART_SERIES_COLORS,
  DARK_CHART_THEME,
  LIGHT_CHART_THEME,
  contrastRatio,
  getChartTheme,
  parseHex,
  relativeLuminance,
} from './chartPalette.js';

// The card background each theme's charts are drawn on (--bg-card).
const LIGHT_SURFACE = '#ffffff';
const DARK_SURFACE = '#1e293b';

// WCAG 2.1 minimum for non-text graphical objects such as a chart line.
const MIN_GRAPHIC_CONTRAST = 3;

test('getChartTheme selects the palette by theme name', () => {
  assert.equal(getChartTheme('dark'), DARK_CHART_THEME);
  assert.equal(getChartTheme('light'), LIGHT_CHART_THEME);
  // Anything unrecognised must fall back to light, never to undefined.
  assert.equal(getChartTheme(undefined), LIGHT_CHART_THEME);
  assert.equal(getChartTheme(null), LIGHT_CHART_THEME);
  assert.equal(getChartTheme('sepia'), LIGHT_CHART_THEME);
});

/**
 * Regression: the scatter regression line was hard-coded to #101F43, a
 * near-black that is invisible on the #1e293b dark card.
 */
test('the dark-theme regression line is light, not dark', () => {
  const darkLine = relativeLuminance(DARK_CHART_THEME.line);
  const lightLine = relativeLuminance(LIGHT_CHART_THEME.line);
  assert.ok(darkLine > 0.5, `dark line should be light (luminance ${darkLine})`);
  assert.ok(lightLine < 0.5, `light line should be dark (luminance ${lightLine})`);
  // The two themes must not resolve to the same colour.
  assert.notEqual(DARK_CHART_THEME.line, LIGHT_CHART_THEME.line);
  // Specifically: it must no longer be the old hard-coded value.
  assert.notEqual(DARK_CHART_THEME.line.toLowerCase(), '#101f43');
});

test('the regression line clears the WCAG graphic contrast minimum on both surfaces', () => {
  const darkOnDark = contrastRatio(DARK_CHART_THEME.line, DARK_SURFACE);
  const lightOnLight = contrastRatio(LIGHT_CHART_THEME.line, LIGHT_SURFACE);
  assert.ok(
    darkOnDark >= MIN_GRAPHIC_CONTRAST,
    `dark line vs dark card is ${darkOnDark?.toFixed(2)}:1, need >= ${MIN_GRAPHIC_CONTRAST}:1`,
  );
  assert.ok(
    lightOnLight >= MIN_GRAPHIC_CONTRAST,
    `light line vs light card is ${lightOnLight?.toFixed(2)}:1, need >= ${MIN_GRAPHIC_CONTRAST}:1`,
  );
  // The old value on the dark card is what this guards against.
  assert.ok(contrastRatio('#101F43', DARK_SURFACE) < MIN_GRAPHIC_CONTRAST);
});

test('axis and text colours stay readable on their own surface', () => {
  for (const [name, theme, surface] of [
    ['light', LIGHT_CHART_THEME, LIGHT_SURFACE],
    ['dark', DARK_CHART_THEME, DARK_SURFACE],
  ]) {
    const axis = contrastRatio(theme.axis, surface);
    assert.ok(axis >= MIN_GRAPHIC_CONTRAST, `${name} axis contrast ${axis?.toFixed(2)}:1`);
    const text = contrastRatio(theme.text, surface);
    assert.ok(text >= 4.5, `${name} text contrast ${text?.toFixed(2)}:1 (need 4.5:1)`);
  }
});

test('both palettes expose the same token set', () => {
  assert.deepEqual(
    Object.keys(LIGHT_CHART_THEME).sort(),
    Object.keys(DARK_CHART_THEME).sort(),
    'a token present in one theme but not the other renders as undefined',
  );
  for (const [key, value] of Object.entries(DARK_CHART_THEME)) {
    assert.ok(value, `dark token "${key}" must not be empty`);
  }
});

test('series colours are valid and distinct', () => {
  assert.ok(CHART_SERIES_COLORS.length >= 8);
  CHART_SERIES_COLORS.forEach((color) => {
    assert.ok(parseHex(color), `"${color}" is not a valid hex colour`);
  });
  assert.equal(
    new Set(CHART_SERIES_COLORS).size,
    CHART_SERIES_COLORS.length,
    'duplicate series colours make two stations indistinguishable',
  );
});

test('colour helpers handle malformed input without throwing', () => {
  assert.deepEqual(parseHex('#fff'), [255, 255, 255]);
  assert.deepEqual(parseHex('000000'), [0, 0, 0]);
  assert.equal(parseHex('rgb(0,0,0)'), null);
  assert.equal(parseHex(''), null);
  assert.equal(parseHex(null), null);
  assert.equal(relativeLuminance('nope'), null);
  assert.equal(contrastRatio('#fff', 'nope'), null);
  // Sanity anchors.
  assert.equal(Math.round(contrastRatio('#000000', '#ffffff')), 21);
  assert.equal(Math.round(contrastRatio('#ffffff', '#ffffff')), 1);
});
