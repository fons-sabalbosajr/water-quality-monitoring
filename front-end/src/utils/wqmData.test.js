import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getParamData,
  getStations,
  getAvailableParams,
  hasNumericReading,
  normalizeParamName,
  toNumber,
  OBSERVATION_PARAM,
} from './wqmData.js';

/**
 * These cover the hot-path helpers that were rewritten to use memoisation
 * (normalizeParamName) and per-object index caches (getParamData, getStations).
 * The point is to prove the caches did not change observable behaviour.
 */

const station = (overrides = {}) => ({
  stnNo: 1,
  stnId: 'Station 1',
  address: 'Bocaue',
  params: {
    // Deliberately mixed-case/spaced headings, as they appear in the workbooks.
    'BOD, mg/L': { monthly: [5.1, null, 6.2], avg: 5.65 },
    ' PH ': { monthly: [7.1], avg: 7.1 },
  },
  ...overrides,
});

test('normalizeParamName maps spreadsheet heading variants onto canonical names', () => {
  assert.equal(normalizeParamName('TEMPERATURE'), 'Temp. (°C)');
  assert.equal(normalizeParamName('temp'), 'Temp. (°C)');
  assert.equal(normalizeParamName('BOD, mg/L'), 'BOD (mg/L)');
  assert.equal(normalizeParamName('Fecal Coliform'), 'Fecal Coliform (MPN/100mL)');
  assert.equal(normalizeParamName('nitrate'), 'NO3-N (mg/L)');
  assert.equal(normalizeParamName('phosphate'), 'PO4-P (mg/L)');
  assert.equal(normalizeParamName('pH'), 'pH');
  assert.equal(normalizeParamName('Observations'), OBSERVATION_PARAM);
  assert.equal(normalizeParamName('OBSERBATION'), OBSERVATION_PARAM);
});

test('normalizeParamName discards non-parameter columns and blanks', () => {
  assert.equal(normalizeParamName('Province'), null);
  assert.equal(normalizeParamName('Date of Sampling'), null);
  assert.equal(normalizeParamName(''), null);
  assert.equal(normalizeParamName('   '), null);
  assert.equal(normalizeParamName(null), null);
  assert.equal(normalizeParamName(undefined), null);
});

test('normalizeParamName is stable across repeated calls (memoisation is transparent)', () => {
  // A wrong cache would return a stale value on the second call.
  for (const input of ['temp', 'TEMPERATURE', 'temp', 'pH', 'temp']) {
    assert.equal(normalizeParamName(input), normalizeParamName(input));
  }
  assert.equal(normalizeParamName('temp'), 'Temp. (°C)');
  assert.equal(normalizeParamName('pH'), 'pH');
});

test('getParamData resolves a display name to the underlying reading block', () => {
  const s = station();
  // The stored key is "BOD, mg/L"; the UI asks for the canonical display name.
  const data = getParamData(s, 'BOD (mg/L)');
  assert.ok(data, 'expected the BOD block to resolve from the "BOD, mg/L" key');
  assert.deepEqual(data.monthly, [5.1, null, 6.2]);
  // Repeat reads must come back identical, not stale or undefined.
  assert.equal(getParamData(s, 'BOD (mg/L)'), data);
  // Whitespace/casing differences in the stored key must still resolve.
  assert.equal(getParamData(s, 'pH').avg, 7.1);
});

test('getParamData returns null for unknown params and bad input', () => {
  const s = station();
  assert.equal(getParamData(s, 'TSS (mg/L)'), null);
  assert.equal(getParamData(s, 'Province'), null);
  assert.equal(getParamData(s, ''), null);
  assert.equal(getParamData(null, 'pH'), null);
  assert.equal(getParamData(undefined, 'pH'), null);
});

test('getParamData indexes each station separately', () => {
  // The index is keyed by station object; a shared cache would leak values
  // from one station into another.
  const a = station();
  const b = station({ params: { pH: { monthly: [8.4], avg: 8.4 } } });
  assert.equal(getParamData(a, 'pH').avg, 7.1);
  assert.equal(getParamData(b, 'pH').avg, 8.4);
  assert.equal(getParamData(b, 'BOD (mg/L)'), null);
});

test('getStations filters out non-station rows and returns a stable reference', () => {
  const sheet = {
    stations: [
      station(),
      { stnNo: 'not-a-number', stnId: 'X', params: {} },
      { stnNo: 2, stnId: '', params: {} },
      { stnNo: 3, stnId: 'Station 3', params: null },
      station({ stnNo: 4, stnId: 'Station 4' }),
    ],
  };
  const first = getStations(sheet);
  assert.equal(first.length, 2);
  assert.deepEqual(first.map((s) => s.stnId), ['Station 1', 'Station 4']);
  // Stable identity is what lets downstream useMemo comparisons hit.
  assert.equal(getStations(sheet), first);
});

test('getStations tolerates missing input', () => {
  assert.deepEqual(getStations(null), []);
  assert.deepEqual(getStations(undefined), []);
  assert.deepEqual(getStations({}), []);
});

test('getAvailableParams orders known params and appends observations only when asked', () => {
  // PARAM_ORDER puts BOD before pH regardless of the key order in the sheet.
  const stations = [station()];
  assert.deepEqual(getAvailableParams(stations, false), ['BOD (mg/L)', 'pH']);

  const withObservation = [station({
    params: { ...station().params, Observation: { monthly: ['high tide'] } },
  })];
  // Observations are never charted, so they stay out unless explicitly asked for.
  assert.deepEqual(getAvailableParams(withObservation, false), ['BOD (mg/L)', 'pH']);
  assert.deepEqual(
    getAvailableParams(withObservation, true),
    ['BOD (mg/L)', 'pH', OBSERVATION_PARAM],
  );
});

test('hasNumericReading ignores observation-only stations', () => {
  assert.equal(hasNumericReading(station()), true);
  assert.equal(
    hasNumericReading({ params: { Observation: { monthly: ['clear'], avg: null } } }),
    false,
  );
  assert.equal(hasNumericReading({ params: { pH: { monthly: [], avg: null } } }), false);
  assert.equal(hasNumericReading({}), false);
});

test('toNumber extracts the numeric part of censored readings', () => {
  // Values like "<5" carry the detection limit and must still count.
  assert.equal(toNumber('<5'), 5);
  assert.equal(toNumber('1,200'), 1);
  assert.equal(toNumber('7.25'), 7.25);
  assert.equal(toNumber(3), 3);
  assert.equal(toNumber('*'), null);
  assert.equal(toNumber('N/A'), null);
  assert.equal(toNumber(''), null);
  assert.equal(toNumber(NaN), null);
  assert.equal(toNumber(null), null);
});
