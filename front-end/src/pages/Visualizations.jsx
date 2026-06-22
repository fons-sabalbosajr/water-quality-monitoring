import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { Button, Card, Modal, Select, Space, Statistic, Table, Tag } from 'antd';
import { LineChartOutlined } from '@ant-design/icons';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, ComposedChart, Legend,
  Line, PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart,
  ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis,
} from 'recharts';
import {
  MONTHS_SHORT, PARAM_LIMITS, fmt, getAvailableParams,
  getLatestNumber, getMonthlyNumber, getParamData,
} from '../utils/wqmData';
import { loadStationLocationsCached } from '../utils/stationWorkbook';
import { buildWaterbodyOptions, getReadableStations, groupWaterbodyByProvince, usePublishedWqmDataset } from '../utils/wqmSheets';
import { useForecastMonths } from '../utils/forecastSettings';
import encryptedStorage from '../utils/encryptedStorage';
import './Visualizations.css';

const COLORS = ['#446ACB', '#7CB675', '#e07b54', '#a78bfa', '#f59e0b', '#06b6d4', '#ec4899', '#84cc16'];
const CHART_TICK = { fontSize: 10 };
const LEGEND_STYLE = { fontSize: '0.68rem' };
const FORECAST_INITIAL_CARD_LIMIT = 3;
const CesiumStationMap = lazy(() => import('../components/CesiumStationMap'));

const normalizeForMatch = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const WATERBODY_ALIASES = {
  'pudoc river': ['baler river'],
};

const getWaterbodyMatches = (key, name) => {
  const normalizedName = normalizeForMatch(name);
  const normalizedKey = normalizeForMatch(key);
  return new Set([
    normalizedName,
    normalizedKey,
    ...(WATERBODY_ALIASES[normalizedName] || []),
    ...(WATERBODY_ALIASES[normalizedKey] || []),
  ].filter(Boolean));
};

const getLocationIdPrefix = (key) => String(key || '').split('_')[0]?.slice(0, 3).toUpperCase();

const getStationAssignmentKey = (waterbodyKey, station) => [
  waterbodyKey,
  station?.stnNo ?? '',
  station?.stnId ?? '',
  station?.address ?? '',
].join('::');

const parseCoordinateValue = (value) => {
  if (value === '' || value === null || value === undefined) return NaN;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : NaN;
};

const isWaterbodyMatch = (location, matches) => {
  const river = normalizeForMatch(location.waterbodyRiver);
  const loc = normalizeForMatch(location.waterbodyLoc);
  if (river && matches.has(river)) return true;
  if (!river && loc && [...matches].some((match) => match.includes(loc) || loc.includes(match))) return true;
  return false;
};

const average = (values) => {
  const valid = values.filter((value) => Number.isFinite(value));
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null;
};

const hasParamReading = (station, param) => (
  getLatestNumber(getParamData(station, param)) !== null
  || MONTHS_SHORT.some((_, index) => getMonthlyNumber(getParamData(station, param), index) !== null)
);

const hasMonthlyParamReading = (station, param) => (
  MONTHS_SHORT.some((_, index) => getMonthlyNumber(getParamData(station, param), index) !== null)
);

const getStationOptionKey = (station) => String(station?.stnNo ?? station?.stnId ?? '');

const getCurrentMonthIndex = (stations, params) => {
  for (let monthIndex = MONTHS_SHORT.length - 1; monthIndex >= 0; monthIndex -= 1) {
    const hasCurrentValue = stations.some((station) => params.some((param) => (
      getMonthlyNumber(getParamData(station, param), monthIndex) !== null
    )));
    if (hasCurrentValue) return monthIndex;
  }
  return -1;
};

const getCurrentParamValue = (station, param, monthIndex) => {
  const value = monthIndex >= 0 ? getMonthlyNumber(getParamData(station, param), monthIndex) : null;
  return value ?? getLatestNumber(getParamData(station, param));
};

const normalizeScore = (param, value) => {
  if (value === null || value === undefined) return 0;
  const limit = PARAM_LIMITS[param];
  if (!limit) return Math.min(100, Math.max(0, value));
  if (limit.max) return Math.min(100, (value / limit.max) * 100);
  if (limit.min) return Math.min(100, (value / limit.min) * 100);
  return Math.min(100, Math.max(0, value));
};

const regression = (points) => {
  if (points.length < 2) return [];
  const xMean = average(points.map((point) => point.x));
  const yMean = average(points.map((point) => point.y));
  const numerator = points.reduce((sum, point) => sum + ((point.x - xMean) * (point.y - yMean)), 0);
  const denominator = points.reduce((sum, point) => sum + ((point.x - xMean) ** 2), 0);
  if (!denominator) return [];
  const slope = numerator / denominator;
  const intercept = yMean - (slope * xMean);
  const xs = points.map((point) => point.x);
  const min = Math.min(...xs);
  const max = Math.max(...xs);
  return [
    { x: min, regression: slope * min + intercept },
    { x: max, regression: slope * max + intercept },
  ];
};

const buildTechnicalForecast = (observed, horizon = 3) => {
  if (!observed.length) {
    return {
      points: [],
      diagnostics: {
        method: 'No forecast',
        latest: null,
        slope: null,
        rmse: null,
        confidence: 0,
        trend: 'insufficient data',
      },
    };
  }

  const indexed = observed.map((point, index) => ({ x: index, y: point.actual }));
  const latest = observed.at(-1)?.actual ?? null;
  const xMean = average(indexed.map((point) => point.x));
  const yMean = average(indexed.map((point) => point.y));
  const denominator = indexed.reduce((sum, point) => sum + ((point.x - xMean) ** 2), 0);
  const slope = denominator
    ? indexed.reduce((sum, point) => sum + ((point.x - xMean) * (point.y - yMean)), 0) / denominator
    : 0;
  const intercept = yMean - (slope * xMean);
  const residuals = indexed.map((point) => point.y - ((slope * point.x) + intercept));
  const rmse = Math.sqrt(average(residuals.map((value) => value ** 2)) || 0);
  const scale = Math.max(Math.abs(latest || 0), 1);
  const confidence = Math.max(45, Math.min(94, 92 - ((rmse / scale) * 100)));
  const trend = Math.abs(slope) < 0.01 ? 'stable' : slope > 0 ? 'increasing' : 'decreasing';

  const points = Array.from({ length: Math.max(1, horizon) }, (_, index) => {
    const x = indexed.length + index;
    const forecast = Number(((slope * x) + intercept).toFixed(4));
    const band = rmse * (1.15 + (index * 0.2));
    return {
      month: `F${index + 1}`,
      forecast,
      lower: Number((forecast - band).toFixed(4)),
      upper: Number((forecast + band).toFixed(4)),
      confidence: Math.round(Math.max(35, confidence - (index * 6))),
      method: 'OLS + RMSE band',
    };
  });

  return {
    points,
    diagnostics: {
      method: 'Ordinary least squares with RMSE uncertainty band',
      latest,
      slope,
      rmse,
      confidence: Math.round(confidence),
      trend,
    },
  };
};

// Least-squares fit of a single Fourier harmonic (a*cos + b*sin) used to model
// the seasonal component of the Prophet-style additive decomposition.
const fitFourierSeasonal = (residuals, period) => {
  if (residuals.length < 4 || !period) return { a: 0, b: 0 };
  const w = (2 * Math.PI) / period;
  let scc = 0;
  let sss = 0;
  let scs = 0;
  let rc = 0;
  let rs = 0;
  residuals.forEach((residual, t) => {
    const c = Math.cos(w * t);
    const s = Math.sin(w * t);
    scc += c * c;
    sss += s * s;
    scs += c * s;
    rc += residual * c;
    rs += residual * s;
  });
  const det = (scc * sss) - (scs * scs);
  if (Math.abs(det) < 1e-9) return { a: 0, b: 0 };
  return {
    a: ((rc * sss) - (rs * scs)) / det,
    b: ((rs * scc) - (rc * scs)) / det,
  };
};

// Prophet-style additive forecast: decomposes the series into a linear growth
// (trend) component plus a Fourier seasonal component, then projects both
// forward with an uncertainty interval that widens with the horizon — mirroring
// the behaviour of Facebook/Meta Prophet for short monthly series.
const buildProphetForecast = (observed, horizon = 3) => {
  if (observed.length < 3) return buildTechnicalForecast(observed, horizon);

  const indexed = observed.map((point, index) => ({ x: index, y: point.actual }));
  const latest = observed.at(-1)?.actual ?? null;
  const xMean = average(indexed.map((point) => point.x));
  const yMean = average(indexed.map((point) => point.y));
  const denominator = indexed.reduce((sum, point) => sum + ((point.x - xMean) ** 2), 0);
  const slope = denominator
    ? indexed.reduce((sum, point) => sum + ((point.x - xMean) * (point.y - yMean)), 0) / denominator
    : 0;
  const intercept = yMean - (slope * xMean);
  const trendAt = (x) => (slope * x) + intercept;

  const detrended = indexed.map((point) => point.y - trendAt(point.x));
  const period = Math.min(12, Math.max(4, indexed.length));
  const omega = (2 * Math.PI) / period;
  const { a, b } = fitFourierSeasonal(detrended, period);
  const seasonalAt = (x) => (a * Math.cos(omega * x)) + (b * Math.sin(omega * x));

  const fitResiduals = indexed.map((point) => point.y - (trendAt(point.x) + seasonalAt(point.x)));
  const rmse = Math.sqrt(average(fitResiduals.map((value) => value ** 2)) || 0);
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
      month: `F${index + 1}`,
      forecast,
      lower: Number((forecast - band).toFixed(4)),
      upper: Number((forecast + band).toFixed(4)),
      confidence: Math.round(Math.max(35, confidence - (index * 5))),
      method: 'Prophet additive (trend + seasonality)',
    };
  });

  return {
    points,
    diagnostics: {
      method: 'Prophet-style additive: linear trend + Fourier seasonality + widening interval',
      latest,
      slope,
      rmse,
      seasonalStrength,
      confidence: Math.round(confidence),
      trend,
    },
  };
};

const FORECAST_ENGINES = {
  ols: {
    label: 'Fast trend (OLS)',
    tag: 'Fast trend forecast',
    build: buildTechnicalForecast,
  },
  prophet: {
    label: 'Prophet (additive)',
    tag: 'Prophet additive forecast',
    build: buildProphetForecast,
  },
};

// Round to at most 2 decimal places for display-friendly forecast values.
const round2 = (value) => {
  const num = Number(value);
  return value === null || value === undefined || !Number.isFinite(num)
    ? value
    : Number(num.toFixed(2));
};

// Keep forecast values physically sensible per parameter — no negative
// concentrations or counts, and pH constrained to 0–14 — then round to 2 dp.
const clampForecastValue = (param, value) => {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return value;
  const num = Number(value);
  const isPh = /(^|\b)ph\b/i.test(String(param));
  const bounded = isPh ? Math.min(14, Math.max(0, num)) : Math.max(0, num);
  return Number(bounded.toFixed(2));
};

// Animated pulsing dot drawn only on projected (forecast) points.
const ForecastDot = ({ cx, cy, payload }) => {
  if (
    cx === undefined || cy === undefined
    || !payload?.isForecast
    || payload?.forecast === null || payload?.forecast === undefined
  ) {
    return null;
  }
  return (
    <g>
      <circle className="forecast-dot-pulse" cx={cx} cy={cy} r="5.5" fill="#f59e0b" />
      <circle cx={cx} cy={cy} r="3" fill="#f59e0b" stroke="var(--bg-card)" strokeWidth="1.5" />
    </g>
  );
};

const getValueRange = (values) => {
  const valid = values.filter((value) => Number.isFinite(value));
  if (!valid.length) return null;
  return { min: Math.min(...valid), max: Math.max(...valid), avg: average(valid) };
};

const chartDefinitions = {
  heatmap: 'Matrix of average or latest station readings by parameter. Darker cells indicate a higher normalized value against the parameter reference range.',
  'fecal-trophic': 'Fecal contamination risk and trophic-state indicators are shown together using the latest available station readings.',
  fecal: 'Timeline and station map for Fecal Coliform. Larger pin halos indicate higher latest fecal risk relative to the 1,000 MPN/100mL reference limit.',
  trophic: 'Bar comparison of nutrient, oxygen, and temperature indicators used to screen possible eutrophication pressure.',
  seasonal: 'Quarterly aggregation of available monthly readings to show wet/dry-season shifts across the selected waterbody.',
  radar: 'Normalized station profile from 0 to 100 so parameters with different units can be compared in one shape.',
  scatter: 'Pairwise parameter plots with a regression line to reveal possible relationships between pollutant indicators.',
  forecast: 'Short horizon projection from the latest available monthly trend. Charts are computed in-browser for fast station screening.',
};

// Plain-language stories for each chart so non-technical readers understand what
// they are looking at and why it matters. Kept conversational on purpose.
const chartNarratives = {
  heatmap: 'Think of this as a color-coded report card for the whole waterbody at a glance. Each row is a water quality measure and each column is a monitoring station. The warmer and bolder a box looks, the higher that reading is compared to what is considered safe — so the eye-catching cells are the ones worth checking first.',
  'fecal-trophic': 'This view answers two everyday questions: is the water clean enough to be near, and is it getting overloaded with nutrients? The timeline and map show where germ levels are highest, while the nutrient bars hint at whether algae could start taking over. Bigger and brighter usually means more attention is needed.',
  fecal: 'This is about safety from harmful bacteria. The timeline shows how contamination rises and falls during the year, and the map points to exactly where the dirtiest spots are. Larger, brighter markers flag places where swimming, fishing, or bathing could be risky.',
  trophic: 'These bars compare the “food” and oxygen in the water at each station. Too much nutrient with too little oxygen is the recipe for algae blooms that can choke a river or lake. The taller nutrient bars quietly point to spots that could be heading that way.',
  seasonal: 'Rivers and lakes naturally behave differently in the rainy and dry months. This chart groups the readings by season so you can see those swings — for example, whether heavy rains tend to wash more pollution into the water — instead of mistaking a normal seasonal change for a new problem.',
  radar: 'Each shape is a quick “health profile” of a station. Every spoke is a different measure scaled to the same 0–100 range, so a bigger, more even shape generally means healthier water. It makes comparing several stations side by side fast and intuitive.',
  scatter: 'Every dot links two measurements taken at the same place and time. When the dots line up nicely along the slanted line, the two measures tend to rise and fall together — a clue that they may share the same cause or pollution source.',
  forecast: 'This is a simple look-ahead. Using the most recent months, it sketches where each measure might be heading next. The shaded band shows how confident the estimate is — the wider it gets, the less certain the outlook. Treat it as an early heads-up rather than a promise.',
};

const VisualizationView = ({ type }) => {
  const { year: visualizationYear, sheets, loading, error } = usePublishedWqmDataset();
  const WATERBODIES = useMemo(() => buildWaterbodyOptions(sheets), [sheets]);
  const [waterbodyKey, setWaterbodyKey] = useState(WATERBODIES[0]?.key || '');
  const [stationLocations, setStationLocations] = useState([]);
  const [profileSettings, setProfileSettings] = useState(
    () => encryptedStorage.getItem('wqms_waterbody_profile_settings') || {},
  );
  const activeWaterbodyKey = WATERBODIES.some((waterbody) => waterbody.key === waterbodyKey)
    ? waterbodyKey
    : (WATERBODIES[0]?.key || '');
  const selected = WATERBODIES.find((waterbody) => waterbody.key === activeWaterbodyKey) || WATERBODIES[0];
  const selectedSheet = sheets.find((sheet) => sheet.key === selected?.key);
  const stations = useMemo(() => getReadableStations(selectedSheet), [selectedSheet]);
  const params = useMemo(() => getAvailableParams(stations, false), [stations]);
  const [forecastStationKey, setForecastStationKey] = useState('');
  const [forecastExpandedKey, setForecastExpandedKey] = useState('');
  const [forecastEngine, setForecastEngine] = useState('prophet');
  const [forecastDetail, setForecastDetail] = useState(null);
  const forecastMonths = useForecastMonths();
  const currentMonthIndex = useMemo(() => getCurrentMonthIndex(stations, params), [params, stations]);
  const periodLabel = selectedSheet?.periodLabels?.[currentMonthIndex] || MONTHS_SHORT[currentMonthIndex];
  const currentMonthLabel = currentMonthIndex >= 0 ? `${periodLabel} ${visualizationYear}` : 'latest available data';

  useEffect(() => {
    if (!WATERBODIES.some((waterbody) => waterbody.key === waterbodyKey)) {
      queueMicrotask(() => setWaterbodyKey(WATERBODIES[0]?.key || ''));
    }
  }, [WATERBODIES, waterbodyKey]);

  useEffect(() => {
    let cancelled = false;
    loadStationLocationsCached().then((locations) => {
      if (!cancelled) setStationLocations(locations);
    }).catch(() => {
      if (!cancelled) setStationLocations([]);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const handler = (event) => {
      setProfileSettings(event.detail || encryptedStorage.getItem('wqms_waterbody_profile_settings') || {});
    };
    window.addEventListener('wqms:waterbody-profile-settings', handler);
    return () => window.removeEventListener('wqms:waterbody-profile-settings', handler);
  }, []);

  const matchedLocations = useMemo(() => {
    const waterbodyMatches = getWaterbodyMatches(activeWaterbodyKey, selected?.name);
    const idPrefix = getLocationIdPrefix(activeWaterbodyKey);
    const stationNames = stations.map((station) => normalizeForMatch(station.stnId));
    const stationMatches = (location) => {
      const stn = normalizeForMatch(location.station);
      return !stn || stationNames.some((name) => name && (stn === name || stn.includes(name) || name.includes(stn)));
    };

    let workbookLocations = stationLocations
      .filter((location) => isWaterbodyMatch(location, waterbodyMatches))
      .filter(stationMatches);

    if (!workbookLocations.length) {
      workbookLocations = stationLocations.filter((location) => (
        idPrefix && String(location.id || '').toUpperCase().startsWith(`${idPrefix}_`)
      ));
    }

    if (!workbookLocations.length) {
      workbookLocations = stationLocations.filter(stationMatches);
    }

    // Include stations whose coordinates were manually saved via Settings
    const profile = profileSettings[activeWaterbodyKey] || {};
    const overrides = profile.stationOverrides || {};
    const workbookNames = new Set(
      workbookLocations.map((loc) => normalizeForMatch(loc.station)).filter(Boolean),
    );
    const synthetic = stations
      .map((station) => {
        const assignmentKey = getStationAssignmentKey(activeWaterbodyKey, station);
        const override = overrides[assignmentKey];
        if (!override) return null;
        const lat = parseCoordinateValue(override.lat);
        const lng = parseCoordinateValue(override.lng);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
        const stationName = String(override.name || station.stnId || '');
        if (workbookNames.has(normalizeForMatch(stationName))) return null;
        const address = String(override.address || station.address || '');
        const addressParts = address.split(',');
        return {
          id: assignmentKey,
          station: stationName,
          waterbodyRiver: selected?.name || '',
          waterbodyLoc: '',
          barangay: addressParts[0]?.trim() || '',
          province: addressParts[addressParts.length - 1]?.trim() || '',
          lat,
          lng,
          stationData: override.name ? { ...station, stnId: override.name } : station,
        };
      })
      .filter(Boolean);

    return [...workbookLocations, ...synthetic];
  }, [activeWaterbodyKey, selected?.name, stationLocations, stations, profileSettings]);

  const heatmapParams = params
    .filter((param) => stations.some((station) => hasParamReading(station, param)))
    .slice(0, 8);
  const heatmapStations = stations.filter((station) => heatmapParams.some((param) => hasParamReading(station, param)));
  const heatmap = heatmapParams.map((param) => ({
    param,
    cells: heatmapStations.map((station) => ({
      station: station.stnId,
      value: getCurrentParamValue(station, param, currentMonthIndex),
    })),
  }));

  const fecalStations = stations.filter((station) => hasParamReading(station, 'Fecal Coliform (MPN/100mL)'));
  const fecalTimeline = MONTHS_SHORT.map((month, index) => {
    const point = { month };
    fecalStations.forEach((station) => {
      point[station.stnId] = getMonthlyNumber(getParamData(station, 'Fecal Coliform (MPN/100mL)'), index);
    });
    return point;
  }).filter((point) => fecalStations.some((station) => point[station.stnId] !== null && point[station.stnId] !== undefined));

  const pollutionMap = matchedLocations.map((location) => {
    const station = fecalStations.find((item) => {
      const workbookStation = normalizeForMatch(location.station);
      const dataStation = normalizeForMatch(item.stnId);
      return workbookStation && dataStation && (workbookStation.includes(dataStation) || dataStation.includes(workbookStation));
    });
    const fecal = station ? getCurrentParamValue(station, 'Fecal Coliform (MPN/100mL)', currentMonthIndex) : null;
    return { ...location, stationData: station, fecal, risk: normalizeScore('Fecal Coliform (MPN/100mL)', fecal) };
  }).filter((point) => point.stationData && point.fecal !== null);

  const trophicData = stations.map((station) => ({
    station: station.stnId,
    PO4: getCurrentParamValue(station, 'PO4-P (mg/L)', currentMonthIndex),
    NO3: getCurrentParamValue(station, 'NO3-N (mg/L)', currentMonthIndex),
    DO: getCurrentParamValue(station, 'DO (mg/L)', currentMonthIndex),
    Temp: getCurrentParamValue(station, 'Temp. (°C)', currentMonthIndex),
  })).filter((row) => row.PO4 !== null || row.NO3 !== null || row.DO !== null || row.Temp !== null);

  const seasonalData = ['Jan-Mar', 'Apr-Jun', 'Jul-Sep', 'Oct-Dec'].map((season, seasonIndex) => {
    const start = seasonIndex * 3;
    return {
      season,
      DO: average(stations.flatMap((station) => [0, 1, 2].map((offset) => getMonthlyNumber(getParamData(station, 'DO (mg/L)'), start + offset)))),
      TSS: average(stations.flatMap((station) => [0, 1, 2].map((offset) => getMonthlyNumber(getParamData(station, 'TSS (mg/L)'), start + offset)))),
      Fecal: average(stations.flatMap((station) => [0, 1, 2].map((offset) => getMonthlyNumber(getParamData(station, 'Fecal Coliform (MPN/100mL)'), start + offset)))),
    };
  }).filter((row) => row.DO !== null || row.TSS !== null || row.Fecal !== null);

  const radarParams = params.filter((param) => stations.some((station) => hasParamReading(station, param))).slice(0, 6);
  const radarStations = stations.filter((station) => radarParams.some((param) => hasParamReading(station, param))).slice(0, 5);
  const radarData = radarParams.map((param) => {
    const row = { param };
    radarStations.forEach((station) => {
      row[station.stnId] = normalizeScore(param, getCurrentParamValue(station, param, currentMonthIndex));
    });
    return row;
  });

  const scatterConfigs = [
    ['Temp vs DO', 'Temp. (°C)', 'DO (mg/L)', 'Expected inverse relationship'],
    ['TSS vs Color', 'TSS (mg/L)', 'Color (TCU)', 'Sediment loading analysis'],
    ['PO4 vs Fecal', 'PO4-P (mg/L)', 'Fecal Coliform (MPN/100mL)', 'Agricultural vs sewage contamination'],
  ];
  const scatterSets = scatterConfigs.map(([name, xParam, yParam, note]) => {
    const points = stations.map((station) => ({
      station: station.stnId,
      x: getCurrentParamValue(station, xParam, currentMonthIndex),
      y: getCurrentParamValue(station, yParam, currentMonthIndex),
    })).filter((point) => point.x !== null && point.y !== null);
    return { name, xParam, yParam, note, points, regression: regression(points) };
  });

  const forecastStations = useMemo(() => (
    stations.filter((station) => params.some((param) => hasMonthlyParamReading(station, param)))
  ), [params, stations]);
  const activeForecastStation = forecastStations.find((station) => getStationOptionKey(station) === forecastStationKey)
    || forecastStations[0];
  const activeForecastStationKey = getStationOptionKey(activeForecastStation);
  const forecastScopeKey = `${activeWaterbodyKey}:${activeForecastStationKey}`;
  const forecastExpanded = forecastExpandedKey === forecastScopeKey;
  const forecastParamCandidates = useMemo(() => (
    activeForecastStation
      ? params.filter((param) => hasMonthlyParamReading(activeForecastStation, param))
      : []
  ), [activeForecastStation, params]);
  const visibleForecastParams = forecastExpanded
    ? forecastParamCandidates
    : forecastParamCandidates.slice(0, FORECAST_INITIAL_CARD_LIMIT);
  const forecastCards = useMemo(() => {
    if (!activeForecastStation) return [];

    const buildForecast = (FORECAST_ENGINES[forecastEngine] || FORECAST_ENGINES.prophet).build;
    return visibleForecastParams
      .map((param, cardIndex) => {
        const monthly = MONTHS_SHORT.map((month, index) => ({
          month,
          index,
          actual: getMonthlyNumber(getParamData(activeForecastStation, param), index),
        }));
        const observed = monthly
          .filter((point) => point.actual !== null)
          .map((point) => ({ month: point.month, actual: round2(point.actual) }));
        // Calendar index of the most recent month that has a reading — the
        // forecast horizon is labelled with the months that follow it.
        const lastObservedIndex = monthly.reduce(
          (last, point) => (point.actual !== null ? point.index : last),
          -1,
        );
        const technical = buildForecast(
          monthly
            .filter((point) => point.actual !== null)
            .map((point) => ({ month: point.month, actual: point.actual })),
          forecastMonths,
        );
        // Relabel projected points with the real succeeding month names and keep
        // the values within sensible bounds for the parameter (2 decimals).
        const forecastPoints = technical.points.map((point, index) => {
          const monthName = lastObservedIndex >= 0
            ? MONTHS_SHORT[(lastObservedIndex + 1 + index) % 12]
            : point.month;
          return {
            ...point,
            month: monthName,
            isForecast: true,
            forecast: clampForecastValue(param, point.forecast),
            lower: clampForecastValue(param, point.lower),
            upper: clampForecastValue(param, point.upper),
          };
        });
        // Bridge the forecast onto the last observed reading so the (differently
        // coloured) forecast line connects to the current readings instead of
        // starting from a detached point.
        const bridged = observed.map((point, index) => (
          index === observed.length - 1
            ? { ...point, forecast: point.actual, lower: point.actual, upper: point.actual }
            : point
        ));
        return {
          param,
          color: COLORS[cardIndex % COLORS.length],
          observed,
          diagnostics: technical.diagnostics,
          forecastPoints,
          data: bridged.concat(forecastPoints),
        };
      })
      .filter((card) => card.observed.length);
  }, [activeForecastStation, visibleForecastParams, forecastEngine, forecastMonths]);
  const hiddenForecastCount = Math.max(0, forecastParamCandidates.length - forecastCards.length);
  const activeForecastLabel = (FORECAST_ENGINES[forecastEngine] || FORECAST_ENGINES.prophet).tag;

  const titleMap = {
    heatmap: 'Heatmap Matrix',
    'fecal-trophic': 'Fecal Risk & Trophic State',
    fecal: 'Fecal Risk & Pollution Map',
    trophic: 'Trophic State / Eutrophication',
    seasonal: 'Seasonal Decomposition',
    radar: 'Radar / Spider Chart',
    scatter: 'Scatter Plot Relationship Analysis',
    forecast: 'Forecast / Predictive Charts',
  };

  const analysisMap = {
    heatmap: (() => {
      const values = heatmap.flatMap((row) => row.cells.map((cell) => ({ param: row.param, station: cell.station, value: cell.value })))
        .filter((cell) => Number.isFinite(cell.value));
      const top = values.sort((a, b) => normalizeScore(b.param, b.value) - normalizeScore(a.param, a.value))[0];
      return top
        ? `As of ${currentMonthLabel}, ${top.station} has the strongest normalized signal: ${top.param} at ${fmt(top.value)}.`
        : 'No numeric station readings are available for the selected heatmap.';
    })(),
    'fecal-trophic': (() => {
      const top = [...pollutionMap].sort((a, b) => (b.fecal ?? -1) - (a.fecal ?? -1))[0];
      const po4Range = getValueRange(trophicData.map((row) => row.PO4));
      const no3Range = getValueRange(trophicData.map((row) => row.NO3));
      const fecalText = top ? `${top.stationData.stnId} has the highest fecal reading at ${fmt(top.fecal)} MPN/100mL` : 'no mapped fecal readings are available';
      const nutrientText = po4Range || no3Range
        ? `nutrient averages are PO4 ${fmt(po4Range?.avg)} mg/L and NO3-N ${fmt(no3Range?.avg)} mg/L`
        : 'nutrient indicators are not available';
      return `As of ${currentMonthLabel}, ${fecalText}; ${nutrientText}.`;
    })(),
    fecal: (() => {
      const top = [...pollutionMap].sort((a, b) => (b.fecal ?? -1) - (a.fecal ?? -1))[0];
      return top
        ? `As of ${currentMonthLabel}, ${top.stationData.stnId} has the highest fecal reading at ${fmt(top.fecal)} MPN/100mL.`
        : 'No fecal readings with mapped coordinates are available for this waterbody.';
    })(),
    trophic: (() => {
      const po4Range = getValueRange(trophicData.map((row) => row.PO4));
      const no3Range = getValueRange(trophicData.map((row) => row.NO3));
      return po4Range || no3Range
        ? `As of ${currentMonthLabel}, nutrient averages are PO4 ${fmt(po4Range?.avg)} mg/L and NO3-N ${fmt(no3Range?.avg)} mg/L across reporting stations.`
        : 'No current nutrient indicators are available for this waterbody.';
    })(),
    seasonal: seasonalData.length
      ? `The latest seasonal group with readings is ${seasonalData.at(-1).season}; fecal average is ${fmt(seasonalData.at(-1).Fecal)} MPN/100mL.`
      : 'No seasonal group has enough monthly readings to summarize.',
    radar: radarStations.length
      ? `${radarStations.length} stations are plotted using ${radarParams.length} normalized parameters.`
      : 'No station has enough current values for a radar profile.',
    scatter: (() => {
      const strongest = scatterSets
        .map((set) => ({ ...set, count: set.points.length }))
        .sort((a, b) => b.count - a.count)[0];
      return strongest?.count
        ? `${strongest.name} has ${strongest.count} paired station readings for relationship analysis.`
        : 'No parameter pairs currently have enough values for scatter analysis.';
    })(),
    forecast: forecastParamCandidates.length
      ? `${activeForecastStation?.stnId || 'Selected station'} has ${forecastParamCandidates.length} parameters with monthly readings. The first charts load immediately; expand only when more detail is needed.`
      : 'No monthly station readings are available for a forecast preview.',
  };

  // Result-and-observation narrative for the radar/spider chart, derived from the
  // selected waterbody's own readings so it reads like an analyst's summary.
  const radarAnalysis = (() => {
    if (!radarStations.length || !radarParams.length) {
      return 'There are not enough current station readings for this waterbody to build a radar profile yet.';
    }
    const stationScores = radarStations.map((station) => {
      const scores = radarParams
        .map((param) => normalizeScore(param, getCurrentParamValue(station, param, currentMonthIndex)))
        .filter((score) => Number.isFinite(score));
      const avg = scores.length ? scores.reduce((sum, score) => sum + score, 0) / scores.length : 0;
      return { stnId: station.stnId, avg };
    });
    const widest = [...stationScores].sort((a, b) => b.avg - a.avg)[0];
    const tightest = [...stationScores].sort((a, b) => a.avg - b.avg)[0];

    const paramStats = radarParams.map((param) => {
      const values = radarStations
        .map((station) => normalizeScore(param, getCurrentParamValue(station, param, currentMonthIndex)))
        .filter((score) => Number.isFinite(score));
      const max = values.length ? Math.max(...values) : 0;
      const min = values.length ? Math.min(...values) : 0;
      return { param, spread: max - min, max };
    });
    const dominant = [...paramStats].sort((a, b) => b.max - a.max)[0];
    const mostVaried = [...paramStats].sort((a, b) => b.spread - a.spread)[0];
    const name = selected?.name || 'this waterbody';

    const sentences = [
      `For ${name} as of ${currentMonthLabel}, ${widest.stnId} shows the most expanded profile — its readings sit highest overall across the ${radarParams.length} parameters compared.`,
    ];
    if (tightest && tightest.stnId !== widest.stnId) {
      sentences.push(`${tightest.stnId} keeps the most compact shape, suggesting generally lower or more balanced readings.`);
    }
    if (dominant) {
      sentences.push(`${dominant.param} stretches the chart out the most, so it is the parameter pushing stations toward their limits.`);
    }
    if (mostVaried && mostVaried.spread > 8 && mostVaried.param !== dominant?.param) {
      sentences.push(`${mostVaried.param} differs the most from one station to another, meaning the monitoring points disagree most on that measure.`);
    }
    sentences.push('Larger, more lopsided shapes are the ones worth checking first.');
    return sentences.join(' ');
  })();

  const narrative = type === 'radar' ? radarAnalysis : chartNarratives[type];
  const NarrativeNote = narrative ? (
    <div className="viz-narrative">
      <span className="viz-narrative-icon" aria-hidden="true">i</span>
      <div className="viz-narrative-body">
        <strong>{type === 'radar' ? 'Observation & analysis' : 'What this is telling you'}</strong>
        <p>{narrative}</p>
      </div>
    </div>
  ) : null;

  return (
    <div className="viz-page">
      <section className="viz-header">
        <div>
          <p>Water Quality Analytics</p>
          <h2>{titleMap[type]} · {visualizationYear}</h2>
        </div>
        <label>
          <span>Waterbody</span>
          <select value={activeWaterbodyKey} onChange={(event) => setWaterbodyKey(event.target.value)}>
            {groupWaterbodyByProvince(WATERBODIES).map(({ province, items }) => (
              <optgroup key={province} label={province}>
                {items.map((waterbody) => <option key={waterbody.key} value={waterbody.key}>{waterbody.name}</option>)}
              </optgroup>
            ))}
          </select>
        </label>
      </section>
      {(loading || error) && (
        <section className="viz-card">
          {loading ? (
            <div className="app-loading compact" role="status" aria-live="polite">
              <span />
              Loading WQM {visualizationYear} analytics data...
            </div>
          ) : (
            <p>{error}</p>
          )}
        </section>
      )}
      <section className="viz-card viz-definition">
        <div>
          <strong>Chart definition</strong>
          <p>{chartDefinitions[type]}</p>
        </div>
        <div>
          <strong>Current data analysis</strong>
          <p>{analysisMap[type]}</p>
        </div>
      </section>

      {type === 'heatmap' && (
        <section className="viz-card">
          <div className="heatmap-grid" style={{ '--station-count': heatmapStations.length }}>
            <span className="heatmap-corner">Parameter</span>
            {heatmapStations.map((station) => <span key={station.stnId} className="heatmap-head">{station.stnId}</span>)}
            {heatmap.map((row) => (
              <div className="heatmap-row" key={row.param}>
                <span className="heatmap-param">{row.param}</span>
                {row.cells.map((cell) => {
                  const score = normalizeScore(row.param, cell.value);
                  return <span key={`${row.param}-${cell.station}`} className="heatmap-cell" style={{ '--score': score }}>{fmt(cell.value)}</span>;
                })}
              </div>
            ))}
          </div>
          {NarrativeNote}
        </section>
      )}

      {(type === 'fecal' || type === 'fecal-trophic') && (
        <section className="viz-split">
          <article className="viz-card">
            <h3>Fecal Contamination Risk Timeline</h3>
            <ResponsiveContainer width="100%" height={310}>
              <AreaChart data={fecalTimeline}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="month" tick={CHART_TICK} />
                <YAxis tick={CHART_TICK} />
                <Tooltip />
                {fecalStations.map((station, index) => (
                  <Area key={station.stnId} dataKey={station.stnId} stroke={COLORS[index % COLORS.length]} fill={COLORS[index % COLORS.length]} fillOpacity={0.12} connectNulls />
                ))}
              </AreaChart>
            </ResponsiveContainer>
          </article>
          <article className="viz-card geo-card">
            <h3>Geospatial Pollution Map</h3>
            <Suspense fallback={<div className="viz-empty">Loading 3D pollution map...</div>}>
              <CesiumStationMap
                className="pollution-cesium-map"
                locations={pollutionMap}
                waterbodyName={selected?.name || 'Waterbody'}
                height={330}
                emptyMessage="No mapped fecal readings matched this waterbody."
              />
            </Suspense>
          </article>
          {NarrativeNote}
        </section>
      )}

      {(type === 'trophic' || type === 'fecal-trophic') && (
        <section className="viz-card">
          <h3>PO4, NO3-N, DO, and Temperature Indicators</h3>
          <ResponsiveContainer width="100%" height={360}>
            <BarChart data={trophicData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="station" tick={CHART_TICK} />
              <YAxis tick={CHART_TICK} />
              <Tooltip />
              <Legend wrapperStyle={LEGEND_STYLE} />
              <Bar dataKey="PO4" fill="#446ACB" />
              <Bar dataKey="NO3" fill="#7CB675" />
              <Bar dataKey="DO" fill="#e07b54" />
              <Bar dataKey="Temp" fill="#f59e0b" />
            </BarChart>
          </ResponsiveContainer>
          {NarrativeNote}
        </section>
      )}

      {type === 'seasonal' && (
        <section className="viz-card">
          <h3>Seasonal Decomposition Chart</h3>
          <ResponsiveContainer width="100%" height={350}>
            <BarChart data={seasonalData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="season" tick={CHART_TICK} />
              <YAxis tick={CHART_TICK} />
              <Tooltip />
              <Legend wrapperStyle={LEGEND_STYLE} />
              <Bar dataKey="DO" fill="#446ACB" />
              <Bar dataKey="TSS" fill="#7CB675" />
              <Bar dataKey="Fecal" fill="#e07b54" />
            </BarChart>
          </ResponsiveContainer>
          {NarrativeNote}
        </section>
      )}

      {type === 'radar' && (
        <section className="viz-card">
          <h3>Station Radar / Spider Chart</h3>
          <ResponsiveContainer width="100%" height={390}>
            <RadarChart data={radarData}>
              <PolarGrid />
              <PolarAngleAxis dataKey="param" tick={CHART_TICK} />
              <PolarRadiusAxis angle={30} domain={[0, 100]} tick={CHART_TICK} />
              <Legend wrapperStyle={LEGEND_STYLE} />
              <Tooltip />
              {radarStations.map((station, index) => (
                <Radar key={station.stnId} name={station.stnId} dataKey={station.stnId} stroke={COLORS[index]} fill={COLORS[index]} fillOpacity={0.12} />
              ))}
            </RadarChart>
          </ResponsiveContainer>
          {NarrativeNote}
        </section>
      )}

      {type === 'scatter' && (
        <section className="viz-stack scatter-grid">
          {scatterSets.map((set, setIndex) => (
            <article className="viz-card" key={set.name}>
              <h3>{set.name}</h3>
              <p>{set.note}</p>
              <ResponsiveContainer width="100%" height={300}>
                <ComposedChart>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis type="number" dataKey="x" name={set.xParam} tick={CHART_TICK} />
                  <YAxis type="number" dataKey="y" name={set.yParam} tick={CHART_TICK} />
                  <Tooltip cursor={{ strokeDasharray: '3 3' }} />
                  <Scatter data={set.points} fill={COLORS[setIndex]} />
                  <Line data={set.regression} dataKey="regression" stroke="#101F43" strokeWidth={2} dot={false} isAnimationActive />
                </ComposedChart>
              </ResponsiveContainer>
            </article>
          ))}
          {NarrativeNote}
        </section>
      )}

      {type === 'forecast' && (
        <section className="viz-card forecast-card">
          <div className="forecast-topline">
            <div>
              <h3>Station Parameter Forecasts</h3>
              <p>Forecasts use the selected station's monthly values using the Prophet additive engine (linear trend + seasonality + widening interval). Only the first charts render initially for faster loading.</p>
            </div>
            <Space className="forecast-controls" size="middle" wrap>
              {/* <label>
                <span>Forecast model</span>
                <Select
                  value={forecastEngine}
                  onChange={setForecastEngine}
                  options={Object.entries(FORECAST_ENGINES).map(([value, engine]) => ({
                    value,
                    label: engine.label,
                  }))}
                  classNames={{ popup: { root: 'wqm-map-select-popup' } }}
                  getPopupContainer={(trigger) => trigger.parentElement}
                />
              </label> */}
              <label>
                <span>Station</span>
                <Select
                  value={activeForecastStationKey}
                  onChange={setForecastStationKey}
                  options={forecastStations.map((station) => ({
                    value: getStationOptionKey(station),
                    label: station.stnId,
                  }))}
                  showSearch
                  optionFilterProp="label"
                  classNames={{ popup: { root: 'wqm-map-select-popup' } }}
                  getPopupContainer={(trigger) => trigger.parentElement}
                />
              </label>
              <Tag icon={<LineChartOutlined />} color="gold">{activeForecastLabel}</Tag>
            </Space>
          </div>
          {forecastParamCandidates.length ? (
            <div className="forecast-param-grid">
              {forecastCards.map((card) => (
                <Card
                  key={card.param}
                  className="forecast-param-card"
                  size="small"
                  hoverable
                  role="button"
                  tabIndex={0}
                  title="Click to open full forecast details"
                  onClick={() => setForecastDetail(card)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      setForecastDetail(card);
                    }
                  }}
                  style={{ '--fc-accent': card.color }}
                >
                  <div className="forecast-param-head">
                    <div>
                      <h4>{card.param}</h4>
                      <p>{activeForecastStation?.stnId} · {card.observed.length} months · +{forecastMonths}mo forecast</p>
                    </div>
                    <Statistic value={fmt(card.diagnostics.latest)} valueStyle={{ color: card.color }} />
                  </div>
                  <div className="forecast-tech-grid compact">
                    <Card size="small">
                      <Statistic title="Slope" value={fmt(card.diagnostics.slope)} />
                      <small>{card.diagnostics.trend}</small>
                    </Card>
                    <Card size="small">
                      <Statistic title="RMSE" value={fmt(card.diagnostics.rmse)} />
                      <small>residual error</small>
                    </Card>
                    <Card size="small">
                      <Statistic title="Confidence" value={card.diagnostics.confidence} suffix="%" />
                      <small>model fit</small>
                    </Card>
                  </div>
                  <ResponsiveContainer width="100%" height={170}>
                    <AreaChart data={card.data} margin={{ top: 4, right: 6, left: -18, bottom: 0 }}>
                      <defs>
                        <linearGradient id={`fcObs-${card.param.replace(/\W/g, '')}`} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor={card.color} stopOpacity={0.28} />
                          <stop offset="95%" stopColor={card.color} stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                      <XAxis dataKey="month" tick={CHART_TICK} tickLine={false} axisLine={false} />
                      <YAxis tick={CHART_TICK} tickLine={false} axisLine={false} width={42} />
                      <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} />
                      <Area dataKey="actual" name="Observed" stroke={card.color} strokeWidth={2} fill={`url(#fcObs-${card.param.replace(/\W/g, '')})`} isAnimationActive animationDuration={900} animationEasing="ease-out" connectNulls />
                      <Line dataKey="upper" name="Upper band" stroke="#f59e0b" strokeOpacity={0.4} strokeDasharray="2 3" dot={false} isAnimationActive animationDuration={900} animationBegin={300} animationEasing="ease-out" />
                      <Line dataKey="lower" name="Lower band" stroke="#f59e0b" strokeOpacity={0.4} strokeDasharray="2 3" dot={false} isAnimationActive animationDuration={900} animationBegin={300} animationEasing="ease-out" />
                      <Line dataKey="forecast" name="Forecast" stroke="#f59e0b" strokeWidth={2.4} strokeDasharray="6 4" dot={<ForecastDot />} isAnimationActive animationDuration={1100} animationBegin={500} animationEasing="ease-out" />
                    </AreaChart>
                  </ResponsiveContainer>
                </Card>
              ))}
              {!!hiddenForecastCount && (
                <Button type="dashed" block className="forecast-load-more" onClick={() => setForecastExpandedKey(forecastScopeKey)}>
                  Show {hiddenForecastCount} more forecast charts
                </Button>
              )}
            </div>
          ) : (
            <div className="viz-empty">No station parameters with monthly values are available for this waterbody.</div>
          )}
          {NarrativeNote}
        </section>
      )}

      <Modal
        className="forecast-detail-modal"
        open={Boolean(forecastDetail)}
        onCancel={() => setForecastDetail(null)}
        width="min(920px, 96vw)"
        destroyOnHidden
        title={forecastDetail ? `${forecastDetail.param} · ${activeForecastStation?.stnId || ''}` : ''}
        footer={<Button onClick={() => setForecastDetail(null)}>Close</Button>}
      >
        {forecastDetail && (
          <div className="forecast-detail-body">
            <div className="forecast-detail-stats">
              <span>Latest: <strong>{fmt(forecastDetail.diagnostics.latest)}</strong></span>
              <span>Trend: <strong>{forecastDetail.diagnostics.trend}</strong></span>
              <span>Model fit: <strong>{forecastDetail.diagnostics.confidence}%</strong></span>
              <span>Horizon: <strong>+{forecastDetail.forecastPoints.length} months</strong></span>
            </div>
            <ResponsiveContainer width="100%" height={320}>
              <AreaChart data={forecastDetail.data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="fcDetailObs" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={forecastDetail.color} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={forecastDetail.color} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="month" tick={CHART_TICK} />
                <YAxis tick={CHART_TICK} width={48} />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                <Legend wrapperStyle={LEGEND_STYLE} />
                <Area dataKey="actual" name="Observed" stroke={forecastDetail.color} strokeWidth={2} fill="url(#fcDetailObs)" connectNulls isAnimationActive animationDuration={900} animationEasing="ease-out" />
                <Line dataKey="upper" name="Upper band" stroke="#f59e0b" strokeOpacity={0.4} strokeDasharray="2 3" dot={false} isAnimationActive animationDuration={900} animationBegin={250} animationEasing="ease-out" />
                <Line dataKey="lower" name="Lower band" stroke="#f59e0b" strokeOpacity={0.4} strokeDasharray="2 3" dot={false} isAnimationActive animationDuration={900} animationBegin={250} animationEasing="ease-out" />
                <Line dataKey="forecast" name="Forecast" stroke="#f59e0b" strokeWidth={2.4} strokeDasharray="6 4" dot={<ForecastDot />} isAnimationActive animationDuration={1100} animationBegin={500} animationEasing="ease-out" />
              </AreaChart>
            </ResponsiveContainer>
            <Table
              className="forecast-detail-table"
              size="small"
              rowKey="key"
              pagination={false}
              scroll={{ y: 280 }}
              dataSource={[
                ...forecastDetail.observed.map((point, index) => ({
                  key: `obs-${index}`,
                  month: point.month,
                  type: 'Observed',
                  value: point.actual,
                  lower: null,
                  upper: null,
                  confidence: null,
                })),
                ...forecastDetail.forecastPoints.map((point, index) => ({
                  key: `fc-${index}`,
                  month: point.month,
                  type: 'Forecast',
                  value: point.forecast,
                  lower: point.lower,
                  upper: point.upper,
                  confidence: point.confidence,
                })),
              ]}
              columns={[
                { title: 'Month', dataIndex: 'month', key: 'month' },
                {
                  title: 'Type',
                  dataIndex: 'type',
                  key: 'type',
                  render: (value) => <Tag color={value === 'Forecast' ? 'gold' : 'blue'}>{value}</Tag>,
                },
                { title: 'Value', dataIndex: 'value', key: 'value', render: (value) => fmt(value) },
                {
                  title: 'Lower',
                  dataIndex: 'lower',
                  key: 'lower',
                  render: (value) => (value === null || value === undefined ? '—' : fmt(value)),
                },
                {
                  title: 'Upper',
                  dataIndex: 'upper',
                  key: 'upper',
                  render: (value) => (value === null || value === undefined ? '—' : fmt(value)),
                },
                {
                  title: 'Confidence',
                  dataIndex: 'confidence',
                  key: 'confidence',
                  render: (value) => (value === null || value === undefined ? '—' : `${value}%`),
                },
              ]}
            />
          </div>
        )}
      </Modal>
    </div>
  );
};

export default VisualizationView;
