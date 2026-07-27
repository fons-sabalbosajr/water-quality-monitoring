export const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
export const ANNUAL_LABEL = 'Annual Avg';
export const TREND_LABELS = [...MONTHS_SHORT, ANNUAL_LABEL];

export const PARAM_ORDER = [
  'DO (mg/L)', 'BOD (mg/L)', 'TSS (mg/L)', 'pH',
  'Temp. (°C)', 'Color (TCU)', 'Fecal Coliform (MPN/100mL)',
  'NO3-N (mg/L)', 'PO4-P (mg/L)', 'Cl- (mg/L)', 'Oil and Grease',
];

export const OBSERVATION_PARAM = 'Observation';

export const PARAM_LIMITS = {
  'DO (mg/L)': { min: 5, unit: 'mg/L', goodDirection: 'high' },
  'BOD (mg/L)': { max: 7, unit: 'mg/L', goodDirection: 'low' },
  'TSS (mg/L)': { max: 80, unit: 'mg/L', goodDirection: 'low' },
  pH: { min: 6.5, max: 8.5, unit: '', goodDirection: 'range' },
  'Temp. (°C)': { max: 35, unit: '°C', goodDirection: 'low' },
  'Color (TCU)': { max: 50, unit: 'TCU', goodDirection: 'low' },
  'Fecal Coliform (MPN/100mL)': { max: 1000, unit: 'MPN/100mL', goodDirection: 'low' },
  'NO3-N (mg/L)': { max: 10, unit: 'mg/L', goodDirection: 'low' },
  'PO4-P (mg/L)': { max: 0.5, unit: 'mg/L', goodDirection: 'low' },
  'Cl- (mg/L)': { max: 250, unit: 'mg/L', goodDirection: 'low' },
  'Oil and Grease': { max: 2, unit: 'mg/L', goodDirection: 'low' },
};

export const GAUGE_PARAMS = ['DO (mg/L)', 'TSS (mg/L)', 'pH', 'Temp. (°C)', 'NO3-N (mg/L)', 'PO4-P (mg/L)'];

export const toTitle = (str) =>
  String(str || '').replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()).trim();

// normalizeParamName() sits in the hottest loop in the app: the correlation
// matrix, gauges, trend builders and every table render call it once per
// station × parameter × month. The inputs are drawn from a tiny fixed set of
// spreadsheet column headings, so the result is memoised. This turns an
// O(n) string scan into a Map hit on every call after the first.
const paramNameCache = new Map();

const computeParamName = (param) => {
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

export const normalizeParamName = (param) => {
  // Non-string keys can never be repeated cheaply as a cache key; compute them
  // directly rather than growing the Map with object identities.
  if (typeof param !== 'string') return computeParamName(param);
  if (paramNameCache.has(param)) return paramNameCache.get(param);
  const normalized = computeParamName(param);
  // Bound the cache: parameter headings are a closed set, so hitting this cap
  // means something unexpected is feeding it and it should not grow forever.
  if (paramNameCache.size < 500) paramNameCache.set(param, normalized);
  return normalized;
};

// Shared empty result so "no stations" never produces a new array identity.
const EMPTY_STATIONS = Object.freeze([]);

export const isStationRecord = (station) => (
  station &&
  Number.isFinite(Number(station.stnNo)) &&
  station.stnId &&
  station.params &&
  typeof station.params === 'object'
);

// Cached per sheet object. Besides skipping a repeated filter pass, returning a
// stable array reference lets downstream useMemo/React.memo comparisons hit,
// instead of invalidating on every render because a fresh array was produced.
const stationsCache = new WeakMap();

export const getStations = (sheet) => {
  if (!sheet || typeof sheet !== 'object') return EMPTY_STATIONS;
  const cached = stationsCache.get(sheet);
  if (cached) return cached;
  const stations = (sheet.stations || []).filter(isStationRecord);
  stationsCache.set(sheet, stations);
  return stations;
};

export const toNumber = (value) => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;

  const cleaned = value.trim();
  if (!cleaned || cleaned === '*' || /n\/a/i.test(cleaned)) return null;

  const match = cleaned.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;

  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
};

export const fmt = (value) => {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value !== 'number') return String(value);
  if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
  if (value >= 1000) return value.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return value < 10 ? value.toFixed(2) : value.toFixed(1);
};

export const getParamUnit = (param) => PARAM_LIMITS[normalizeParamName(param)]?.unit || '';

export const fmtWithUnit = (value, param) => {
  const unit = getParamUnit(param);
  const formatted = fmt(value);
  return unit && formatted !== '—' ? `${formatted} ${unit}` : formatted;
};

/**
 * Per-station index of normalised parameter name -> reading block.
 *
 * getParamData() was a full Object.entries().find() with a normalisation call
 * per key, executed on every access. Building the index once per station object
 * and holding it in a WeakMap makes each lookup O(1) and lets the index be
 * garbage collected together with the station it describes, so nothing leaks
 * when sheets are replaced on a refresh.
 */
const stationParamIndex = new WeakMap();

const getStationParamIndex = (station) => {
  let index = stationParamIndex.get(station);
  if (index) return index;

  index = new Map();
  for (const [key, value] of Object.entries(station.params || {})) {
    const normalized = normalizeParamName(key);
    // First writer wins, matching the previous .find() semantics when a sheet
    // carries two headings that normalise to the same parameter.
    if (normalized && !index.has(normalized)) index.set(normalized, value);
  }
  stationParamIndex.set(station, index);
  return index;
};

export const getParamData = (station, displayParam) => {
  if (!station || typeof station !== 'object') return null;
  const target = normalizeParamName(displayParam);
  if (!target) return null;
  return getStationParamIndex(station).get(target) || null;
};

// Station objects are treated as immutable (every edit clones the sheet), but
// call this if a station's params are ever mutated in place.
export const invalidateStationParamIndex = (station) => {
  if (station && typeof station === 'object') stationParamIndex.delete(station);
};

export const getAvailableParams = (stations, includeObservation = false) => {
  const raw = [...new Set(
    stations.flatMap((station) => Object.keys(station.params || {}).map(normalizeParamName).filter(Boolean))
  )];
  const ordered = PARAM_ORDER.filter((param) => raw.includes(param));
  const extra = raw.filter((param) => !PARAM_ORDER.includes(param) && param !== OBSERVATION_PARAM);
  const params = [...ordered, ...extra];

  if (includeObservation && raw.includes(OBSERVATION_PARAM)) params.push(OBSERVATION_PARAM);
  return params;
};

export const getMonthlyNumber = (paramData, monthIndex) => toNumber(paramData?.monthly?.[monthIndex]);

export const getAverageNumber = (paramData) => toNumber(paramData?.avg);

export const hasNumericReading = (station) => Object.keys(station?.params || {}).some((param) => {
  const normalized = normalizeParamName(param);
  if (!normalized || normalized === OBSERVATION_PARAM) return false;
  const data = station.params[param];
  return getAverageNumber(data) !== null || (data.monthly || []).some((value) => toNumber(value) !== null);
});

export const getTrendNumber = (paramData, monthIndex) => {
  if (monthIndex === MONTHS_SHORT.length) return getAverageNumber(paramData);

  const monthlyValue = getMonthlyNumber(paramData, monthIndex);
  if (monthlyValue !== null) return monthlyValue;

  return null;
};

export const getLatestNumber = (paramData) => {
  const monthly = paramData?.monthly || [];
  for (let idx = monthly.length - 1; idx >= 0; idx -= 1) {
    const value = toNumber(monthly[idx]);
    if (value !== null) return value;
  }
  return getAverageNumber(paramData);
};

export const getParamStatus = (param, value) => {
  if (value === null || value === undefined) return 'nodata';
  const limit = PARAM_LIMITS[param];
  if (!limit) return 'safe';

  if (limit.min !== undefined && value < limit.min) return 'alert';
  if (limit.max !== undefined && value > limit.max) return 'alert';
  if (limit.min !== undefined && value < limit.min * 1.15) return 'watch';
  if (limit.max !== undefined && value > limit.max * 0.8) return 'watch';
  return 'safe';
};

export const getGaugePercent = (param, value) => {
  if (value === null || value === undefined) return 0;
  const limit = PARAM_LIMITS[param];
  if (!limit) return Math.max(0, Math.min(100, value));

  if (limit.goodDirection === 'range' && limit.min !== undefined && limit.max !== undefined) {
    const span = limit.max - limit.min || 1;
    return Math.max(0, Math.min(100, ((value - limit.min) / span) * 100));
  }

  if (limit.min !== undefined && limit.goodDirection === 'high') {
    return Math.max(0, Math.min(100, (value / limit.min) * 100));
  }

  if (limit.max !== undefined) {
    return Math.max(0, Math.min(100, (value / limit.max) * 100));
  }

  return Math.max(0, Math.min(100, value));
};

export const getObservationEntries = (stations) => stations.flatMap((station) => {
  const paramData = getParamData(station, OBSERVATION_PARAM);
  return (paramData?.monthly || [])
    .map((value, monthIndex) => ({
      station,
      month: MONTHS_SHORT[monthIndex],
      monthIndex,
      value: typeof value === 'string' ? value.trim() : value,
    }))
    .filter((entry) => entry.value && entry.value !== '*');
});