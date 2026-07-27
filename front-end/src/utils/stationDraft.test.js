import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyDraftParamValue,
  applyDraftSamplingDate,
  buildStationDraft,
  computeAnnualAverage,
  normalizeMonthly,
  parseEditableValue,
} from './stationDraft.js';

const station = () => ({
  stnNo: 3,
  stnId: 'Station 3',
  address: 'Bocaue',
  classInfo: 'C',
  params: {
    'BOD, mg/L': { monthly: [4, 6, null], avg: 5 },
  },
});

test('buildStationDraft creates a block for every requested parameter', () => {
  const draft = buildStationDraft(station(), ['BOD (mg/L)', 'pH'], 'C');
  assert.deepEqual(Object.keys(draft.params), ['BOD (mg/L)', 'pH']);
  assert.equal(draft.params['BOD (mg/L)'].monthly.length, 12);
  // A parameter the station has no data for still gets an editable 12-slot row.
  assert.equal(draft.params.pH.monthly.length, 12);
  assert.equal(draft.params.pH.avg, '');
  assert.equal(draft.stnId, 'Station 3');
  assert.equal(draft.classInfo, 'C');
});

test('buildStationDraft tolerates a null station and an empty param list', () => {
  const blank = buildStationDraft(null, [], 'SB');
  assert.deepEqual(blank.params, {});
  assert.equal(blank.classInfo, 'SB');
  assert.equal(blank.samplingDates.length, 12);
  assert.doesNotThrow(() => buildStationDraft(null, undefined));
});

/**
 * Regression: "Cannot read properties of undefined (reading 'monthly')".
 *
 * The modal's cell renderers read `draft.params?.[param]?.monthly` with
 * optional chaining, so a parameter missing from the draft still renders an
 * editable input. The writer previously assumed the block existed and threw on
 * the first keystroke. Reader and writer must tolerate the same case.
 */
test('applyDraftParamValue creates a parameter block that does not exist yet', () => {
  const draft = buildStationDraft(station(), [], '');
  assert.deepEqual(draft.params, {}, 'precondition: draft has no parameters');

  let next;
  assert.doesNotThrow(() => {
    next = applyDraftParamValue(draft, 'DO (mg/L)', '7.4', 0);
  });
  assert.ok(next.params['DO (mg/L)'], 'the missing block should be created');
  assert.equal(next.params['DO (mg/L)'].monthly[0], '7.4');
  assert.equal(next.params['DO (mg/L)'].monthly.length, 12);
  assert.equal(next.params['DO (mg/L)'].avg, 7.4);
});

test('applyDraftParamValue survives a draft with a missing or malformed params object', () => {
  assert.doesNotThrow(() => applyDraftParamValue({ stnId: 'X' }, 'pH', '7', 0));
  assert.doesNotThrow(() => applyDraftParamValue({ params: null }, 'pH', '7', 0));
  assert.doesNotThrow(() => applyDraftParamValue({ params: [] }, 'pH', '7', 0));
  // A block whose monthly series is not an array must be repaired, not indexed.
  const repaired = applyDraftParamValue({ params: { pH: { monthly: 'oops' } } }, 'pH', '7', 1);
  assert.ok(Array.isArray(repaired.params.pH.monthly));
  assert.equal(repaired.params.pH.monthly[1], '7');
});

test('applyDraftParamValue returns the input unchanged for a null draft or param', () => {
  assert.equal(applyDraftParamValue(null, 'pH', '7', 0), null);
  assert.equal(applyDraftParamValue(undefined, 'pH', '7', 0), undefined);
  const draft = buildStationDraft(station(), ['pH'], '');
  assert.equal(applyDraftParamValue(draft, '', '7', 0), draft);
});

test('applyDraftParamValue does not mutate the draft it was given', () => {
  const draft = buildStationDraft(station(), ['pH'], '');
  const next = applyDraftParamValue(draft, 'pH', '8.1', 2);
  assert.equal(draft.params.pH.monthly[2], '', 'original must be untouched');
  assert.equal(next.params.pH.monthly[2], '8.1');
  assert.notEqual(next, draft);
});

test('applyDraftParamValue ignores an out-of-range or non-integer month index', () => {
  const draft = buildStationDraft(station(), ['pH'], '');
  for (const bad of [-1, 12, 99, null, undefined, 1.5, '3']) {
    const next = applyDraftParamValue(draft, 'pH', '9', bad);
    assert.equal(next.params.pH.monthly.length, 12);
    assert.ok(
      next.params.pH.monthly.every((v) => v === ''),
      `month index ${bad} should not have written a value`,
    );
  }
});

test('applyDraftParamValue recomputes the annual average, including censored values', () => {
  let draft = buildStationDraft(station(), ['BOD (mg/L)'], '');
  draft = applyDraftParamValue(draft, 'BOD (mg/L)', '10', 0);
  draft = applyDraftParamValue(draft, 'BOD (mg/L)', '20', 1);
  assert.equal(draft.params['BOD (mg/L)'].avg, 15);
  // "<5" carries the detection limit and must still count toward the average.
  draft = applyDraftParamValue(draft, 'BOD (mg/L)', '<5', 2);
  assert.equal(draft.params['BOD (mg/L)'].avg, Number(((10 + 20 + 5) / 3).toFixed(4)));
});

test('applyDraftParamValue clears the average when every month is emptied', () => {
  let draft = buildStationDraft(station(), ['pH'], '');
  draft = applyDraftParamValue(draft, 'pH', '7', 0);
  assert.equal(draft.params.pH.avg, 7);
  draft = applyDraftParamValue(draft, 'pH', '', 0);
  assert.equal(draft.params.pH.avg, '');
});

test('applyDraftSamplingDate writes a date without touching parameters', () => {
  const draft = buildStationDraft(station(), ['pH'], '');
  const next = applyDraftSamplingDate(draft, 4, '05/12/2026');
  assert.equal(next.samplingDates[4], '05/12/2026');
  assert.equal(draft.samplingDates[4], '', 'original must be untouched');
  assert.deepEqual(next.params, draft.params);

  const repaired = applyDraftSamplingDate({ samplingDates: 'nope' }, 0, '01/01/2026');
  assert.ok(Array.isArray(repaired.samplingDates));
  assert.equal(repaired.samplingDates[0], '01/01/2026');
  assert.equal(applyDraftSamplingDate(null, 0, 'x'), null);
});

test('normalizeMonthly always yields exactly 12 slots', () => {
  assert.equal(normalizeMonthly([]).length, 12);
  assert.equal(normalizeMonthly([1, 2, 3]).length, 12);
  assert.equal(normalizeMonthly(Array(20).fill(1)).length, 12);
  assert.equal(normalizeMonthly(undefined).length, 12);
  assert.deepEqual(normalizeMonthly([1, 2]).slice(0, 3), [1, 2, null]);
});

test('computeAnnualAverage ignores blanks and non-numeric markers', () => {
  assert.equal(computeAnnualAverage([]), null);
  assert.equal(computeAnnualAverage(['', null, '*']), null);
  assert.equal(computeAnnualAverage([2, 4]), 3);
  assert.equal(computeAnnualAverage([2, '', 4, '*']), 3);
});

test('parseEditableValue maps editor text onto stored values', () => {
  assert.equal(parseEditableValue(''), null);
  assert.equal(parseEditableValue('  '), null);
  assert.equal(parseEditableValue('-'), null);
  assert.equal(parseEditableValue('—'), null);
  assert.equal(parseEditableValue('*'), '*');
  assert.equal(parseEditableValue('<5'), '<5', 'censored values keep their sign');
  assert.equal(parseEditableValue('7.25'), 7.25);
  assert.equal(parseEditableValue('1,200'), 1200);
  assert.equal(parseEditableValue('clear water'), 'clear water');
});
