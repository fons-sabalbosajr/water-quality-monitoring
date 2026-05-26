import { Fragment, Suspense, lazy, useState, useRef, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import * as XLSX from 'xlsx';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, LabelList,
} from 'recharts';
import stationWorkbookUrl from '../../docs/wqm_stations.xlsx?url';
import bagongLogo from '../assets/bagongpilipinaslogo.png';
import embLogo from '../assets/emblogo.svg';
import WQM2026 from './WQM2026';
import Settings from './Settings';
import WaterbodyProfile from './WaterbodyProfile';
import VisualizationView from './Visualizations';
import { logActivity } from '../utils/appLog';
import {
  IcoDashboard, IcoTable, IcoWater, IcoSettings,
  IcoChevronDown, IcoChevronRight, IcoCalendar,
  IcoSun, IcoMoon, IcoLogout, IcoMapPin,
  IcoWaves, IcoBoat, IcoAlertTriangle, IcoCheckCircle, IcoEye,
} from '../components/Icons';
import {
  MONTHS_SHORT, PARAM_LIMITS, PARAM_ORDER, fmt, fmtWithUnit, getAvailableParams,
  getAverageNumber, getGaugePercent, getLatestNumber, getMonthlyNumber, getObservationEntries,
  getParamData, getParamStatus, getParamUnit,
} from '../utils/wqmData';
import {
  buildWaterbodyOptions, getReadableStations, groupWaterbodyOptions, usePublishedWqmDataset,
} from '../utils/wqmSheets';
import './Home.css';

const Waterbody3DMap = lazy(() => import('./Waterbody3DMap'));

/* ── Constants ── */
const CHART_PARAMS = PARAM_ORDER;

const CHART_COLORS = [
  '#446ACB','#7CB675','#e07b54','#a78bfa','#f59e0b',
  '#06b6d4','#ec4899','#84cc16','#f97316','#64748b','#10b981',
];

const normalizeForMatch = (value) => String(value || '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

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

const MAP_TILE_SIZE = 256;
const MAP_VIEW = { width: 720, height: 360 };
const MAP_LAYERS = {
  standard: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  humanitarian: 'https://tile.openstreetmap.fr/hot/{z}/{x}/{y}.png',
};

const MAP_LAYER_OPTIONS = [
  ['standard', 'Standard'],
  ['humanitarian', 'Humanitarian'],
];

const buildStationTrendData = (stationSeries, param) => MONTHS_SHORT.map((label, monthIndex) => {
  const point = { label };
  stationSeries.forEach(({ station, chartKey }) => {
    point[chartKey] = getMonthlyNumber(getParamData(station, param), monthIndex);
  });
  return point;
}).filter((point) => stationSeries.some(({ chartKey }) => point[chartKey] !== null && point[chartKey] !== undefined));

const hasMonthlyParamReading = (stations, param) => stations.some((station) => (
  MONTHS_SHORT.some((_, monthIndex) => getMonthlyNumber(getParamData(station, param), monthIndex) !== null)
));

const buildStationGaugeData = (stations, params) => stations.map((station) => ({
  station,
  metrics: params.map((param) => {
    const value = getLatestNumber(getParamData(station, param));
    return {
      param,
      value,
      percent: getGaugePercent(param, value),
      status: getParamStatus(param, value),
      unit: PARAM_LIMITS[param]?.unit || '',
      label: PARAM_LIMITS[param]?.unit ? fmtWithUnit(value, param) : fmt(value),
      verdict: getParamStatus(param, value) === 'alert' ? 'Failed' : 'Pass',
    };
  }).filter((metric) => metric.value !== null),
}));

const getLatestMonthLabel = (stations, params, year = 2026) => {
  for (let monthIndex = MONTHS_SHORT.length - 1; monthIndex >= 0; monthIndex -= 1) {
    const hasReading = stations.some((station) => params.some((param) => (
      getMonthlyNumber(getParamData(station, param), monthIndex) !== null
    )));
    if (hasReading) return `${MONTHS_SHORT[monthIndex]} ${year}`;
  }
  return `Annual ${year}`;
};

const pearson = (pairs) => {
  if (pairs.length < 2) return null;
  const xs = pairs.map(([x]) => x);
  const ys = pairs.map(([, y]) => y);
  const xMean = xs.reduce((sum, value) => sum + value, 0) / xs.length;
  const yMean = ys.reduce((sum, value) => sum + value, 0) / ys.length;
  const numerator = pairs.reduce((sum, [x, y]) => sum + ((x - xMean) * (y - yMean)), 0);
  const xDen = Math.sqrt(xs.reduce((sum, value) => sum + ((value - xMean) ** 2), 0));
  const yDen = Math.sqrt(ys.reduce((sum, value) => sum + ((value - yMean) ** 2), 0));
  if (!xDen || !yDen) return null;
  return numerator / (xDen * yDen);
};

const buildCorrelationMatrix = (stations, params) => {
  const selectedParams = params.slice(0, 6);
  return selectedParams.map((rowParam) => ({
    param: rowParam,
    cells: selectedParams.map((colParam) => {
      const monthlyPairs = stations.flatMap((station) => {
        const rowData = getParamData(station, rowParam);
        const colData = getParamData(station, colParam);
        return Array.from({ length: 12 }, (_, monthIndex) => [
          getMonthlyNumber(rowData, monthIndex),
          getMonthlyNumber(colData, monthIndex),
        ]).filter(([x, y]) => x !== null && y !== null);
      });
      const annualPairs = stations
        .map((station) => [
          getAverageNumber(getParamData(station, rowParam)),
          getAverageNumber(getParamData(station, colParam)),
        ])
        .filter(([x, y]) => x !== null && y !== null);
      const pairs = monthlyPairs.length >= 2 ? monthlyPairs : annualPairs;
      return {
        rowParam,
        colParam,
        value: rowParam === colParam ? 1 : pearson(pairs),
      };
    }),
  }));
};

const getCorrelationColor = (value) => {
  if (value === null) return 'rgba(148,163,184,0.18)';
  const intensity = Math.min(Math.abs(value), 1);
  if (value >= 0) return `rgba(68,106,203,${0.16 + intensity * 0.68})`;
  return `rgba(224,123,84,${0.16 + intensity * 0.68})`;
};

const getCorrelationInterpretation = (matrix) => {
  const pairs = matrix.flatMap((row) => row.cells
    .filter((cell) => cell.rowParam !== cell.colParam && cell.value !== null)
    .map((cell) => cell));

  if (!pairs.length) return 'Not enough paired station values are available to calculate relationships for this waterbody.';

  const strongestPositive = pairs
    .filter((cell) => cell.value > 0)
    .sort((a, b) => b.value - a.value)[0];
  const strongestNegative = pairs
    .filter((cell) => cell.value < 0)
    .sort((a, b) => a.value - b.value)[0];

  const parts = [];
  if (strongestPositive) {
    parts.push(`${strongestPositive.rowParam} and ${strongestPositive.colParam} move together most strongly (r=${strongestPositive.value.toFixed(2)}).`);
  }
  if (strongestNegative) {
    parts.push(`${strongestNegative.rowParam} and ${strongestNegative.colParam} show the strongest inverse movement (r=${strongestNegative.value.toFixed(2)}).`);
  }

  return parts.join(' ');
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

const buildTileMap = (bounds, locations, zoomDelta = 0, layer = 'standard', pan = { x: 0, y: 0 }) => {
  if (!bounds || !locations.length) return null;
  const zoom = Math.max(8, Math.min(17, getMapZoom(bounds) + zoomDelta));
  const centerLat = (bounds.minLat + bounds.maxLat) / 2;
  const centerLng = (bounds.minLng + bounds.maxLng) / 2;
  const center = projectMapPoint(centerLat, centerLng, zoom);
  const origin = {
    x: center.x - (MAP_VIEW.width / 2) - pan.x,
    y: center.y - (MAP_VIEW.height / 2) - pan.y,
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
          url: (MAP_LAYERS[layer] || MAP_LAYERS.standard)
            .replace('{z}', zoom)
            .replace('{x}', wrappedX)
            .replace('{y}', y),
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
      color: CHART_COLORS[index % CHART_COLORS.length],
      left: projected.x - origin.x,
      top: projected.y - origin.y,
    };
  });

  return { tiles, pins, zoom };
};

const getObservationMeta = (value) => {
  const text = String(value || '').toLowerCase();
  if (/dead|kill|oil|grease|sewage|garbage|trash|foul|odor|black|foam/.test(text)) {
    return { label: 'Critical', status: 'critical', icon: <IcoAlertTriangle size={16} /> };
  }
  if (/high\s*tide|low\s*tide|tide|rain|flood|turbid|muddy|construction/.test(text)) {
    return { label: /high\s*tide/.test(text) ? 'High Tide' : /low\s*tide/.test(text) ? 'Low Tide' : 'Watch', status: 'watch', icon: <IcoWaves size={16} /> };
  }
  if (/boat|fishing|fishers|vessel|banca/.test(text)) {
    return { label: 'Boat Activity', status: 'watch', icon: <IcoBoat size={16} /> };
  }
  if (/clear|normal|good|stable|none|no /.test(text)) {
    return { label: 'Good', status: 'good', icon: <IcoCheckCircle size={16} /> };
  }
  return { label: 'Observed', status: 'observed', icon: <IcoEye size={16} /> };
};

const TrendValueLabel = ({ x, y, value, color, seriesIndex = 0, pointIndex = 0 }) => {
  if (!Number.isFinite(value) || x === undefined || y === undefined) return null;
  const slots = [
    { dx: -30, dy: -24, anchor: 'end' },
    { dx: 30, dy: -24, anchor: 'start' },
    { dx: -30, dy: 26, anchor: 'end' },
    { dx: 30, dy: 26, anchor: 'start' },
  ];
  const slot = slots[(seriesIndex + pointIndex) % slots.length];
  const labelX = x + slot.dx;
  const labelY = y + slot.dy;

  return (
    <g className="trend-value-label">
      <line x1={x} y1={y} x2={labelX} y2={labelY} stroke={color} strokeWidth="1.2" strokeDasharray="3 2" />
      <circle cx={x} cy={y} r="2" fill={color} />
      <text x={labelX} y={labelY} textAnchor={slot.anchor} dominantBaseline="middle" fill="var(--text-primary)">
        {fmt(value)}
      </text>
    </g>
  );
};

/* ── Dashboard overview ── */
const DashboardView = () => {
  const { year, sheets, loading, error } = usePublishedWqmDataset();
  const WATERBODIES = useMemo(() => (
    buildWaterbodyOptions(sheets)
  ), [sheets]);
  const groupedWaterbodies = useMemo(() => groupWaterbodyOptions(WATERBODIES), [WATERBODIES]);
  const [selectedWaterbody, setSelectedWaterbody] = useState(WATERBODIES[0]?.key || '');
  const [chartParam, setChartParam] = useState(CHART_PARAMS[0]);
  const [selectedObservationMonth, setSelectedObservationMonth] = useState('');
  const [mapStationFilter, setMapStationFilter] = useState('all');
  const [mapZoomDelta, setMapZoomDelta] = useState(0);
  const [mapLayer, setMapLayer] = useState('standard');
  const [mapShowLabels, setMapShowLabels] = useState(true);
  const [selectedMapPin, setSelectedMapPin] = useState(null);
  const [mapPan, setMapPan] = useState({ x: 0, y: 0 });
  const [isMapDragging, setIsMapDragging] = useState(false);
  const [stationLocations, setStationLocations] = useState([]);
  const { theme } = useTheme();
  const mapDragRef = useRef(null);
  const activeWaterbodyKey = WATERBODIES.some((waterbody) => waterbody.key === selectedWaterbody)
    ? selectedWaterbody
    : (WATERBODIES[0]?.key || '');

  const sheet = sheets.find((item) => item.key === activeWaterbodyKey);
  const selectedInfo = WATERBODIES.find((waterbody) => waterbody.key === activeWaterbodyKey) || WATERBODIES[0];
  const stations = useMemo(() => getReadableStations(sheet), [sheet]);
  const availableParams = useMemo(() => getAvailableParams(stations, false), [stations]);
  const chartParams = useMemo(
    () => availableParams.filter((param) => hasMonthlyParamReading(stations, param)),
    [availableParams, stations]
  );
  const activeParam = chartParams.includes(chartParam) ? chartParam : (chartParams[0] || '');
  const activeUnit = getParamUnit(activeParam);
  const stationSeries = useMemo(() => stations.map((station, index) => ({
    station,
    chartKey: `station_${index}`,
    color: CHART_COLORS[index % CHART_COLORS.length],
  })), [stations]);
  const trendData = useMemo(
    () => (activeParam ? buildStationTrendData(stationSeries, activeParam) : []),
    [activeParam, stationSeries]
  );
  const gaugeParams = useMemo(() => (
    availableParams.filter((param) => stations.some((station) => getLatestNumber(getParamData(station, param)) !== null))
  ), [availableParams, stations]);
  const stationGaugeData = useMemo(
    () => buildStationGaugeData(stations, gaugeParams),
    [gaugeParams, stations]
  );
  const gaugeAsOf = useMemo(() => getLatestMonthLabel(stations, gaugeParams, year), [gaugeParams, stations, year]);
  const correlationParams = useMemo(() => availableParams.slice(0, 6), [availableParams]);
  const correlationMatrix = useMemo(
    () => buildCorrelationMatrix(stations, correlationParams),
    [correlationParams, stations]
  );
  const correlationInterpretation = useMemo(
    () => getCorrelationInterpretation(correlationMatrix),
    [correlationMatrix]
  );
  const observations = useMemo(() => getObservationEntries(stations), [stations]);
  const observationMonths = useMemo(() => [...new Map(
    [...observations]
      .sort((a, b) => a.monthIndex - b.monthIndex)
      .map((entry) => [entry.month, entry])
  ).values()].map((entry) => ({ month: entry.month, monthIndex: entry.monthIndex })), [observations]);
  const activeObservationMonth = observationMonths.some((entry) => entry.month === selectedObservationMonth)
    ? selectedObservationMonth
    : (observationMonths[0]?.month || '');
  const filteredObservations = useMemo(
    () => observations.filter((entry) => !activeObservationMonth || entry.month === activeObservationMonth),
    [activeObservationMonth, observations]
  );
  const lastTrendIndexByKey = useMemo(() => stationSeries.reduce((lookup, { chartKey }) => {
    for (let index = trendData.length - 1; index >= 0; index -= 1) {
      if (trendData[index][chartKey] !== null && trendData[index][chartKey] !== undefined) {
        lookup[chartKey] = index;
        break;
      }
    }
    return lookup;
  }, {}), [stationSeries, trendData]);
  const gridColor = theme === 'dark' ? '#2d4a6a' : '#E2E8F6';
  const textColor = theme === 'dark' ? '#94a3b8' : '#64748b';

  useEffect(() => {
    let cancelled = false;

    const loadStationLocations = async () => {
      try {
        const response = await fetch(stationWorkbookUrl);
        const buffer = await response.arrayBuffer();
        const workbook = XLSX.read(buffer, { type: 'array' });
        const workbookSheet = workbook.Sheets.Station_List || workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(workbookSheet, { defval: '' });
        const locations = rows
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

        if (!cancelled) setStationLocations(locations);
      } catch {
        if (!cancelled) setStationLocations([]);
      }
    };

    loadStationLocations();
    return () => { cancelled = true; };
  }, []);

  const selectedLocations = useMemo(() => {
    const waterbodyMatches = getWaterbodyMatches(activeWaterbodyKey, selectedInfo?.name);
    const idPrefix = getLocationIdPrefix(activeWaterbodyKey);
    const stationNames = stations.map((station) => normalizeForMatch(station.stnId));
    const stationMatches = (location) => {
      const workbookStation = normalizeForMatch(location.station);
      return !workbookStation || stationNames.some((stationName) => stationName && (
        workbookStation === stationName
        || workbookStation.includes(stationName)
        || stationName.includes(workbookStation)
      ));
    };
    const matchedByRiver = stationLocations
      .filter((location) => isWaterbodyMatch(location, waterbodyMatches))
      .filter(stationMatches);

    if (matchedByRiver.length) return matchedByRiver;

    const matchedByIdPrefix = stationLocations.filter((location) => (
      idPrefix && String(location.id || '').toUpperCase().startsWith(`${idPrefix}_`)
    ));
    if (matchedByIdPrefix.length) return matchedByIdPrefix;

    return stationLocations.filter((location) => {
      const workbookStation = normalizeForMatch(location.station);
      return stationNames.some((stationName) => stationName && (
        workbookStation.includes(stationName) || stationName.includes(workbookStation)
      ));
    });
  }, [activeWaterbodyKey, selectedInfo?.name, stationLocations, stations]);

  const activeMapStationFilter = mapStationFilter === 'all'
    || selectedLocations.some((location) => String(location.id) === mapStationFilter)
    ? mapStationFilter
    : 'all';
  const filteredMapLocations = useMemo(() => {
    if (activeMapStationFilter === 'all') return selectedLocations;
    return selectedLocations.filter((location) => String(location.id) === activeMapStationFilter);
  }, [activeMapStationFilter, selectedLocations]);

  const mapBounds = useMemo(() => {
    if (!filteredMapLocations.length) return null;
    const lats = filteredMapLocations.map((point) => point.lat);
    const lngs = filteredMapLocations.map((point) => point.lng);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);
    const latPad = Math.max((maxLat - minLat) * 0.22, 0.025);
    const lngPad = Math.max((maxLng - minLng) * 0.22, 0.025);
    return {
      minLat: minLat - latPad,
      maxLat: maxLat + latPad,
      minLng: minLng - lngPad,
      maxLng: maxLng + lngPad,
    };
  }, [filteredMapLocations]);

  const tileMap = useMemo(() => buildTileMap(mapBounds, filteredMapLocations, mapZoomDelta, mapLayer, mapPan), [filteredMapLocations, mapBounds, mapLayer, mapPan, mapZoomDelta]);
  const activeMapPin = useMemo(() => {
    if (!selectedMapPin || !tileMap) return selectedMapPin;
    return tileMap.pins.find((point) => (
      String(point.id) === String(selectedMapPin.id)
      && point.lat === selectedMapPin.lat
      && point.lng === selectedMapPin.lng
    )) || selectedMapPin;
  }, [selectedMapPin, tileMap]);

  const mapCenter = activeMapPin || filteredMapLocations[0];
  const mapLink = mapCenter
    ? `https://www.openstreetmap.org/?mlat=${mapCenter.lat}&mlon=${mapCenter.lng}#map=13/${mapCenter.lat}/${mapCenter.lng}`
    : 'https://www.openstreetmap.org/';

  useEffect(() => {
    const endMapDrag = () => {
      mapDragRef.current = null;
      setIsMapDragging(false);
    };
    window.addEventListener('pointerup', endMapDrag);
    window.addEventListener('pointercancel', endMapDrag);
    return () => {
      window.removeEventListener('pointerup', endMapDrag);
      window.removeEventListener('pointercancel', endMapDrag);
    };
  }, []);

  if (loading) {
    return (
      <div className="app-loading compact" role="status" aria-live="polite">
        <span />
        Loading WQM {year} dashboard data...
      </div>
    );
  }

  if (error || !sheet) {
    return <div className="map-empty-state">{error || `No WQM ${year} dashboard data is available.`}</div>;
  }

  return (
  <div className="dashboard-overview">
    <section className="dashboard-control-header">
      <div>
        <p className="overview-eyebrow">CY {year} Monitoring Dashboard</p>
        <h2 className="overview-title">{selectedInfo?.name || 'Waterbody Dashboard'}</h2>
        <p className="overview-sub">Station trends, field notes, location data, and parameter relationships.</p>
      </div>
      <div className="dashboard-controls">
        <label>
          <span>Waterbody</span>
          <select
            value={activeWaterbodyKey}
            onChange={(event) => {
              setSelectedWaterbody(event.target.value);
              setMapStationFilter('all');
              setMapZoomDelta(0);
              setMapPan({ x: 0, y: 0 });
              setSelectedMapPin(null);
            }}
          >
            {groupedWaterbodies.map((group) => (
              <optgroup key={group.label} label={group.label}>
                {group.items.map((waterbody) => (
                  <option key={waterbody.key} value={waterbody.key}>{waterbody.name}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <label>
          <span>Parameter</span>
          <select value={activeParam} onChange={(event) => setChartParam(event.target.value)} disabled={!chartParams.length}>
            {chartParams.map((param) => (
              <option key={param} value={param}>{param}</option>
            ))}
          </select>
        </label>
      </div>
    </section>

    <section className="dashboard-summary-strip">
      <div><span className="summary-icon"><IcoWater size={16} /></span><strong>{stations.length}</strong><span>Stations</span></div>
      <div><span className="summary-icon"><IcoTable size={16} /></span><strong>{chartParams.length}</strong><span>Chart Parameters</span></div>
      <div><span className="summary-icon"><IcoDashboard size={16} /></span><strong>{selectedLocations.length || '—'}</strong><span>Mapped Locations</span></div>
      <div><span className="summary-icon"><IcoCalendar size={16} /></span><strong>{observations.length}</strong><span>Observations</span></div>
    </section>

    <section className="dashboard-primary-grid">
      <article className="chart-card station-trend-card">
        <div className="chart-card-header">
          <div>
            <h3 className="chart-title">Parameter Summary — Monthly Station Trends</h3>
            <p className="chart-sub">{activeParam}{activeUnit ? ` (${activeUnit})` : ''} readings per monitoring station · {selectedInfo?.name}</p>
          </div>
        </div>
        <div className="chart-wrap">
          {trendData.length ? (
          <ResponsiveContainer width="100%" height={340}>
            <AreaChart data={trendData} margin={{ top: 10, right: 16, left: 0, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: textColor }} tickLine={false} axisLine={false} />
              <YAxis
                tick={{ fontSize: 11, fill: textColor }}
                tickLine={false}
                axisLine={false}
                width={58}
                label={activeUnit ? { value: activeUnit, angle: -90, position: 'insideLeft', fill: textColor, fontSize: 11 } : undefined}
              />
              <Tooltip formatter={(value, name) => [fmtWithUnit(value, activeParam), name]} />
              {stationSeries.map(({ station, chartKey, color }) => (
                <Area
                  key={chartKey}
                  type="monotone"
                  dataKey={chartKey}
                  name={station.stnId}
                  stroke={color}
                  fill={color}
                  fillOpacity={0.1}
                  strokeWidth={2.2}
                  dot={(dotProps) => {
                    const { cx, cy, index } = dotProps;
                    if (cx === undefined || cy === undefined) return null;
                    const isLatest = lastTrendIndexByKey[chartKey] === index;
                    return (
                      <g>
                        {isLatest && <circle className="trend-pulse-ring" cx={cx} cy={cy} r="7" fill={color} />}
                        <circle className={isLatest ? 'trend-last-dot' : ''} cx={cx} cy={cy} r={isLatest ? 4.5 : 3} fill={color} stroke="var(--bg-card)" strokeWidth="2" />
                      </g>
                    );
                  }}
                  activeDot={{ r: 6 }}
                  connectNulls
                >
                  {/* <LabelList
                    dataKey={chartKey}
                    content={(labelProps) => (
                      <TrendValueLabel
                        {...labelProps}
                        color={color}
                        seriesIndex={seriesIndex}
                        pointIndex={labelProps.index || 0}
                      />
                    )}
                  /> */}
                </Area>
              ))}
            </AreaChart>
          </ResponsiveContainer>
          ) : (
            <div className="map-empty-state">No monthly parameter readings are available for this waterbody.</div>
          )}
        </div>
      </article>

      <article className="dash-panel map-panel">
        <div className="dash-panel-header">
          <div>
            <h3>Station Location Map</h3>
          </div>
          <a className="earth-open-link" href={mapLink} target="_blank" rel="noreferrer">Open Map</a>
        </div>
        <div className="map-tools">
          <label>
            <span>Station</span>
            <select
              value={activeMapStationFilter}
              onChange={(event) => {
                const nextId = event.target.value;
                setMapStationFilter(nextId);
                setSelectedMapPin(nextId === 'all' ? null : selectedLocations.find((location) => String(location.id) === nextId) || null);
              }}
            >
              <option value="all">All mapped stations</option>
              {selectedLocations.map((location) => (
                <option key={`${location.id}-${location.lat}-${location.lng}`} value={String(location.id)}>
                  {location.id} - {location.station || location.barangay || 'Station'}
                </option>
              ))}
            </select>
          </label>
          <div className="map-tool-actions" aria-label="Map tools">
            <button type="button" onClick={() => setMapZoomDelta((zoom) => Math.max(zoom - 1, -2))}>-</button>
            <span>{tileMap ? `Z${tileMap.zoom}` : 'Z-'}</span>
            <button type="button" onClick={() => setMapZoomDelta((zoom) => Math.min(zoom + 1, 3))}>+</button>
            <button type="button" className={mapShowLabels ? 'active' : ''} onClick={() => setMapShowLabels((show) => !show)}>Labels</button>
            <button type="button" onClick={() => { setMapStationFilter('all'); setMapZoomDelta(0); setMapPan({ x: 0, y: 0 }); setSelectedMapPin(null); }}>Reset</button>
          </div>
        </div>
        {tileMap ? (
          <div
            className={`osm-map-wrap${isMapDragging ? ' dragging' : ''}`}
            onPointerDown={(event) => {
              if (event.button !== 0 || event.target.closest('.map-pin, .map-layer-control, .map-station-card')) return;
              event.currentTarget.setPointerCapture?.(event.pointerId);
              mapDragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, pan: mapPan };
              setIsMapDragging(true);
            }}
            onPointerMove={(event) => {
              if (!mapDragRef.current || mapDragRef.current.pointerId !== event.pointerId) return;
              const dx = event.clientX - mapDragRef.current.x;
              const dy = event.clientY - mapDragRef.current.y;
              setMapPan({ x: mapDragRef.current.pan.x + dx, y: mapDragRef.current.pan.y + dy });
            }}
            onPointerUp={(event) => {
              event.currentTarget.releasePointerCapture?.(event.pointerId);
              mapDragRef.current = null;
              setIsMapDragging(false);
            }}
            onPointerCancel={() => {
              mapDragRef.current = null;
              setIsMapDragging(false);
            }}
            onWheel={(event) => {
              event.preventDefault();
              setMapZoomDelta((zoom) => Math.max(-2, Math.min(3, zoom + (event.deltaY < 0 ? 1 : -1))));
            }}
          >
            <div className="osm-map" role="img" aria-label={`${selectedInfo?.name} plotted station map`}>
              {tileMap.tiles.map((tile) => (
                <img
                  key={tile.key}
                  className="osm-tile"
                  src={tile.url}
                  alt=""
                  style={{ left: tile.left, top: tile.top }}
                  loading="lazy"
                />
              ))}
            </div>
            <div className="map-layer-control" aria-label="Map layers">
              {MAP_LAYER_OPTIONS.map(([layerKey, label]) => (
                <button
                  type="button"
                  key={layerKey}
                  className={mapLayer === layerKey ? 'active' : ''}
                  onClick={() => setMapLayer(layerKey)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="map-pin-layer">
              {tileMap.pins.map((point) => (
                <button
                  type="button"
                  key={`${point.id}-${point.lat}-${point.lng}`}
                  className={`map-pin${selectedMapPin?.id === point.id ? ' active' : ''}${mapShowLabels ? '' : ' labels-hidden'}`}
                  style={{ left: `${point.left}px`, top: `${point.top}px`, '--pin-color': point.color }}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation();
                    setSelectedMapPin(point);
                  }}
                  title={`${point.station || point.id} station details`}
                >
                  <b aria-hidden="true" />
                  <small>{point.station || point.barangay || 'Station'}</small>
                </button>
              ))}
            </div>
            {activeMapPin && (
              <div
                className="map-station-card"
                style={{
                  left: `${Math.min(Math.max(activeMapPin.left + 14, 12), MAP_VIEW.width - 238)}px`,
                  top: `${Math.min(Math.max(activeMapPin.top - 96, 12), MAP_VIEW.height - 128)}px`,
                }}
              >
                <button type="button" className="map-station-close" onClick={() => setSelectedMapPin(null)} aria-label="Close station details">x</button>
                <span className="map-station-icon"><IcoMapPin size={15} /></span>
                <div>
                  <strong>{activeMapPin.station || activeMapPin.barangay || 'Station'}</strong>
                  <span>{activeMapPin.waterbodyRiver || selectedInfo?.name}</span>
                  <span>{activeMapPin.barangay}{activeMapPin.province ? `, ${activeMapPin.province}` : ''}</span>
                  <small>{activeMapPin.lat.toFixed(5)}, {activeMapPin.lng.toFixed(5)}</small>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="map-empty-state">No mapped station coordinates matched this waterbody.</div>
        )}
        {tileMap && (
          <div className="map-legend">
            {tileMap.pins.map((point) => (
              <span key={`${point.id}-legend`}>
                <i style={{ background: point.color }} />
                {point.station || point.barangay || 'Station'}
              </span>
            ))}
          </div>
        )}
      </article>
    </section>

    <section className="dash-panel station-gauge-panel">
      <div className="dash-panel-header">
        <div>
          <h3>Station Parameter Gauge Metrics</h3>
          <p>Latest available readings against reference limits for each monitoring station</p>
        </div>
        <span className="gauge-as-of">As of {gaugeAsOf}</span>
      </div>
      <div className="station-gauge-table-wrap">
        <table className="station-gauge-table">
          <thead>
            <tr>
              <th>Station</th>
              {gaugeParams.map((param) => <th key={param}>{param}</th>)}
            </tr>
          </thead>
          <tbody>
            {stationGaugeData.map(({ station, metrics }) => {
              const metricLookup = Object.fromEntries(metrics.map((metric) => [metric.param, metric]));
              return (
                <tr key={station.stnId}>
                  <td className="station-gauge-station">
                    <strong>{station.stnId}</strong>
                    <span>{station.address}</span>
                  </td>
                  {gaugeParams.map((param) => {
                    const metric = metricLookup[param];
                    return (
                      <td key={param}>
                        {metric ? (
                          <div className={`rect-gauge status-${metric.status}`}>
                            <div>
                              <strong>{metric.label}</strong>
                              <span className={`gauge-verdict ${metric.verdict.toLowerCase()}`}>{metric.unit || metric.verdict}</span>
                            </div>
                            <i style={{ '--pct': `${metric.percent}%` }} />
                          </div>
                        ) : <span className="gauge-empty">—</span>}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>

    <section className="dashboard-analysis-grid">
      <article className="dash-panel correlation-panel">
        <div className="dash-panel-header">
          <div>
            <h3>Parameter Correlation</h3>
            <p>X and Y axes compare station annual values within {selectedInfo?.name}</p>
          </div>
        </div>
        <div className="correlation-wrap">
          <div className="correlation-grid" style={{ '--corr-size': correlationParams.length }}>
            <span className="corr-corner">Y \ X</span>
            {correlationParams.map((param) => <span key={param} className="corr-head" title={param}>{param}</span>)}
            {correlationMatrix.map((row) => (
              <Fragment key={row.param}>
                <span className="corr-row-head" title={row.param}>{row.param}</span>
                {row.cells.map((cell) => (
                  <span
                    key={`${cell.rowParam}-${cell.colParam}`}
                    className="corr-cell"
                    style={{ background: getCorrelationColor(cell.value) }}
                    title={`${cell.rowParam} vs ${cell.colParam}: ${cell.value === null ? 'No data' : cell.value.toFixed(2)}`}
                  >
                    {cell.value === null ? '—' : cell.value.toFixed(2)}
                  </span>
                ))}
              </Fragment>
            ))}
          </div>
        </div>
        <div className="corr-legend">
          <span><i className="corr-neg" />Negative</span>
          <span><i className="corr-pos" />Positive</span>
        </div>
        <div className="corr-interpretation">
          <strong>Interpretation</strong>
          <p>{correlationInterpretation}</p>
        </div>
      </article>

      <article className="dash-panel observation-panel observation-panel-side">
        <div className="dash-panel-header">
          <div>
            <h3>Observation Panel</h3>
            <p>Field notes recorded for {selectedInfo?.name}</p>
          </div>
          <select
            className="observation-month-filter"
            value={activeObservationMonth}
            onChange={(event) => setSelectedObservationMonth(event.target.value)}
          >
            {observationMonths.map((entry) => (
              <option key={entry.month} value={entry.month}>{entry.month}</option>
            ))}
          </select>
        </div>
        <div className="observation-list observation-list-side">
          {filteredObservations.length ? filteredObservations.map((entry) => (
            <article key={`${entry.station.stnId}-${entry.month}`} className={`observation-item status-${getObservationMeta(entry.value).status}`}>
              <span className="observation-icon">{getObservationMeta(entry.value).icon}</span>
              <div>
                <strong>{entry.month} · {entry.station.stnId}</strong>
                <span className="observation-status-label">{getObservationMeta(entry.value).label}</span>
                <p>{entry.value}</p>
              </div>
            </article>
          )) : <div className="map-empty-state">No observations are available for this filter.</div>}
        </div>
      </article>
    </section>
  </div>
  );
};

const VISUALIZATION_ITEMS = [
  ['heatmap', 'Heatmap Matrix', IcoTable],
  ['fecal-trophic', 'Fecal Risk & Trophic State', IcoMapPin],
  ['map-3d', '3D Waterbody Map', IcoMapPin],
  ['seasonal', 'Seasonal Decomposition', IcoCalendar],
  ['radar', 'Radar Chart', IcoDashboard],
  ['scatter', 'Scatter Analysis', IcoWaves],
  ['forecast', 'Forecast Charts', IcoAlertTriangle],
];

const ACCESS_ROLE_RANK = { user: 1, developer: 2, admin: 3 };
const DEFAULT_ACCESS_SETTINGS = {
  dashboard: 'user',
  visualizations: 'user',
  waterbodies: 'user',
  tabular: 'user',
  developerManager: 'developer',
};

const getStoredAccessSettings = () => {
  try {
    return { ...DEFAULT_ACCESS_SETTINGS, ...JSON.parse(localStorage.getItem('wqms_access_settings') || '{}') };
  } catch {
    return DEFAULT_ACCESS_SETTINGS;
  }
};

/* ── Year placeholder ── */
const YearPlaceholder = ({ year }) => (
  <div className="wqm-placeholder">
    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" style={{ color: 'var(--text-secondary)', marginBottom: '1rem', opacity: 0.4 }}>
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
    </svg>
    <h3>No Data Available &mdash; {year}</h3>
    <p>Water quality data for CY {year} has not been uploaded yet.</p>
  </div>
);

/* ── Main Home layout ── */
const Home = () => {
  const { user, logout } = useAuth();
  const { theme, toggle: toggleTheme } = useTheme();
  const navigate = useNavigate();
  const userMenuRef = useRef(null);

  const [activeView, setActiveView] = useState('dashboard');
  const [tabularOpen, setTabularOpen] = useState(false);
  const [waterbodiesOpen, setWaterbodiesOpen] = useState(false);
  const [visualizationsOpen, setVisualizationsOpen] = useState(false);
  const [developerOpen, setDeveloperOpen] = useState(false);
  const [developerSection, setDeveloperSection] = useState('accounts');
  const [activeVisualization, setActiveVisualization] = useState('heatmap');
  const [activeWaterbody, setActiveWaterbody] = useState(null);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [accessSettings, setAccessSettings] = useState(getStoredAccessSettings);
  const { year: publishedYear, sheets: monitoringSheets } = usePublishedWqmDataset();
  const waterbodies = useMemo(() => (
    buildWaterbodyOptions(monitoringSheets)
  ), [monitoringSheets]);

  useEffect(() => {
    const handler = (e) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target)) {
        setShowUserMenu(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    const refreshAccess = () => setAccessSettings(getStoredAccessSettings());
    window.addEventListener('storage', refreshAccess);
    window.addEventListener('wqms:access-settings', refreshAccess);
    return () => {
      window.removeEventListener('storage', refreshAccess);
      window.removeEventListener('wqms:access-settings', refreshAccess);
    };
  }, []);

  const canAccess = (feature) => (
    (ACCESS_ROLE_RANK[user?.role] || 0) >= (ACCESS_ROLE_RANK[accessSettings[feature] || 'user'] || 1)
  );

  const nav = (view) => {
    setActiveView(view);
    if (!view.startsWith('tabular')) setTabularOpen(false);
    logActivity('Navigated app view', { view }, user);
  };

  const navWaterbody = (key) => {
    setActiveWaterbody(key);
    setActiveView('waterbody');
  };

  const navDeveloper = (section) => {
    setDeveloperSection(section);
    setActiveView('developer-manager');
    logActivity('Opened developer manager section', { section }, user);
  };

  const navVisualization = (section) => {
    setActiveVisualization(section);
    setActiveView('visualization');
    logActivity('Opened visualization', { section }, user);
  };

  const handleLogout = () => { logActivity('Signed out', {}, user); logout(); navigate('/login'); };

  const pageTitle = {
    dashboard:      'Dashboard',
    'tabular-2026': 'Tabular Results — 2026',
    'tabular-2025': 'Tabular Results — 2025',
    'tabular-2024': 'Tabular Results — 2024',
    'developer-manager': 'Developer Manager',
    visualization: activeVisualization === 'map-3d' ? '3D Waterbody Map' : 'Visual Analytics',
    waterbody:      waterbodies.find((w) => w.key === activeWaterbody)?.name || 'Waterbody Profile',
  }[activeView] || 'Dashboard';
  const hideTopbar = activeView.startsWith('tabular');

  return (
    <div className="dashboard">
      {/* ── Sidebar ── */}
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="sidebar-logos">
            <img src={bagongLogo} alt="Bagong Pilipinas" className="logo-bagong" />
            <div className="sidebar-logo-divider" />
            <img src={embLogo} alt="EMB" className="logo-emb" />
          </div>
          <div className="sidebar-brand-text">
            <span className="sidebar-brand-name">Environmental Management Bureau</span>
            <span className="sidebar-brand-sub">Region III</span>
          </div>
        </div>

        <nav className="sidebar-nav">
          <p className="nav-section-label">Main</p>

          {canAccess('dashboard') && (
            <button
              className={`nav-item${activeView === 'dashboard' ? ' active' : ''}`}
              onClick={() => nav('dashboard')}
            >
              <IcoDashboard size={15} />
              <span className="nav-label">Dashboard</span>
            </button>
          )}

          {canAccess('visualizations') && (
            <button
              className={`nav-item nav-group-toggle${visualizationsOpen || activeView === 'visualization' ? ' open' : ''}`}
              onClick={() => setVisualizationsOpen((open) => !open)}
            >
              <IcoDashboard size={15} />
              <span className="nav-label">Visualizations</span>
              <span className="nav-chevron-icon">
                {visualizationsOpen ? <IcoChevronDown size={12} /> : <IcoChevronRight size={12} />}
              </span>
            </button>
          )}

          {canAccess('visualizations') && visualizationsOpen && (
            <div className="nav-sub-group">
              {VISUALIZATION_ITEMS.map(([section, label, VisualizationIcon]) => (
                <button
                  key={section}
                  className={`nav-item nav-sub-item${activeView === 'visualization' && activeVisualization === section ? ' active' : ''}`}
                  onClick={() => navVisualization(section)}
                >
                  {VisualizationIcon({ size: 12 })}
                  <span className="nav-label">{label}</span>
                </button>
              ))}
            </div>
          )}

          <p className="nav-section-label">Monitoring</p>

          {canAccess('waterbodies') && (
            <button
              className={`nav-item nav-group-toggle${waterbodiesOpen ? ' open' : ''}`}
              onClick={() => setWaterbodiesOpen((o) => !o)}
            >
              <IcoWater size={15} />
              <span className="nav-label">Waterbodies</span>
              <span className="nav-chevron-icon">
                {waterbodiesOpen ? <IcoChevronDown size={12} /> : <IcoChevronRight size={12} />}
              </span>
            </button>
          )}

          {canAccess('waterbodies') && waterbodiesOpen && (
            <div className="nav-sub-group nav-wb-group">
              {waterbodies.map((wb) => (
                <button
                  key={wb.key}
                  className={`nav-item nav-sub-item${activeView === 'waterbody' && activeWaterbody === wb.key ? ' active' : ''}`}
                  onClick={() => navWaterbody(wb.key)}
                >
                  <span className="nav-wb-dot" />
                  <span className="nav-label">{wb.name}</span>
                </button>
              ))}
            </div>
          )}

          <p className="nav-section-label">Data</p>

          {canAccess('tabular') && (
            <button
              className={`nav-item nav-group-toggle${tabularOpen || activeView.startsWith('tabular') ? ' open' : ''}`}
              onClick={() => setTabularOpen((o) => !o)}
            >
              <IcoTable size={15} />
              <span className="nav-label">Tabular Results</span>
              <span className="nav-chevron-icon">
                {tabularOpen ? <IcoChevronDown size={12} /> : <IcoChevronRight size={12} />}
              </span>
            </button>
          )}

          {canAccess('tabular') && tabularOpen && (
            <div className="nav-sub-group">
              {[2026, 2025, 2024].map((yr) => (
                <button
                  key={yr}
                  className={`nav-item nav-sub-item${activeView === `tabular-${yr}` ? ' active' : ''}`}
                  onClick={() => nav(`tabular-${yr}`)}
                >
                  <IcoCalendar size={12} />
                  <span className="nav-label">{yr}</span>
                </button>
              ))}
            </div>
          )}

          {['admin', 'developer'].includes(user?.role) && canAccess('developerManager') && (
            <>
              <p className="nav-section-label">System</p>
              <button
                className={`nav-item nav-group-toggle${developerOpen || activeView === 'developer-manager' ? ' open' : ''}`}
                onClick={() => setDeveloperOpen((open) => !open)}
              >
                <IcoSettings size={15} />
                <span className="nav-label">Developer Manager</span>
                <span className="nav-badge-admin">{user?.role === 'developer' ? 'dev' : 'admin'}</span>
                <span className="nav-chevron-icon">
                  {developerOpen ? <IcoChevronDown size={12} /> : <IcoChevronRight size={12} />}
                </span>
              </button>
              {developerOpen && (
                <div className="nav-sub-group">
                  {[
                    ['accounts', 'User Accounts'],
                    ['approvals', 'Sign Up Approvals'],
                    ['runtime', 'App Runtime Status'],
                    ['database', 'Database Status'],
                    ['waterbody-settings', 'Waterbody Profiles'],
                    ['visualization-data', 'Visualization Data'],
                    ['logs', 'App Logs'],
                    ['backup', 'Backup & Config'],
                    ['email', 'Email Config'],
                    ['ai', 'AI Forecast'],
                  ].map(([section, label]) => (
                    <button
                      key={section}
                      className={`nav-item nav-sub-item${activeView === 'developer-manager' && developerSection === section ? ' active' : ''}`}
                      onClick={() => navDeveloper(section)}
                    >
                      <span className="nav-wb-dot" />
                      <span className="nav-label">{label}</span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </nav>

        <div
          className="theme-toggle-sidebar"
          onClick={toggleTheme}
          role="button"
          tabIndex={0}
          title="Toggle theme"
        >
          {theme === 'light' ? <IcoSun size={14} /> : <IcoMoon size={14} />}
          <span className="nav-label">{theme === 'light' ? 'Light Mode' : 'Dark Mode'}</span>
          <span className={`tts-track${theme === 'dark' ? ' on' : ''}`}>
            <span className="tts-knob" />
          </span>
        </div>
      </aside>

      {/* ── Main content ── */}
      <main className="main-content">
        {!hideTopbar && <header className={`topbar${activeView === 'dashboard' ? ' dashboard-header' : ''}`}>
          <div className="topbar-left">
            <h2 className="page-title">{pageTitle}</h2>
            <p className="page-subtitle">EMBR3 Water Quality Monitoring System &middot; Region III</p>
          </div>
          <div className="topbar-right">
            <div className="last-updated">
              <span className="pulse-dot" />
              EMBR3-WQMS
            </div>
            <div className="user-menu-wrap" ref={userMenuRef}>
              <button
                className="avatar"
                onClick={() => setShowUserMenu((v) => !v)}
                title={user?.name}
              >
                {user?.name?.charAt(0).toUpperCase()}
              </button>
              {showUserMenu && (
                <div className="user-dropdown">
                  <div className="ud-header">
                    <span className="ud-avatar-lg">{user?.name?.charAt(0).toUpperCase()}</span>
                    <div className="ud-info">
                      <p className="ud-name">{user?.name}</p>
                      <p className="ud-email">{user?.email}</p>
                      <span className="ud-role-badge">{user?.role}</span>
                    </div>
                  </div>
                  <div className="ud-divider" />
                  <button className="ud-item ud-logout" onClick={handleLogout}>
                    <IcoLogout size={14} />
                    Sign Out
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>}

        <div className="content-area">
          {activeView === 'dashboard'    && <DashboardView />}
          {activeView === 'tabular-2026' && <WQM2026 year={2026} />}
          {activeView === 'tabular-2025' && <WQM2026 year={2025} />}
          {activeView === 'tabular-2024' && <WQM2026 year={2024} />}
          {activeView === 'visualization' && (
            activeVisualization === 'map-3d'
              ? (
                <Suspense fallback={<div className="app-loading compact"><span />Loading 3D waterbody map...</div>}>
                  <Waterbody3DMap />
                </Suspense>
              )
              : <VisualizationView type={activeVisualization} />
          )}
          {activeView === 'developer-manager' && <Settings key={developerSection} initialSection={developerSection} />}
          {activeView === 'waterbody'    && activeWaterbody && (
            <WaterbodyProfile waterbodyKey={activeWaterbody} year={publishedYear} sheets={monitoringSheets} />
          )}
        </div>
        <footer className="app-footer">
          <span>EMBR3 Water Quality Monitoring System</span>
          <span>Environmental Management Bureau Region III · CY {publishedYear}</span>
        </footer>
      </main>
    </div>
  );
};

export default Home;
