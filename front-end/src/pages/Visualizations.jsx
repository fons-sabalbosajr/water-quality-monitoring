import { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, ComposedChart, Legend,
  Line, PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart,
  ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis,
} from 'recharts';
import stationWorkbookUrl from '../../docs/wqm_stations.xlsx?url';
import {
  MONTHS_SHORT, PARAM_LIMITS, fmt, getAvailableParams,
  getLatestNumber, getMonthlyNumber, getParamData,
} from '../utils/wqmData';
import { buildWaterbodyOptions, getReadableStations, usePublishedWqmDataset } from '../utils/wqmSheets';
import './Visualizations.css';

const COLORS = ['#446ACB', '#7CB675', '#e07b54', '#a78bfa', '#f59e0b', '#06b6d4', '#ec4899', '#84cc16'];
const CHART_TICK = { fontSize: 10 };
const LEGEND_STYLE = { fontSize: '0.68rem' };
const MAP_TILE_SIZE = 256;
const MAP_VIEW = { width: 640, height: 330 };
const MAP_LAYERS = {
  standard: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  humanitarian: 'https://tile.openstreetmap.fr/hot/{z}/{x}/{y}.png',
};

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

const buildTechnicalForecast = (observed) => {
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

  const points = Array.from({ length: 3 }, (_, index) => {
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

const projectMapPoint = (lat, lng, zoom) => {
  const safeLat = Math.max(Math.min(lat, 85.05112878), -85.05112878);
  const scale = MAP_TILE_SIZE * (2 ** zoom);
  const sinLat = Math.sin((safeLat * Math.PI) / 180);
  return {
    x: ((lng + 180) / 360) * scale,
    y: (0.5 - (Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI))) * scale,
  };
};

const getMapZoom = (bounds) => {
  const northWest = projectMapPoint(bounds.maxLat, bounds.minLng, 0);
  const southEast = projectMapPoint(bounds.minLat, bounds.maxLng, 0);
  const worldWidth = Math.max(Math.abs(southEast.x - northWest.x), 0.0001);
  const worldHeight = Math.max(Math.abs(southEast.y - northWest.y), 0.0001);
  const zoomX = Math.floor(Math.log2((MAP_VIEW.width * 0.82) / worldWidth));
  const zoomY = Math.floor(Math.log2((MAP_VIEW.height * 0.72) / worldHeight));
  return Math.max(8, Math.min(15, Math.min(zoomX, zoomY)));
};

const buildTileMap = (locations) => {
  if (!locations.length) return null;
  const lats = locations.map((point) => point.lat);
  const lngs = locations.map((point) => point.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const bounds = {
    minLat: minLat - Math.max((maxLat - minLat) * 0.22, 0.025),
    maxLat: maxLat + Math.max((maxLat - minLat) * 0.22, 0.025),
    minLng: minLng - Math.max((maxLng - minLng) * 0.22, 0.025),
    maxLng: maxLng + Math.max((maxLng - minLng) * 0.22, 0.025),
  };
  const zoom = getMapZoom(bounds);
  const center = projectMapPoint((bounds.minLat + bounds.maxLat) / 2, (bounds.minLng + bounds.maxLng) / 2, zoom);
  const origin = {
    x: center.x - (MAP_VIEW.width / 2),
    y: center.y - (MAP_VIEW.height / 2),
  };
  const startX = Math.floor(origin.x / MAP_TILE_SIZE);
  const endX = Math.floor((origin.x + MAP_VIEW.width) / MAP_TILE_SIZE);
  const startY = Math.floor(origin.y / MAP_TILE_SIZE);
  const endY = Math.floor((origin.y + MAP_VIEW.height) / MAP_TILE_SIZE);
  const maxTile = 2 ** zoom;
  const tiles = [];

  for (let x = startX; x <= endX; x += 1) {
    for (let y = startY; y <= endY; y += 1) {
      if (y >= 0 && y < maxTile) {
        const wrappedX = ((x % maxTile) + maxTile) % maxTile;
        tiles.push({
          key: `${zoom}-${wrappedX}-${y}`,
          url: MAP_LAYERS.standard.replace('{z}', zoom).replace('{x}', wrappedX).replace('{y}', y),
          left: (x * MAP_TILE_SIZE) - origin.x,
          top: (y * MAP_TILE_SIZE) - origin.y,
        });
      }
    }
  }

  const pins = locations.map((point, index) => {
    const projected = projectMapPoint(point.lat, point.lng, zoom);
    return {
      ...point,
      color: COLORS[index % COLORS.length],
      left: projected.x - origin.x,
      top: projected.y - origin.y,
    };
  });

  return { tiles, pins, zoom };
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
  forecast: 'Short horizon projection from the latest available monthly trend. This is a local linear preview until the AI forecasting model is configured.',
};

const loadLocations = async () => {
  const response = await fetch(stationWorkbookUrl);
  const buffer = await response.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });
  const workbookSheet = workbook.Sheets.Station_List || workbook.Sheets[workbook.SheetNames[0]];
  return XLSX.utils.sheet_to_json(workbookSheet, { defval: '' })
    .map((row) => ({
      id: row.ID,
      station: String(row.Station || '').trim(),
      waterbodyLoc: String(row['Waterbody Loc'] || '').trim(),
      waterbodyRiver: String(row.Waterbody || row['Waterbody River'] || row['Waterbody river'] || '').trim(),
      barangay: String(row.Barangay || '').trim(),
      province: String(row.Province || '').trim(),
      lat: Number(row.LAT),
      lng: Number(row.LONG),
    }))
    .filter((row) => Number.isFinite(row.lat) && Number.isFinite(row.lng));
};

const VisualizationView = ({ type }) => {
  const { year: visualizationYear, sheets, loading, error } = usePublishedWqmDataset();
  const WATERBODIES = useMemo(() => buildWaterbodyOptions(sheets), [sheets]);
  const [waterbodyKey, setWaterbodyKey] = useState(WATERBODIES[0]?.key || '');
  const [stationLocations, setStationLocations] = useState([]);
  const activeWaterbodyKey = WATERBODIES.some((waterbody) => waterbody.key === waterbodyKey)
    ? waterbodyKey
    : (WATERBODIES[0]?.key || '');
  const selected = WATERBODIES.find((waterbody) => waterbody.key === activeWaterbodyKey) || WATERBODIES[0];
  const selectedSheet = sheets.find((sheet) => sheet.key === selected?.key);
  const stations = useMemo(() => getReadableStations(selectedSheet), [selectedSheet]);
  const params = useMemo(() => getAvailableParams(stations, false), [stations]);
  const [forecastStationKey, setForecastStationKey] = useState('');
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
    loadLocations().then((locations) => {
      if (!cancelled) setStationLocations(locations);
    }).catch(() => {
      if (!cancelled) setStationLocations([]);
    });
    return () => { cancelled = true; };
  }, []);

  const matchedLocations = useMemo(() => {
    const waterbodyMatches = getWaterbodyMatches(activeWaterbodyKey, selected?.name);
    const idPrefix = getLocationIdPrefix(activeWaterbodyKey);
    const stationNames = stations.map((station) => normalizeForMatch(station.stnId));
    const stationMatches = (location) => {
      const stn = normalizeForMatch(location.station);
      return !stn || stationNames.some((name) => name && (stn === name || stn.includes(name) || name.includes(stn)));
    };
    const matchedByRiver = stationLocations.filter((location) => isWaterbodyMatch(location, waterbodyMatches)).filter(stationMatches);
    if (matchedByRiver.length) return matchedByRiver;

    const matchedByIdPrefix = stationLocations.filter((location) => (
      idPrefix && String(location.id || '').toUpperCase().startsWith(`${idPrefix}_`)
    ));
    if (matchedByIdPrefix.length) return matchedByIdPrefix;

    return stationLocations.filter(stationMatches);
  }, [activeWaterbodyKey, selected?.name, stationLocations, stations]);

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
  const tileMap = buildTileMap(pollutionMap);

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
  const forecastCards = useMemo(() => {
    if (!activeForecastStation) return [];

    return params
      .filter((param) => hasMonthlyParamReading(activeForecastStation, param))
      .map((param) => {
        const observed = MONTHS_SHORT.map((month, index) => ({
          month,
          actual: getMonthlyNumber(getParamData(activeForecastStation, param), index),
        })).filter((point) => point.actual !== null);
        const technical = buildTechnicalForecast(observed);
        return {
          param,
          observed,
          diagnostics: technical.diagnostics,
          data: observed.concat(technical.points),
        };
      })
      .filter((card) => card.observed.length);
  }, [activeForecastStation, params]);
  const activeForecastLabel = 'Technical local model';

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
    forecast: forecastCards.length
      ? `${activeForecastStation?.stnId || 'Selected station'} has ${forecastCards.length} parameters with monthly readings. Each chart shows observed station values and the next three projected points.`
      : 'No monthly station readings are available for a forecast preview.',
  };

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
            {WATERBODIES.map((waterbody) => <option key={waterbody.key} value={waterbody.key}>{waterbody.name}</option>)}
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
            {tileMap ? (
              <div className="pollution-map">
                {tileMap.tiles.map((tile) => (
                  <img
                    key={tile.key}
                    className="pollution-tile"
                    src={tile.url}
                    alt=""
                    style={{ left: tile.left, top: tile.top }}
                    loading="lazy"
                  />
                ))}
                {tileMap.pins.map((point) => (
                  <span
                    key={`${point.id}-${point.lat}`}
                    className="pollution-point"
                    style={{
                      left: `${point.left}px`,
                      top: `${point.top}px`,
                      '--risk': Math.max(point.risk, 8),
                      '--point-color': point.color,
                    }}
                    title={`${point.stationData?.stnId || point.station || point.id}: ${fmt(point.fecal)} MPN/100mL`}
                  >
                    <b>{point.stationData?.stnId || point.station || point.id}</b>
                  </span>
                ))}
              </div>
            ) : <div className="viz-empty">No mapped fecal readings matched this waterbody.</div>}
          </article>
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
        </section>
      )}

      {type === 'forecast' && (
        <section className="viz-card forecast-card">
          <div className="forecast-topline">
            <div>
              <h3>Station Parameter Forecasts</h3>
              <p>Forecasts use the selected station's monthly values, ordinary least squares trend, and RMSE uncertainty band for each available parameter.</p>
            </div>
            <div className="forecast-controls">
              <label>
                <span>Station</span>
                <select value={activeForecastStationKey} onChange={(event) => setForecastStationKey(event.target.value)}>
                  {forecastStations.map((station) => (
                    <option key={getStationOptionKey(station)} value={getStationOptionKey(station)}>
                      {station.stnId}
                    </option>
                  ))}
                </select>
              </label>
              <b>{activeForecastLabel}</b>
            </div>
          </div>
          {forecastCards.length ? (
            <div className="forecast-param-grid">
              {forecastCards.map((card) => (
                <article key={card.param} className="forecast-param-card">
                  <div className="forecast-param-head">
                    <div>
                      <h4>{card.param}</h4>
                      <p>{activeForecastStation?.stnId} · {card.observed.length} monthly values</p>
                    </div>
                    <strong>{fmt(card.diagnostics.latest)}</strong>
                  </div>
                  <div className="forecast-tech-grid compact">
                    <article>
                      <span>Slope</span>
                      <strong>{fmt(card.diagnostics.slope)}</strong>
                      <small>{card.diagnostics.trend}</small>
                    </article>
                    <article>
                      <span>RMSE</span>
                      <strong>{fmt(card.diagnostics.rmse)}</strong>
                      <small>residual error</small>
                    </article>
                    <article>
                      <span>Confidence</span>
                      <strong>{card.diagnostics.confidence}%</strong>
                      <small>{card.diagnostics.method}</small>
                    </article>
                  </div>
                  <ResponsiveContainer width="100%" height={260}>
                    <AreaChart data={card.data}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                      <XAxis dataKey="month" tick={CHART_TICK} />
                      <YAxis tick={CHART_TICK} />
                      <Tooltip />
                      <Area dataKey="actual" name="Observed station value" stroke="#446ACB" fill="#446ACB" fillOpacity={0.14} isAnimationActive animationDuration={800} />
                      <Line dataKey="upper" name="Upper RMSE band" stroke="#f59e0b" strokeOpacity={0.42} strokeDasharray="3 3" dot={false} isAnimationActive animationDuration={900} />
                      <Line dataKey="lower" name="Lower RMSE band" stroke="#f59e0b" strokeOpacity={0.42} strokeDasharray="3 3" dot={false} isAnimationActive animationDuration={900} />
                      <Area dataKey="forecast" name="Forecast" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.16} strokeDasharray="6 4" isAnimationActive animationDuration={1100} />
                    </AreaChart>
                  </ResponsiveContainer>
                </article>
              ))}
            </div>
          ) : (
            <div className="viz-empty">No station parameters with monthly values are available for this waterbody.</div>
          )}
        </section>
      )}
    </div>
  );
};

export default VisualizationView;
