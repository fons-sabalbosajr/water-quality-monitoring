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

export const normalizeParamName = (param) => {
  const raw = String(param || '').trim();
  const key = raw.toLowerCase().replace(/\s+/g, ' ');

  if (!raw) return null;
  if (key.includes('observ')) return OBSERVATION_PARAM;
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

export const isStationRecord = (station) => (
  station &&
  Number.isFinite(Number(station.stnNo)) &&
  station.stnId &&
  station.params &&
  typeof station.params === 'object'
);

export const getStations = (sheet) => (sheet?.stations || []).filter(isStationRecord);

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

export const getParamData = (station, displayParam) => {
  const target = normalizeParamName(displayParam);
  const entry = Object.entries(station?.params || {}).find(([key]) => normalizeParamName(key) === target);
  return entry?.[1] || null;
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