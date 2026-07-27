import test from 'node:test';
import assert from 'node:assert/strict';

/**
 * forecastSettings persists through encryptedStorage, which needs a browser
 * environment. These shims are installed before the module is imported so the
 * *real* encryption path is exercised rather than a stub — the horizon bug
 * class lives in the round-trip, not in the arithmetic.
 */
class MemoryStorage {
  constructor() { this.map = new Map(); }
  getItem(key) { return this.map.has(key) ? this.map.get(key) : null; }
  setItem(key, value) { this.map.set(key, String(value)); }
  removeItem(key) { this.map.delete(key); }
  clear() { this.map.clear(); }
  get length() { return this.map.size; }
}

const listeners = {};
globalThis.localStorage = new MemoryStorage();
globalThis.sessionStorage = new MemoryStorage();
globalThis.window = {
  location: { origin: 'http://localhost:5173' },
  addEventListener: (type, fn) => { (listeners[type] ||= []).push(fn); },
  removeEventListener: (type, fn) => {
    listeners[type] = (listeners[type] || []).filter((l) => l !== fn);
  },
  dispatchEvent: (event) => {
    (listeners[event.type] || []).forEach((fn) => fn(event));
    return true;
  },
};
globalThis.CustomEvent = class {
  constructor(type, init) { this.type = type; this.detail = init?.detail; }
};

const {
  FORECAST_EVENT,
  clampForecastMonths,
  getForecastMonths,
  setForecastMonths,
} = await import('./forecastSettings.js');

test('clampForecastMonths keeps the horizon inside 1..3', () => {
  assert.equal(clampForecastMonths(1), 1);
  assert.equal(clampForecastMonths(2), 2);
  assert.equal(clampForecastMonths(3), 3);
  // Out of range, non-numeric and missing values fall back to the 3-month default.
  for (const bad of [0, -1, 4, 99, 'x', '', null, undefined, NaN, Infinity, {}]) {
    assert.equal(clampForecastMonths(bad), 3, `clamp(${JSON.stringify(bad)})`);
  }
});

test('clampForecastMonths accepts numeric strings and rounds fractions', () => {
  assert.equal(clampForecastMonths('1'), 1);
  assert.equal(clampForecastMonths('2'), 2);
  assert.equal(clampForecastMonths(1.4), 1);
  assert.equal(clampForecastMonths(1.6), 2);
});

test('defaults to 3 months when nothing has been stored', () => {
  globalThis.localStorage.clear();
  assert.equal(getForecastMonths(), 3);
});

/**
 * Regression guard for "set the horizon to 1 month, the view still shows 3":
 * whatever is written must read back identically, including through the
 * encrypted storage layer.
 */
test('every horizon survives the encrypted storage round-trip', () => {
  for (const months of [1, 2, 3]) {
    const written = setForecastMonths(months);
    assert.equal(written, months);
    assert.equal(getForecastMonths(), months, `horizon ${months} did not read back`);
  }
});

test('setForecastMonths normalises before storing so a bad value cannot stick', () => {
  assert.equal(setForecastMonths(9), 3);
  assert.equal(getForecastMonths(), 3);
  assert.equal(setForecastMonths('1'), 1);
  assert.equal(getForecastMonths(), 1);
});

test('setForecastMonths broadcasts the clamped value so every view can sync', () => {
  const seen = [];
  const handler = (event) => seen.push(event.detail);
  globalThis.window.addEventListener(FORECAST_EVENT, handler);

  setForecastMonths(1);
  setForecastMonths(2);
  // An out-of-range request must broadcast the clamped value, not the raw input.
  setForecastMonths(42);

  globalThis.window.removeEventListener(FORECAST_EVENT, handler);
  assert.deepEqual(seen, [1, 2, 3]);
});

test('the stored value is encrypted, not written in the clear', () => {
  setForecastMonths(1);
  const raw = [...globalThis.localStorage.map.values()].join('|');
  assert.ok(raw.length > 0, 'something should have been written');
  assert.ok(
    !/(^|\|)"?1"?(\||$)/.test(raw),
    'the horizon should not be recoverable as plain text',
  );
});
