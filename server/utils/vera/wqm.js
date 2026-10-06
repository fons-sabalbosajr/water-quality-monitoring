// WQM data helpers for VERA. Every rule here mirrors the front-end so VERA's
// numbers match what the dashboards show:
//   • normalizeParamName / toNumber / PARAM_LIMITS  ← front-end/src/utils/wqmData.js
//   • buildTechnicalForecast / buildProphetForecast ← front-end/src/pages/Visualizations.jsx
//   • clampForecastValue                            ← same file
// If one side changes, change the other — tests/veraWqm.test.js pins the shared
// behaviour.

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const OBSERVATION_PARAM = 'Observation';

const PARAM_ORDER = [
  'DO (mg/L)', 'BOD (mg/L)', 'TSS (mg/L)', 'pH',
  'Temp. (°C)', 'Color (TCU)', 'Fecal Coliform (MPN/100mL)',
  'NO3-N (mg/L)', 'PO4-P (mg/L)', 'Cl- (mg/L)', 'Oil and Grease',
];

const PARAM_LIMITS = {
  'DO (mg/L)': { min: 5, unit: 'mg/L' },
  'BOD (mg/L)': { max: 7, unit: 'mg/L' },
  'TSS (mg/L)': { max: 80, unit: 'mg/L' },
  pH: { min: 6.5, max: 8.5, unit: '' },
  'Temp. (°C)': { max: 35, unit: '°C' },
  'Color (TCU)': { max: 50, unit: 'TCU' },
  'Fecal Coliform (MPN/100mL)': { max: 1000, unit: 'MPN/100mL' },
  'NO3-N (mg/L)': { max: 10, unit: 'mg/L' },
  'PO4-P (mg/L)': { max: 0.5, unit: 'mg/L' },
  'Cl- (mg/L)': { max: 250, unit: 'mg/L' },
  'Oil and Grease': { max: 2, unit: 'mg/L' },
};

// Everyday names people type → canonical parameter.
const PARAM_ALIASES = [
  [/\b(do|dissolved\s+oxygen|oxygen)\b/i, 'DO (mg/L)'],
  [/\b(bod|biochemical\s+oxygen)/i, 'BOD (mg/L)'],
  [/\b(tss|suspended\s+solids?)\b/i, 'TSS (mg/L)'],
  [/\bph\b|\bacidity\b/i, 'pH'],
  [/\btemp(erature)?\b/i, 'Temp. (°C)'],
  [/\bcolou?r\b/i, 'Color (TCU)'],
  [/\b(fecal|faecal|coliform|bacteria)/i, 'Fecal Coliform (MPN/100mL)'],
  [/\b(no3|nitrate)/i, 'NO3-N (mg/L)'],
  [/\b(po4|phosphate)/i, 'PO4-P (mg/L)'],
  [/\b(chloride|cl-?)\b/i, 'Cl- (mg/L)'],
  [/\boil\b|\bgrease\b/i, 'Oil and Grease'],
];

const normalizeParamName = (param) => {
  const raw = String(param || '').trim();
  const key = raw.toLowerCase().replace(/\s+/g, ' ');
  if (!raw) return null;
  if (key.includes('observ') || key.includes('obserb')) return OBSERVATION_PARAM;
  if (key.startsWith('temp')) return 'Temp. (°C)';
  if (key.includes('bod')) return 'BOD (mg/L)';
  if (key.includes('oil')) return 'Oil and Grease';
  if (key.includes('fecal')) return 'Fecal Coliform (MPN/100mL)';
  if (key.includes('no3') || key.includes('nitrate')) return 'NO3-N (mg/L)';
  if (key.includes('po4') || key.includes('phosphate')) return 'PO4-P (mg/L)';
  if (key.includes('chloride') || key === 'cl' || key.startsWith('cl-')) return 'Cl- (mg/L)';
  if (key.includes('tss')) return 'TSS (mg/L)';
  if (key === 'ph') return 'pH';
  if (key.includes('color')) return 'Color (TCU)';
  if (key.includes('province') || key.includes('analysis') || key.includes('date of sampling')) return null;
  return raw;
};

/**
 * Resolve free text ("dissolved oxygen", "BOD") to a canonical parameter.
 * Deliberately NOT normalizeParamName: that matches substrings, which is right
 * for workbook headers but turns "waterbody" into BOD in a sentence.
 */
const resolveParam = (text) => {
  if (!text) return null;
  const value = String(text).trim();
  const exact = [...PARAM_ORDER, OBSERVATION_PARAM].find((p) => p.toLowerCase() === value.toLowerCase());
  if (exact) return exact;
  const hit = PARAM_ALIASES.find(([re]) => re.test(value));
  if (hit) return hit[1];
  return /\bobserv/i.test(value) ? OBSERVATION_PARAM : null;
};

const toNumber = (value) => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const cleaned = value.trim();
  if (!cleaned || cleaned === '*' || /n\/a/i.test(cleaned)) return null;
  const match = cleaned.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
};

// Workbook titles are ALL CAPS; the app shows them title-cased (wqmSheets.js).
const displayName = (name) => {
  const text = String(name || '');
  return text && text === text.toUpperCase()
    ? text.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())
    : text;
};

// 2 dp for ordinary readings; whole numbers for large counts (fecal coliform
// runs into the millions, where "9076799.79" is noise).
const round2 = (value) => {
  const num = Number(value);
  if (value === null || value === undefined || value === '' || !Number.isFinite(num)) return value;
  return Math.abs(num) >= 1000 ? Math.round(num) : Number(num.toFixed(2));
};

const getStatus = (param, value) => {
  if (value === null || value === undefined) return 'no data';
  const limit = PARAM_LIMITS[param];
  if (!limit) return 'no standard';
  if (limit.min !== undefined && value < limit.min) return 'exceeds standard';
  if (limit.max !== undefined && value > limit.max) return 'exceeds standard';
  return 'within standard';
};

const describeLimit = (param) => {
  const limit = PARAM_LIMITS[param];
  if (!limit) return null;
  const unit = limit.unit ? ` ${limit.unit}` : '';
  if (limit.min !== undefined && limit.max !== undefined) return `${limit.min}–${limit.max}${unit}`;
  if (limit.min !== undefined) return `≥ ${limit.min}${unit}`;
  return `≤ ${limit.max}${unit}`;
};

// ── Lookup ──────────────────────────────────────────────────────────────────
const simplify = (text) => String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const GENERIC_WORDS = new Set(['river', 'bay', 'coast', 'of', 'the', 'beach', 'resort', 'wqma', 'club', 'bc']);
const significantWords = (text) => simplify(text).split(' ').filter((w) => w && !GENERIC_WORDS.has(w));

const isStation = (station) => station && Number.isFinite(Number(station.stnNo)) && station.stnId && station.params;
const stationsOf = (sheet) => (sheet?.stations || []).filter(isStation);

/** Find a waterbody by key or (partial) name, ignoring words like "river". */
const findSheet = (sheets, query) => {
  if (!query) return null;
  const q = simplify(query);
  const qWords = significantWords(query);
  const exact = sheets.find((s) => simplify(s.key) === q || simplify(s.name) === q);
  if (exact) return exact;
  const scored = sheets.map((sheet) => {
    const words = new Set([...significantWords(sheet.key), ...significantWords(sheet.name)]);
    const hits = qWords.filter((w) => words.has(w)).length;
    return { sheet, hits, all: qWords.length > 0 && hits === qWords.length };
  }).filter((s) => s.hits > 0).sort((a, b) => Number(b.all) - Number(a.all) || b.hits - a.hits);
  return scored[0]?.sheet || null;
};

/** Find a station by number or (partial) name within a sheet. */
const findStation = (sheet, query) => {
  if (query === undefined || query === null || query === '') return null;
  const list = stationsOf(sheet);
  const asNumber = Number(String(query).replace(/^(stn|station)\s*(no\.?)?\s*/i, ''));
  if (Number.isFinite(asNumber)) {
    const byNo = list.find((s) => Number(s.stnNo) === asNumber);
    if (byNo) return byNo;
  }
  const q = simplify(query);
  return list.find((s) => simplify(s.stnId) === q)
    || list.find((s) => simplify(s.stnId).includes(q) || (q.length > 3 && q.includes(simplify(s.stnId))))
    || null;
};

const getParamData = (station, param) => {
  const target = normalizeParamName(param);
  const entry = Object.entries(station?.params || {}).find(([key]) => normalizeParamName(key) === target);
  return entry ? { key: entry[0], data: entry[1] } : null;
};

const periodLabel = (sheet, index) => sheet?.periodLabels?.[index] || MONTHS_SHORT[index];

const availableParams = (sheet) => {
  const raw = new Set(stationsOf(sheet).flatMap((s) => Object.keys(s.params).map(normalizeParamName).filter(Boolean)));
  return [...PARAM_ORDER.filter((p) => raw.has(p)), ...[...raw].filter((p) => !PARAM_ORDER.includes(p) && p !== OBSERVATION_PARAM)];
};

const seriesFor = (sheet, station, param) => {
  const found = getParamData(station, param);
  return (found?.data?.monthly || []).map((raw, index) => ({
    index, period: periodLabel(sheet, index), raw, value: toNumber(raw),
  })).filter((point) => point.raw !== null && point.raw !== undefined && point.raw !== '');
};

// ── Forecast engines (identical to Visualizations.jsx) ─────────────────────
const average = (values) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0);

const buildTechnicalForecast = (observed, horizon = 3) => {
  if (!observed.length) {
    return { points: [], diagnostics: { method: 'No forecast', latest: null, slope: null, rmse: null, confidence: 0, trend: 'insufficient data' } };
  }
  const indexed = observed.map((point, index) => ({ x: index, y: point.actual }));
  const latest = observed.at(-1)?.actual ?? null;
  const xMean = average(indexed.map((p) => p.x));
  const yMean = average(indexed.map((p) => p.y));
  const denominator = indexed.reduce((sum, p) => sum + ((p.x - xMean) ** 2), 0);
  const slope = denominator ? indexed.reduce((sum, p) => sum + ((p.x - xMean) * (p.y - yMean)), 0) / denominator : 0;
  const intercept = yMean - (slope * xMean);
  const residuals = indexed.map((p) => p.y - ((slope * p.x) + intercept));
  const rmse = Math.sqrt(average(residuals.map((v) => v ** 2)) || 0);
  const scale = Math.max(Math.abs(latest || 0), 1);
  const confidence = Math.max(45, Math.min(94, 92 - ((rmse / scale) * 100)));
  const trend = Math.abs(slope) < 0.01 ? 'stable' : slope > 0 ? 'increasing' : 'decreasing';
  const points = Array.from({ length: Math.max(1, horizon) }, (_, index) => {
    const x = indexed.length + index;
    const forecast = Number(((slope * x) + intercept).toFixed(4));
    const band = rmse * (1.15 + (index * 0.2));
    return {
      month: `F${index + 1}`, forecast,
      lower: Number((forecast - band).toFixed(4)), upper: Number((forecast + band).toFixed(4)),
      confidence: Math.round(Math.max(35, confidence - (index * 6))), method: 'OLS + RMSE band',
    };
  });
  return { points, diagnostics: { method: 'Ordinary least squares with RMSE uncertainty band', latest, slope, rmse, confidence: Math.round(confidence), trend } };
};

const fitFourierSeasonal = (residuals, period) => {
  if (residuals.length < 4 || !period) return { a: 0, b: 0 };
  const w = (2 * Math.PI) / period;
  let scc = 0; let sss = 0; let scs = 0; let rc = 0; let rs = 0;
  residuals.forEach((residual, t) => {
    const c = Math.cos(w * t); const s = Math.sin(w * t);
    scc += c * c; sss += s * s; scs += c * s; rc += residual * c; rs += residual * s;
  });
  const det = (scc * sss) - (scs * scs);
  if (Math.abs(det) < 1e-9) return { a: 0, b: 0 };
  return { a: ((rc * sss) - (rs * scs)) / det, b: ((rs * scc) - (rc * scs)) / det };
};

const buildProphetForecast = (observed, horizon = 3) => {
  if (observed.length < 3) return buildTechnicalForecast(observed, horizon);
  const indexed = observed.map((point, index) => ({ x: index, y: point.actual }));
  const latest = observed.at(-1)?.actual ?? null;
  const xMean = average(indexed.map((p) => p.x));
  const yMean = average(indexed.map((p) => p.y));
  const denominator = indexed.reduce((sum, p) => sum + ((p.x - xMean) ** 2), 0);
  const slope = denominator ? indexed.reduce((sum, p) => sum + ((p.x - xMean) * (p.y - yMean)), 0) / denominator : 0;
  const intercept = yMean - (slope * xMean);
  const trendAt = (x) => (slope * x) + intercept;
  const detrended = indexed.map((p) => p.y - trendAt(p.x));
  const period = Math.min(12, Math.max(4, indexed.length));
  const omega = (2 * Math.PI) / period;
  const { a, b } = fitFourierSeasonal(detrended, period);
  const seasonalAt = (x) => (a * Math.cos(omega * x)) + (b * Math.sin(omega * x));
  const fitResiduals = indexed.map((p) => p.y - (trendAt(p.x) + seasonalAt(p.x)));
  const rmse = Math.sqrt(average(fitResiduals.map((v) => v ** 2)) || 0);
  const seasonalAmplitude = Math.sqrt((a * a) + (b * b));
  const signalScale = Math.max(Math.abs(latest || 0), 1);
  const seasonalStrength = Math.round(Math.min(100, (seasonalAmplitude / signalScale) * 100));
  const confidence = Math.max(48, Math.min(96, 95 - ((rmse / signalScale) * 100)));
  const trend = Math.abs(slope) < 0.01 ? 'stable' : slope > 0 ? 'increasing' : 'decreasing';
  const points = Array.from({ length: Math.max(1, horizon) }, (_, index) => {
    const x = indexed.length + index;
    const forecast = Number((trendAt(x) + seasonalAt(x)).toFixed(4));
    const band = (rmse * (1.28 + (index * 0.25))) + (seasonalAmplitude * 0.25);
    return {
      month: `F${index + 1}`, forecast,
      lower: Number((forecast - band).toFixed(4)), upper: Number((forecast + band).toFixed(4)),
      confidence: Math.round(Math.max(35, confidence - (index * 5))), method: 'Prophet additive (trend + seasonality)',
    };
  });
  return { points, diagnostics: { method: 'Prophet-style additive: linear trend + Fourier seasonality + widening interval', latest, slope, rmse, seasonalStrength, confidence: Math.round(confidence), trend } };
};

const FORECAST_ENGINES = {
  prophet: { label: 'Prophet (additive)', build: buildProphetForecast },
  ols: { label: 'Fast trend (OLS)', build: buildTechnicalForecast },
};

const clampForecastValue = (param, value) => {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return value;
  const num = Number(value);
  const bounded = /(^|\b)ph\b/i.test(String(param)) ? Math.min(14, Math.max(0, num)) : Math.max(0, num);
  return Number(bounded.toFixed(2));
};

// ← front-end/src/utils/stationDraft.js, so a VERA edit stores exactly what the
// tabular editor would for the same input.
const computeAnnualAverage = (monthly = []) => {
  const values = Array.from({ length: 12 }, (_, i) => monthly?.[i] ?? null).map(toNumber).filter((v) => v !== null);
  if (!values.length) return null;
  return Number((values.reduce((sum, v) => sum + v, 0) / values.length).toFixed(4));
};

const parseEditableValue = (value) => {
  const cleaned = String(value ?? '').trim();
  if (!cleaned || cleaned === '-' || cleaned === '—') return null;
  if (cleaned === '*') return '*';
  if (/^</.test(cleaned)) return cleaned;
  const numeric = Number(cleaned.replace(/,/g, ''));
  return Number.isFinite(numeric) ? numeric : cleaned;
};

/** "Sep", "September", "Q3", "3rd quarter", 9 → slot index for this sheet. */
const resolvePeriodIndex = (sheet, period) => {
  if (period === undefined || period === null || period === '') return -1;
  const quarterly = sheet?.periodLabels?.[0] === 'Q1';
  const text = String(period).trim().toLowerCase();
  const quarter = text.match(/^q([1-4])$|^([1-4])(st|nd|rd|th)\s+quarter$/);
  if (quarter) return quarterly ? Number(quarter[1] || quarter[2]) - 1 : -1;
  let month = MONTHS_SHORT.findIndex((m) => text.startsWith(m.toLowerCase()));
  if (month < 0 && /^\d{1,2}$/.test(text)) month = Number(text) - 1;
  if (month < 0 || month > 11) return -1;
  // On a quarterly sheet a month name means its quarter (Jan–Mar → Q1).
  return quarterly ? Math.floor(month / 3) : month;
};

module.exports = {
  displayName,
  computeAnnualAverage,
  parseEditableValue,
  resolvePeriodIndex,
  MONTHS_SHORT,
  OBSERVATION_PARAM,
  PARAM_ORDER,
  PARAM_LIMITS,
  normalizeParamName,
  resolveParam,
  toNumber,
  round2,
  getStatus,
  describeLimit,
  stationsOf,
  findSheet,
  findStation,
  getParamData,
  periodLabel,
  availableParams,
  seriesFor,
  buildTechnicalForecast,
  buildProphetForecast,
  FORECAST_ENGINES,
  clampForecastValue,
};
