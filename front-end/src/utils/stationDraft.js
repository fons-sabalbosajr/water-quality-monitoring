// Explicit .js extension: Vite resolves extensionless specifiers, but Node's
// ESM loader does not, and this module is covered by `npm test`.
import { getParamData, toNumber } from './wqmData.js';

/**
 * Pure helpers backing the WQM station editor modal.
 *
 * These live outside the component so they can be unit tested: the crash they
 * guard against (writing to a parameter block the draft does not have) is a
 * one-line mistake that is otherwise only reachable through the UI.
 */

const MONTH_COUNT = 12;

const clone = (value) => JSON.parse(JSON.stringify(value));

export const normalizeMonthly = (monthly = []) =>
  Array.from({ length: MONTH_COUNT }, (_, index) => monthly?.[index] ?? null);

const blankMonthly = () => Array.from({ length: MONTH_COUNT }, () => '');

export const computeAnnualAverage = (monthly = []) => {
  // Censored readings such as "<5" or ">100" are still counted in the annual
  // average using their numeric portion (the detection/quantitation limit).
  // toNumber() extracts that number, so values carrying a "<" sign are included.
  const values = normalizeMonthly(monthly).map(toNumber).filter((value) => value !== null);
  if (!values.length) return null;
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(4));
};

export const parseEditableValue = (value) => {
  const cleaned = String(value ?? '').trim();
  if (!cleaned || cleaned === '-' || cleaned === '—') return null;
  if (cleaned === '*') return '*';
  if (/^</.test(cleaned)) return cleaned;
  const numeric = Number(cleaned.replace(/,/g, ''));
  return Number.isFinite(numeric) ? numeric : cleaned;
};

export const buildStationDraft = (station, params = [], defaultClass = '') => ({
  stnNo: station?.stnNo ?? '',
  stnId: station?.stnId ?? '',
  address: station?.address ?? '',
  classInfo: station?.classInfo ?? defaultClass ?? '',
  samplingDates: normalizeMonthly(station?.samplingDates).map((value) => value ?? ''),
  params: Object.fromEntries((params || []).map((param) => {
    const data = station ? getParamData(station, param) : null;
    return [param, {
      monthly: normalizeMonthly(data?.monthly).map((value) => value ?? ''),
      avg: computeAnnualAverage(data?.monthly) ?? data?.avg ?? '',
    }];
  })),
});

/**
 * Write one monthly reading into a draft and recompute that parameter's annual
 * average. Returns a new draft; the input is not mutated.
 *
 * The parameter block is created on demand. The modal's row renderers read
 * `draft.params?.[param]?.monthly` with optional chaining, so a parameter the
 * draft does not know about still renders an editable input — the writer has to
 * tolerate exactly the same case or the first keystroke throws
 * "Cannot read properties of undefined (reading 'monthly')".
 */
export const applyDraftParamValue = (draft, param, value, monthIndex) => {
  if (!draft || !param) return draft;
  const next = clone(draft);
  if (!next.params || typeof next.params !== 'object' || Array.isArray(next.params)) {
    next.params = {};
  }
  if (!next.params[param] || typeof next.params[param] !== 'object') {
    next.params[param] = { monthly: blankMonthly(), avg: '' };
  }
  if (!Array.isArray(next.params[param].monthly)) {
    next.params[param].monthly = blankMonthly();
  }
  if (Number.isInteger(monthIndex) && monthIndex >= 0 && monthIndex < MONTH_COUNT) {
    next.params[param].monthly[monthIndex] = value;
  }
  next.params[param].avg = computeAnnualAverage(next.params[param].monthly) ?? '';
  return next;
};

export const applyDraftSamplingDate = (draft, monthIndex, value) => {
  if (!draft) return draft;
  const next = clone(draft);
  if (!Array.isArray(next.samplingDates)) next.samplingDates = normalizeMonthly([]);
  if (Number.isInteger(monthIndex) && monthIndex >= 0 && monthIndex < MONTH_COUNT) {
    next.samplingDates[monthIndex] = value;
  }
  return next;
};
