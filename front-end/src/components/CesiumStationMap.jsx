import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Badge,
  Button,
  Card,
  Progress,
  Select,
  Space,
  Tag,
  Tooltip,
} from 'antd';
import {
  AimOutlined,
  AppstoreOutlined,
  BankOutlined,
  CloseOutlined,
  CompassOutlined,
  EnvironmentOutlined,
  EyeOutlined,
} from '@ant-design/icons';
import {
  BoundingSphere,
  Cartesian2,
  Cartesian3,
  CallbackProperty,
  Color,
  Credit,
  createOsmBuildingsAsync,
  createWorldTerrainAsync,
  EllipsoidTerrainProvider,
  HeadingPitchRange,
  HeightReference,
  ImageryLayer,
  Ion,
  LabelStyle,
  Math as CesiumMath,
  ScreenSpaceEventType,
  UrlTemplateImageryProvider,
  VerticalOrigin,
  Viewer,
} from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import api from '../api/axios';
import {
  MONTHS_SHORT,
  PARAM_LIMITS,
  PARAM_ORDER,
  fmt,
  fmtWithUnit,
  getAvailableParams,
  getAverageNumber,
  getGaugePercent,
  getParamData,
  getParamStatus,
  toNumber,
} from '../utils/wqmData';
import {
  IcoChevronDown,
  IcoChevronRight,
  IcoLayers,
} from './Icons';
import './CesiumStationMap.css';

const ionToken = import.meta.env.VITE_CESIUM_ION_TOKEN || '';
Ion.defaultAccessToken = ionToken;

// Session-scoped, in-memory cache for the MapTiler key lookup.
// The map mounts on several pages (dashboard, 3D map, public dashboard, landing
// preview); without caching each mount issues a fresh `/water/maptiler-key`
// request. The resolved promise is reused so the lookup runs at most once per
// session. The key is held only in memory (never persisted to localStorage),
// and on failure the cache is cleared so a later mount can retry.
let mapTilerKeyCache = null;

const fetchMapTilerKeyCached = () => {
  if (!mapTilerKeyCache) {
    mapTilerKeyCache = api
      .get('/water/maptiler-key')
      .then(({ data }) => ({
        key: data?.key || '',
        configured: Boolean(data?.configured),
      }))
      .catch((error) => {
        mapTilerKeyCache = null;
        throw error;
      });
  }
  return mapTilerKeyCache;
};

const normalizeForMatch = (value) => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

const createImageryProvider = (layer, mapTilerKey) => {
  if (mapTilerKey && layer === 'hybrid') {
    return new UrlTemplateImageryProvider({
      url: `https://api.maptiler.com/maps/hybrid/{z}/{x}/{y}.jpg?key=${encodeURIComponent(mapTilerKey)}`,
      credit: new Credit('MapTiler hybrid imagery'),
      tileWidth: 256,
      tileHeight: 256,
      maximumLevel: 20,
    });
  }

  if (mapTilerKey && layer === 'satellite') {
    return new UrlTemplateImageryProvider({
      url: `https://api.maptiler.com/tiles/satellite-v2/{z}/{x}/{y}.jpg?key=${encodeURIComponent(mapTilerKey)}`,
      credit: new Credit('MapTiler satellite imagery'),
      tileWidth: 256,
      tileHeight: 256,
      maximumLevel: 20,
    });
  }

  if (mapTilerKey && layer === 'streets') {
    return new UrlTemplateImageryProvider({
      url: `https://api.maptiler.com/maps/streets-v2/{z}/{x}/{y}.png?key=${encodeURIComponent(mapTilerKey)}`,
      credit: new Credit('MapTiler street map'),
      tileWidth: 256,
      tileHeight: 256,
      maximumLevel: 20,
    });
  }

  return new UrlTemplateImageryProvider({
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    credit: new Credit('OpenStreetMap contributors'),
    tileWidth: 256,
    tileHeight: 256,
    maximumLevel: 19,
  });
};

const isCompactViewport = () => (
  typeof window !== 'undefined'
  && (window.innerWidth < 900 || window.matchMedia?.('(pointer: coarse)').matches)
);

const focusStationBounds = (viewer, locations, duration = 0.65, birdseye = false) => {
  const safe = (locations || []).filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng));
  if (!viewer || !safe.length) return;

  const positions = safe.map((point) => Cartesian3.fromDegrees(point.lng, point.lat, 0));
  const sphere = BoundingSphere.fromPoints(positions);
  const range = Math.max(sphere.radius * 3.4, 2200);
  // Inclined "aerial" framing (oblique pitch) instead of a flat top-down view.
  const pitch = -CesiumMath.toRadians(birdseye ? 25 : 20);

  viewer.camera.flyToBoundingSphere(sphere, {
    offset: new HeadingPitchRange(0, pitch, range),
    duration,
  });
};

const getMapLabelGroups = (locations, fallbackName) => {
  const groups = new Map();
  locations.forEach((location) => {
    const label = location.waterbodyRiver || location.waterbodyLoc || fallbackName;
    const key = normalizeForMatch(label);
    if (!key || !label) return;
    const group = groups.get(key) || { label, locations: [] };
    group.locations.push(location);
    groups.set(key, group);
  });

  return [...groups.values()].map((group) => {
    const lat = group.locations.reduce((sum, location) => sum + location.lat, 0) / group.locations.length;
    const lng = group.locations.reduce((sum, location) => sum + location.lng, 0) / group.locations.length;
    return { ...group, lat, lng };
  });
};

// Every station pulses only on small maps; on the all-stations maps (100+
// pins) only the selected station does, so the redraw stays cheap.
const PULSE_ALL_LIMIT = 12;
const PULSE_FRAME_MS = 50;

const createPulsePixelSize = (index, base = 12, grow = 28) => new CallbackProperty(() => {
  const phase = ((Date.now() / 1200) + (index * 0.18)) % 1;
  return base + (phase * grow);
}, false);

const createPulseColor = (index, color = Color.CYAN, alpha = 0.26) => new CallbackProperty(() => {
  const phase = ((Date.now() / 1200) + (index * 0.18)) % 1;
  return color.withAlpha(alpha * (1 - phase));
}, false);

const getStationName = (location, index) => (
  location.stationData?.stnId || location.station || location.id || `Station ${index + 1}`
);

const getStationAddress = (location) => (
  [location.barangay, location.province].filter(Boolean).join(', ') || 'Address not specified'
);

const getMarkerSvg = (color = '#f97316', number = null) => {
  const safeColor = /^#[0-9a-f]{6}$/i.test(color) ? color : '#f97316';
  const badge = number !== null && number !== undefined && number !== ''
    ? `<text x="32" y="34" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="17" font-weight="700" fill="${safeColor}">${number}</text>`
    : `<path d="M20 30c3.5 0 3.5 3 7 3s3.5-3 7-3 3.5 3 7 3 3.5-3 7-3" fill="none" stroke="${safeColor}" stroke-width="4" stroke-linecap="round"/><circle cx="32" cy="23" r="3.8" fill="${safeColor}"/>`;
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="64" height="76" viewBox="0 0 64 76">
      <filter id="shadow" x="-30%" y="-20%" width="160%" height="160%">
        <feDropShadow dx="0" dy="5" stdDeviation="4" flood-color="#020617" flood-opacity=".42"/>
      </filter>
      <path filter="url(#shadow)" d="M32 4C18.2 4 7 15.1 7 28.8 7 48.6 32 72 32 72s25-23.4 25-43.2C57 15.1 45.8 4 32 4z" fill="${safeColor}"/>
      <circle cx="32" cy="29" r="15" fill="#fff" opacity=".97"/>
      ${badge}
    </svg>
  `;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
};

// Distinct marker palette so adjacent stations within a waterbody are easy to
// tell apart on the map.
const MARKER_PALETTE = [
  '#446ACB', '#7CB675', '#e07b54', '#a855f7', '#f59e0b',
  '#06b6d4', '#ec4899', '#84cc16', '#f97316', '#14b8a6',
  '#6366f1', '#ef4444',
];

// Status-driven marker colour used when a station has live monitoring data.
const STATUS_MARKER_COLOR = {
  alert: '#ef4444',
  watch: '#f59e0b',
  safe: '#16a34a',
  nodata: '#64748b',
};

const getMarkerColorForLocation = (location, index) => {
  if (location.markerColor && /^#[0-9a-f]{6}$/i.test(location.markerColor)) {
    return location.markerColor;
  }
  return MARKER_PALETTE[index % MARKER_PALETTE.length];
};

// De-duplicate stations that share the exact same coordinates (e.g. ASFMSRS
// rows that resolve to one fallback point) by nudging overlapping markers along
// a small spiral so each station stays individually clickable.
const dedupeLocationCoordinates = (locations) => {
  const seen = new Map();
  return locations.map((location) => {
    if (!Number.isFinite(location.lat) || !Number.isFinite(location.lng)) {
      return location;
    }
    const coordKey = `${location.lat.toFixed(5)},${location.lng.toFixed(5)}`;
    const count = seen.get(coordKey) || 0;
    seen.set(coordKey, count + 1);
    if (count === 0) return location;
    // ~12-18m spiral offset per collision; large enough to separate pins,
    // small enough to keep the station near its true location.
    const angle = count * 2.39996; // golden angle for even spread
    const radius = 0.00016 * Math.ceil(count / 6 + 1);
    return {
      ...location,
      lat: location.lat + radius * Math.cos(angle),
      lng: location.lng + radius * Math.sin(angle),
    };
  });
};

// Quarterly waterbodies store Q1–Q4 in the first four slots; label them so,
// instead of "Jan–Apr".
const periodLabelFor = (periodLabels, index) => periodLabels?.[index] || MONTHS_SHORT[index] || `Month ${index + 1}`;

const getStationMetrics = (station, periodLabels) => {
  if (!station) return [];
  const params = getAvailableParams([station])
    .filter((param) => PARAM_ORDER.includes(param))
    .sort((a, b) => PARAM_ORDER.indexOf(a) - PARAM_ORDER.indexOf(b));

  return params
    .map((param) => {
      const paramData = getParamData(station, param);
      const series = (paramData?.monthly || [])
        .map((raw, index) => ({ index, label: periodLabelFor(periodLabels, index), value: toNumber(raw) }))
        .filter((point) => point.value !== null);
      const latest = series.at(-1);
      const value = latest ? latest.value : getAverageNumber(paramData);
      if (value === null || value === undefined) return null;
      const previous = series.at(-2)?.value;
      return {
        param,
        value,
        label: fmtWithUnit(value, param),
        monthLabel: latest ? latest.label : 'Annual Avg',
        percent: getGaugePercent(param, value),
        status: getParamStatus(param, value),
        series,
        change: previous === undefined || previous === null ? null : value - previous,
      };
    })
    .filter(Boolean)
    .slice(0, 6);
};

// Tiny inline trend chart for the station card: the readings so far, the
// guideline as a dashed line, and the latest point coloured by status.
const SPARK_W = 96;
const SPARK_H = 26;
const SPARK_STATUS_COLOR = { alert: '#f87171', watch: '#fbbf24', safe: '#4ade80', nodata: '#94a3b8' };

const Sparkline = ({ param, series, status }) => {
  if (!series || series.length < 2) return null;
  const limit = PARAM_LIMITS[param];
  const values = series.map((point) => point.value);
  const guides = [limit?.min, limit?.max].filter((v) => v !== undefined);
  // Include the guideline in the scale only when it is near the data, so a
  // fecal limit of 1,000 does not flatten a series in the millions.
  const dataMin = Math.min(...values);
  const dataMax = Math.max(...values);
  const span = dataMax - dataMin || Math.abs(dataMax) || 1;
  const nearGuides = guides.filter((g) => g >= dataMin - span && g <= dataMax + span);
  const min = Math.min(dataMin, ...nearGuides);
  const max = Math.max(dataMax, ...nearGuides);
  const range = max - min || 1;
  const x = (i) => 2 + (i / (series.length - 1)) * (SPARK_W - 4);
  const y = (v) => SPARK_H - 3 - ((v - min) / range) * (SPARK_H - 6);
  const points = series.map((point, i) => `${x(i).toFixed(1)},${y(point.value).toFixed(1)}`).join(' ');
  const last = series.at(-1);
  const color = SPARK_STATUS_COLOR[status] || SPARK_STATUS_COLOR.nodata;
  const title = series.map((point) => `${point.label} ${fmt(point.value)}`).join(' · ');
  return (
    <svg className="station-spark" width={SPARK_W} height={SPARK_H} viewBox={`0 0 ${SPARK_W} ${SPARK_H}`} role="img" aria-label={`${param} trend: ${title}`}>
      <title>{title}</title>
      {nearGuides.map((g) => (
        <line key={g} x1="0" x2={SPARK_W} y1={y(g)} y2={y(g)} className="station-spark-guide" />
      ))}
      <polyline points={`${x(0)},${SPARK_H} ${points} ${x(series.length - 1)},${SPARK_H}`} className="station-spark-area" style={{ fill: color }} />
      <polyline points={points} className="station-spark-line" style={{ stroke: color }} />
      <circle cx={x(series.length - 1)} cy={y(last.value)} r="2.6" style={{ fill: color }} />
    </svg>
  );
};

const getOverallStatus = (metrics) => {
  if (!metrics.length) return 'nodata';
  if (metrics.some((metric) => metric.status === 'alert')) return 'alert';
  if (metrics.some((metric) => metric.status === 'watch')) return 'watch';
  return 'safe';
};

const getStatusLabel = (status) => ({
  alert: 'Needs attention',
  watch: 'Watch',
  safe: 'Within reference',
  nodata: 'No latest readings',
}[status] || 'No latest readings');

// OSM Buildings is a global 3D tileset — by far the heaviest thing this map can
// load. Cesium's defaults cache ~512MB of tiles and render to sub-pixel
// accuracy; both are wildly over-budget for an embedded station map.
const applyTilesetMemoryBudget = (tileset) => {
  if (!tileset) return tileset;
  try {
    tileset.maximumScreenSpaceError = 24;
    // cacheBytes/maximumCacheOverflowBytes replaced maximumMemoryUsage in newer
    // Cesium; set whichever this build exposes.
    if ('cacheBytes' in tileset) {
      tileset.cacheBytes = 48 * 1024 * 1024;
      tileset.maximumCacheOverflowBytes = 16 * 1024 * 1024;
    } else if ('maximumMemoryUsage' in tileset) {
      tileset.maximumMemoryUsage = 48;
    }
    tileset.skipLevelOfDetail = true;
    tileset.preloadWhenHidden = false;
  } catch {
    // Property names differ across Cesium versions; a missing one is harmless.
  }
  return tileset;
};

const safeDestroyViewer = (viewer, mountNode) => {
  if (!viewer) return;
  try {
    if (!viewer.isDestroyed()) viewer.destroy();
  } catch (error) {
    if (error?.name !== 'NotFoundError') {
      console.warn('Cesium viewer cleanup failed:', error);
    }
  } finally {
    try {
      while (mountNode?.firstChild) {
        mountNode.removeChild(mountNode.firstChild);
      }
    } catch {
      // React may already have removed the mount node during a fast remount.
    }
  }
};

const tryCesiumCleanup = (cleanup) => {
  try {
    cleanup();
  } catch (error) {
    if (error?.name !== 'NotFoundError') {
      console.warn('Cesium cleanup step failed:', error);
    }
  }
};

const CesiumStationMap = ({
  locations,
  waterbodyName = 'Waterbody',
  className = '',
  height = 620,
  showStationLabels = true,
  defaultTerrainEnabled = false,
  defaultBuildingsEnabled = false,
  birdseye = false,
  onRenderError,
  emptyMessage = 'No mapped station coordinates matched this waterbody.',
}) => {
  const mapHeightStyle = typeof height === 'number' ? `${height}px` : height;
  const mountRef = useRef(null);
  const viewerRef = useRef(null);
  const baseLayerRef = useRef(null);
  const imageryLayerRef = useRef(null);
  const latestLocationsRef = useRef([]);
  const entityLocationsRef = useRef(new Map());
  const buildingsRef = useRef(null);
  const cameraMovingRef = useRef(false);
  const layerErrorTimerRef = useRef(null);
  const onRenderErrorRef = useRef(onRenderError);
  const resizeObserverRef = useRef(null);
  const [mapTiler, setMapTiler] = useState({
    key: import.meta.env.VITE_MAPTILER_API_KEY || import.meta.env.VITE_MAPTILER_KEY || '',
    configured: false,
  });
  const [layer, setLayer] = useState('osm');
  const [labelsEnabled, setLabelsEnabled] = useState(true);
  const [terrainEnabled, setTerrainEnabled] = useState(false);
  const [terrainLoading, setTerrainLoading] = useState(false);
  const [buildingsEnabled, setBuildingsEnabled] = useState(false);
  const [buildingsLoading, setBuildingsLoading] = useState(false);
  const [toolMessage, setToolMessage] = useState('');
  const [toolsOpen, setToolsOpen] = useState(false);
  const [renderFailed, setRenderFailed] = useState('');
  const [cameraElevation, setCameraElevation] = useState(null);
  // The card follows a station *id*, not a copy of the station taken at click
  // time, so it keeps showing current readings when the data re-syncs.
  const [selectedId, setSelectedId] = useState(null);

  const safeLocations = useMemo(() => (
    dedupeLocationCoordinates(
      (locations || []).filter((location) => Number.isFinite(location.lat) && Number.isFinite(location.lng)),
    )
  ), [locations]);

  // Marker colour/number and a stable entity id per station.
  const decoratedLocations = useMemo(() => safeLocations.map((location, index) => ({
    ...location,
    selectionKey: String(location.id ?? `point-${index}`),
    entityId: `station-${location.id || 'point'}-${index}`,
    markerColor: getMarkerColorForLocation(location, index),
    markerNumber: location.markerNumber ?? location.stationData?.stnNo ?? (index + 1),
    altitude: 28 + (index % 4) * 9,
  })), [safeLocations]);

  // Camera framing depends only on WHERE the stations are. A data refresh that
  // keeps the same stations must not fly the camera back to the overview.
  const positionsKey = useMemo(
    () => safeLocations.map((l) => `${l.lat.toFixed(5)},${l.lng.toFixed(5)}`).join('|'),
    [safeLocations],
  );

  const selectedLocation = useMemo(
    () => (selectedId ? decoratedLocations.find((l) => l.selectionKey === selectedId) || null : null),
    [decoratedLocations, selectedId],
  );
  const labelsVisible = labelsEnabled && showStationLabels;
  const canUseIon = Boolean(ionToken);
  const hasRenderableLocations = safeLocations.length > 0;

  useEffect(() => {
    latestLocationsRef.current = safeLocations;
  }, [safeLocations]);

  useEffect(() => {
    onRenderErrorRef.current = onRenderError;
  }, [onRenderError]);

  // `birdseye` only changes the camera pitch (25° vs 20°). It used to sit in
  // the viewer-creation dependency array, so toggling it tore down and rebuilt
  // the entire WebGL context — the most expensive thing this component can do,
  // and a reliable way to accumulate GPU memory (browsers cap live WebGL
  // contexts and reclaim them lazily). Read it from a ref instead.
  const birdseyeRef = useRef(birdseye);
  useEffect(() => {
    birdseyeRef.current = birdseye;
  }, [birdseye]);

  // Stop the render loop while the tab is hidden or the map is scrolled out of
  // view. Even with requestRenderMode the viewer keeps servicing tile requests
  // and animation callbacks (the station pulse markers use CallbackProperty,
  // which forces a redraw every frame), so a backgrounded dashboard kept a GPU
  // context busy and kept pulling imagery it would never show.
  useEffect(() => {
    const mountNode = mountRef.current;
    if (!mountNode) return undefined;

    let visibleInViewport = true;
    const applyRenderState = () => {
      const viewer = viewerRef.current;
      if (!viewer || viewer.isDestroyed()) return;
      const shouldRender = visibleInViewport && document.visibilityState !== 'hidden';
      if (viewer.useDefaultRenderLoop !== shouldRender) {
        viewer.useDefaultRenderLoop = shouldRender;
        if (shouldRender) viewer.scene.requestRender();
      }
    };

    const handleVisibility = () => applyRenderState();
    document.addEventListener('visibilitychange', handleVisibility);

    let observer;
    if (typeof IntersectionObserver !== 'undefined') {
      observer = new IntersectionObserver(
        ([entry]) => {
          visibleInViewport = entry.isIntersecting;
          applyRenderState();
        },
        { threshold: 0.01 },
      );
      observer.observe(mountNode);
    }

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      observer?.disconnect();
    };
  }, [hasRenderableLocations]);

  useEffect(() => {
    const mountNode = mountRef.current;
    if (!mountNode || typeof ResizeObserver === 'undefined') return undefined;

    const notifyResize = () => {
      const viewer = viewerRef.current;
      if (!viewer || viewer.isDestroyed()) return;
      try {
        viewer.resize();
        viewer.scene.requestRender();
      } catch {
        // Ignore transient resize timing errors while the viewer is mounting.
      }
    };

    const observer = new ResizeObserver(() => {
      requestAnimationFrame(notifyResize);
    });

    observer.observe(mountNode);
    if (mountNode.parentElement) observer.observe(mountNode.parentElement);
    resizeObserverRef.current = observer;
    requestAnimationFrame(notifyResize);

    return () => {
      observer.disconnect();
      resizeObserverRef.current = null;
    };
  }, [toolsOpen, height]);

  useEffect(() => {
    if (mapTiler.key) return;
    let cancelled = false;
    fetchMapTilerKeyCached()
      .then(({ key, configured }) => {
        if (cancelled) return;
        setMapTiler({ key, configured });
      })
      .catch(() => {
        if (!cancelled) setMapTiler({ key: '', configured: false });
      });
    return () => { cancelled = true; };
  }, [mapTiler.key]);

  useEffect(() => {
    if (!hasRenderableLocations || !mountRef.current || viewerRef.current) return undefined;

    const mountNode = mountRef.current;
    let viewer;
    let disposed = false;
    try {
      viewer = new Viewer(mountNode, {
        animation: false,
        baseLayerPicker: false,
        fullscreenButton: true,
        geocoder: false,
        homeButton: true,
        // The station card below replaces Cesium's own InfoBox. With both on,
        // a click opened two overlapping floating panels with different data.
        infoBox: false,
        navigationHelpButton: !isCompactViewport(),
        sceneModePicker: false,
        selectionIndicator: false,
        timeline: false,
        requestRenderMode: true,
        maximumRenderTimeChange: 1,
        scene3DOnly: true,
        shadows: false,
        orderIndependentTranslucency: false,
        useBrowserRecommendedResolution: true,
        msaaSamples: 1,
        contextOptions: {
          webgl: {
            antialias: false,
            alpha: false,
            failIfMajorPerformanceCaveat: false,
          },
        },
        terrainProvider: new EllipsoidTerrainProvider(),
        baseLayer: new ImageryLayer(createImageryProvider('osm', '')),
      });
    } catch (error) {
      const message = error?.message || 'Unable to start the 3D map renderer.';
      queueMicrotask(() => {
        setRenderFailed(message);
        onRenderErrorRef.current?.(message);
      });
      return undefined;
    }
    baseLayerRef.current = viewer.imageryLayers.get(0);
    imageryLayerRef.current = null;

    viewer.scene.globe.enableLighting = true;
    viewer.scene.globe.depthTestAgainstTerrain = false;
    viewer.scene.globe.baseColor = Color.fromCssColorString('#10233f');
    viewer.scene.skyAtmosphere.show = true;

    // ── Memory budget ────────────────────────────────────────────────────────
    // Cesium's defaults are tuned for a full-screen globe viewer, not an
    // embedded panel showing a handful of stations in one province. Left alone
    // they are the dominant source of this component's memory use.
    //
    // tileCacheSize defaults to 100 *decoded* imagery/terrain tiles, each of
    // which can be megabytes once uploaded to the GPU; the cache is never
    // trimmed while the viewer lives, so panning around steadily grows it.
    viewer.scene.globe.tileCacheSize = isCompactViewport() ? 15 : 30;
    // maximumScreenSpaceError defaults to 2 (near-pixel-perfect). Relaxing it
    // roughly quarters the number of tiles fetched and retained at a given
    // camera height, with no visible difference at station-overview zoom.
    viewer.scene.globe.maximumScreenSpaceError = isCompactViewport() ? 6 : 4;
    // Preloading ancestors/siblings keeps extra tile levels resident purely to
    // smooth zooming — not worth the memory here.
    viewer.scene.globe.preloadAncestors = false;
    viewer.scene.globe.preloadSiblings = false;
    // Skip decoding imagery for parts of the globe that are never shown.
    viewer.scene.globe.showGroundAtmosphere = false;
    viewer.scene.fog.enabled = false;
    // Cap device pixel ratio: on a 3x phone screen the framebuffer is 9x the
    // pixels, which dominates GPU memory for no perceptible gain here.
    viewer.resolutionScale = Math.min(window.devicePixelRatio || 1, 1.5) / (window.devicePixelRatio || 1);
    viewer.scene.backgroundColor = Color.fromCssColorString('#07111f');
    viewer.scene.screenSpaceCameraController.minimumZoomDistance = 80;
    viewer.scene.screenSpaceCameraController.maximumZoomDistance = 8000000;
    if ('verticalExaggeration' in viewer.scene) viewer.scene.verticalExaggeration = 1.35;
    const handleRenderError = (_scene, error) => {
      const message = error?.message || 'Cesium rendering stopped.';
      setRenderFailed(message);
      setToolMessage('3D rendering stopped. Try disabling terrain or buildings.');
      onRenderErrorRef.current?.(message);
    };

    const updateCameraElevation = () => {
      const heightMeters = viewer.camera.positionCartographic?.height;
      if (Number.isFinite(heightMeters)) setCameraElevation(Math.round(heightMeters));
    };
    const markCameraMoving = () => { cameraMovingRef.current = true; };
    const markCameraStable = () => { cameraMovingRef.current = false; };

    const refocusStations = () => focusStationBounds(viewer, latestLocationsRef.current, 0.4, birdseyeRef.current);
    const refocusHome = (event) => {
      if (!latestLocationsRef.current.length) return;
      event.cancel = true;
      focusStationBounds(viewer, latestLocationsRef.current, 0.45, birdseyeRef.current);
    };
    const handleMapClick = (movement) => {
      const picked = viewer.scene.pick(movement.position);
      const entityId = picked?.id?.id;
      if (entityId && entityLocationsRef.current.has(entityId)) {
        setSelectedId(entityLocationsRef.current.get(entityId).selectionKey);
      }
    };

    viewer.scene.renderError.addEventListener(handleRenderError);
    viewer.scene.morphComplete.addEventListener(refocusStations);
    viewer.camera.changed.addEventListener(updateCameraElevation);
    viewer.camera.moveStart.addEventListener(markCameraMoving);
    viewer.camera.moveEnd.addEventListener(markCameraStable);
    viewer.screenSpaceEventHandler.setInputAction(handleMapClick, ScreenSpaceEventType.LEFT_CLICK);
    viewer.homeButton.viewModel.command.beforeExecute.addEventListener(refocusHome);
    viewerRef.current = viewer;
    updateCameraElevation();

    const canAutoLoadEnhancedMap = canUseIon && !isCompactViewport() && latestLocationsRef.current.length <= 80;

    if (canAutoLoadEnhancedMap && defaultTerrainEnabled) {
      setTerrainLoading(true);
      createWorldTerrainAsync({ requestVertexNormals: true })
        .then((terrainProvider) => {
          if (!disposed && !viewer.isDestroyed()) {
            viewer.terrainProvider = terrainProvider;
            setTerrainEnabled(true);
            focusStationBounds(viewer, latestLocationsRef.current, 0.45, birdseyeRef.current);
          }
        })
        .catch(() => {
          if (!disposed && !viewer.isDestroyed()) {
            viewer.terrainProvider = new EllipsoidTerrainProvider();
            setTerrainEnabled(false);
            setToolMessage('Terrain could not be loaded.');
          }
        })
        .finally(() => {
          if (!disposed) setTerrainLoading(false);
        });
    }

    if (canAutoLoadEnhancedMap && defaultBuildingsEnabled) {
      setBuildingsLoading(true);
      createOsmBuildingsAsync()
        .then((buildings) => {
          if (!disposed && !viewer.isDestroyed()) {
            buildingsRef.current = viewer.scene.primitives.add(applyTilesetMemoryBudget(buildings));
            setBuildingsEnabled(true);
          }
        })
        .catch(() => {
          if (disposed) return;
          buildingsRef.current = null;
          setBuildingsEnabled(false);
          setToolMessage('Buildings could not be loaded.');
        })
        .finally(() => {
          if (!disposed) setBuildingsLoading(false);
        });
    }

    if (!canUseIon && (defaultTerrainEnabled || defaultBuildingsEnabled)) {
      queueMicrotask(() => setToolMessage('Terrain and buildings require VITE_CESIUM_ION_TOKEN.'));
    } else if (!canAutoLoadEnhancedMap && (defaultTerrainEnabled || defaultBuildingsEnabled)) {
      queueMicrotask(() => setToolMessage('Terrain and buildings are available from the tools when the device can handle them.'));
    }

    return () => {
      disposed = true;
      tryCesiumCleanup(() => viewer.scene.morphComplete.removeEventListener(refocusStations));
      tryCesiumCleanup(() => viewer.scene.renderError.removeEventListener(handleRenderError));
      tryCesiumCleanup(() => viewer.camera.changed.removeEventListener(updateCameraElevation));
      tryCesiumCleanup(() => viewer.camera.moveStart.removeEventListener(markCameraMoving));
      tryCesiumCleanup(() => viewer.camera.moveEnd.removeEventListener(markCameraStable));
      tryCesiumCleanup(() => viewer.screenSpaceEventHandler.removeInputAction(ScreenSpaceEventType.LEFT_CLICK));
      tryCesiumCleanup(() => viewer.homeButton.viewModel.command.beforeExecute.removeEventListener(refocusHome));
      if (layerErrorTimerRef.current) {
        clearTimeout(layerErrorTimerRef.current);
        layerErrorTimerRef.current = null;
      }
      if (buildingsRef.current) {
        tryCesiumCleanup(() => viewer.scene.primitives.remove(buildingsRef.current));
        buildingsRef.current = null;
      }
      viewerRef.current = null;
      baseLayerRef.current = null;
      imageryLayerRef.current = null;
      safeDestroyViewer(viewer, mountNode);
    };
    // birdseye deliberately excluded — it is read from birdseyeRef so a pitch
    // change does not recreate the WebGL context.
  }, [canUseIon, defaultBuildingsEnabled, defaultTerrainEnabled, hasRenderableLocations]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;

    const mapTilerLayers = ['hybrid', 'satellite', 'streets'];
    const activeLayer = mapTiler.key || !mapTilerLayers.includes(layer) ? layer : 'osm';
    const imageryLayers = viewer.imageryLayers;
    let fallbackTriggered = false;
    let tileErrorCount = 0;

    const nextProvider = createImageryProvider(activeLayer, mapTiler.key);

    const fallbackToOsm = (force = false, error = null) => {
      if (fallbackTriggered || !viewerRef.current || viewer.isDestroyed()) return;
      const failedLevel = Number(error?.level);
      const isCloseRangeTileMiss = Number.isFinite(failedLevel) && failedLevel >= 15 && activeLayer !== 'osm';
      if (!force && isCloseRangeTileMiss) {
        viewer.scene.requestRender();
        return;
      }
      tileErrorCount += 1;
      if (!force && tileErrorCount < 24) return;
      if (!force && cameraMovingRef.current) {
        scheduleFallbackAfterCameraStops();
        return;
      }
      fallbackTriggered = true;
      try {
        if (activeLayer === 'osm') {
          setToolMessage('OpenStreetMap imagery is not responding. Keeping the current map layer.');
          return;
        }
        setLayer('osm');
        setToolMessage('Selected layer could not load, using OpenStreetMap.');
        viewer.scene.requestRender();
      } catch {
        setToolMessage('Map imagery could not be loaded.');
      }
    };
    function scheduleFallbackAfterCameraStops() {
      if (layerErrorTimerRef.current) clearTimeout(layerErrorTimerRef.current);
      layerErrorTimerRef.current = setTimeout(() => {
        layerErrorTimerRef.current = null;
        if (cameraMovingRef.current) {
          scheduleFallbackAfterCameraStops();
          return;
        }
        fallbackToOsm(true);
      }, 1600);
    }
    const handleTileError = (error) => fallbackToOsm(false, error);

    try {
      nextProvider.errorEvent?.addEventListener(handleTileError);
      const nextLayer = imageryLayers.addImageryProvider(nextProvider);
      if (imageryLayerRef.current && imageryLayerRef.current !== nextLayer) {
        imageryLayers.remove(imageryLayerRef.current, false);
      }
      imageryLayerRef.current = nextLayer;
      viewer.scene.requestRender();
    } catch {
      fallbackToOsm(true);
    }

    return () => {
      nextProvider.errorEvent?.removeEventListener(handleTileError);
      if (layerErrorTimerRef.current) {
        clearTimeout(layerErrorTimerRef.current);
        layerErrorTimerRef.current = null;
      }
    };
  }, [layer, mapTiler.key]);

  // ── Station entities ─────────────────────────────────────────────────────
  // Rebuilt when the stations or label settings change, WITHOUT touching the
  // camera or the open card. Previously this also cleared the selection and
  // re-flew the camera, so every data sync or Labels toggle threw the user
  // back to the overview and closed the card they were reading.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;

    viewer.entities.suspendEvents();
    viewer.entities.removeAll();
    entityLocationsRef.current.clear();
    const pulseAll = decoratedLocations.length <= PULSE_ALL_LIMIT;

    decoratedLocations.forEach((location, index) => {
      const stationName = getStationName(location, index);
      const groundPosition = Cartesian3.fromDegrees(location.lng, location.lat, 0);

      if (pulseAll) {
        viewer.entities.add({
          id: `station-pulse-${location.entityId}`,
          position: groundPosition,
          point: {
            pixelSize: createPulsePixelSize(index),
            color: createPulseColor(index),
            outlineColor: Color.WHITE.withAlpha(0.16),
            outlineWidth: 1,
            heightReference: HeightReference.CLAMP_TO_GROUND,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        });
      }

      viewer.entities.add({
        id: location.entityId,
        name: stationName,
        position: Cartesian3.fromDegrees(location.lng, location.lat, location.altitude),
        billboard: {
          image: getMarkerSvg(location.markerColor, location.markerNumber),
          width: 30,
          height: 36,
          verticalOrigin: VerticalOrigin.BOTTOM,
          heightReference: HeightReference.RELATIVE_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        label: {
          text: stationName,
          show: labelsVisible,
          font: '600 12px Segoe UI, Arial, sans-serif',
          fillColor: Color.WHITE,
          outlineColor: Color.fromCssColorString(location.markerColor),
          outlineWidth: 3,
          style: LabelStyle.FILL_AND_OUTLINE,
          showBackground: true,
          backgroundColor: Color.fromCssColorString('#0f172a').withAlpha(0.72),
          backgroundPadding: new Cartesian2(7, 4),
          pixelOffset: new Cartesian2(0, -30),
          verticalOrigin: VerticalOrigin.BOTTOM,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
      entityLocationsRef.current.set(location.entityId, location);
    });

    // Only render waterbody centroid labels when more than one distinct
    // waterbody is shown — a single waterbody name is already in the header and
    // the redundant centroid label overlaps the station pins.
    const mapLabels = getMapLabelGroups(decoratedLocations, waterbodyName);
    if (mapLabels.length > 1) {
      mapLabels.forEach((group, index) => {
        viewer.entities.add({
          id: `waterbody-label-${index}`,
          name: group.label,
          position: Cartesian3.fromDegrees(group.lng, group.lat, 130),
          label: {
            text: group.label,
            show: labelsEnabled,
            font: '600 14px Segoe UI, Arial, sans-serif',
            fillColor: Color.CYAN,
            outlineColor: Color.BLACK,
            outlineWidth: 3,
            style: LabelStyle.FILL_AND_OUTLINE,
            showBackground: true,
            backgroundColor: Color.BLACK.withAlpha(0.5),
            backgroundPadding: new Cartesian2(9, 6),
            pixelOffset: new Cartesian2(0, 44),
            verticalOrigin: VerticalOrigin.CENTER,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        });
      });
    }
    viewer.entities.resumeEvents();
    viewer.scene.requestRender();
  }, [decoratedLocations, labelsEnabled, labelsVisible, waterbodyName]);

  // ── Camera framing — only when the set of station positions changes ──────
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed() || !positionsKey) return;
    focusStationBounds(viewer, latestLocationsRef.current, 0.85, birdseyeRef.current);
  }, [positionsKey, hasRenderableLocations]);

  // ── Selection: highlight ring on the chosen station; drop a selection
  //    whose station disappeared from the data. ─────────────────────────────
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return undefined;
    if (selectedId && !selectedLocation) {
      queueMicrotask(() => setSelectedId(null));
      return undefined;
    }
    if (!selectedLocation) return undefined;
    const ring = viewer.entities.add({
      id: 'station-selected-ring',
      position: Cartesian3.fromDegrees(selectedLocation.lng, selectedLocation.lat, 0),
      point: {
        pixelSize: createPulsePixelSize(0, 18, 34),
        color: Color.TRANSPARENT,
        outlineColor: createPulseColor(0, Color.fromCssColorString(selectedLocation.markerColor), 0.95),
        outlineWidth: 3,
        heightReference: HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });
    viewer.scene.requestRender();
    return () => {
      tryCesiumCleanup(() => { if (!viewer.isDestroyed()) viewer.entities.remove(ring); });
    };
  }, [selectedId, selectedLocation]);

  // ── Pulse animation tick ─────────────────────────────────────────────────
  // requestRenderMode only redraws on demand, so the pulse rings froze between
  // camera moves and then jumped. Drive a light ~20 fps redraw, but only while
  // something is pulsing and the map is actually on screen.
  const pulsing = decoratedLocations.length > 0 && (decoratedLocations.length <= PULSE_ALL_LIMIT || Boolean(selectedLocation));
  useEffect(() => {
    if (!pulsing) return undefined;
    const id = window.setInterval(() => {
      const viewer = viewerRef.current;
      if (viewer && !viewer.isDestroyed() && viewer.useDefaultRenderLoop) viewer.scene.requestRender();
    }, PULSE_FRAME_MS);
    return () => window.clearInterval(id);
  }, [pulsing]);

  // Esc closes the station card.
  useEffect(() => {
    if (!selectedId) return undefined;
    const onKey = (event) => { if (event.key === 'Escape') setSelectedId(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedId]);

  const toggleTerrain = async () => {
    const viewer = viewerRef.current;
    if (!viewer || terrainLoading) return;
    if (!canUseIon) {
      setToolMessage('Terrain requires VITE_CESIUM_ION_TOKEN.');
      return;
    }

    if (terrainEnabled) {
      viewer.terrainProvider = new EllipsoidTerrainProvider();
      setTerrainEnabled(false);
      setToolMessage('');
      return;
    }

    try {
      setTerrainLoading(true);
      const terrainProvider = await createWorldTerrainAsync({
        requestVertexNormals: true,
      });
      viewer.terrainProvider = terrainProvider;
      setTerrainEnabled(true);
      setToolMessage('');
      focusStationBounds(viewer, safeLocations, 0.45, birdseye);
    } catch {
      viewer.terrainProvider = new EllipsoidTerrainProvider();
      setTerrainEnabled(false);
      setToolMessage('Terrain could not be loaded.');
    } finally {
      setTerrainLoading(false);
    }
  };

  const toggleBuildings = async () => {
    const viewer = viewerRef.current;
    if (!viewer || buildingsLoading) return;
    if (!canUseIon) {
      setToolMessage('Buildings require VITE_CESIUM_ION_TOKEN.');
      return;
    }

    if (buildingsRef.current) {
      viewer.scene.primitives.remove(buildingsRef.current);
      buildingsRef.current = null;
      setBuildingsEnabled(false);
      setToolMessage('');
      return;
    }

    try {
      setBuildingsLoading(true);
      const buildings = applyTilesetMemoryBudget(await createOsmBuildingsAsync());
      buildingsRef.current = viewer.scene.primitives.add(buildings);
      setBuildingsEnabled(true);
      setToolMessage('');
    } catch {
      buildingsRef.current = null;
      setBuildingsEnabled(false);
      setToolMessage('Buildings could not be loaded.');
    } finally {
      setBuildingsLoading(false);
    }
  };

  const mapLayerOptions = [
    ['osm', 'OSM'],
    ...(mapTiler.key ? [['hybrid', 'Hybrid'], ['satellite', 'Satellite'], ['streets', 'Streets']] : []),
  ];
  const selectedMetrics = useMemo(
    () => getStationMetrics(selectedLocation?.stationData, selectedLocation?.periodLabels),
    [selectedLocation],
  );
  // Most recent period with any reading — tells the viewer how current the card is.
  const latestPeriod = selectedMetrics.reduce((best, m) => {
    const last = m.series.at(-1);
    return last && (!best || last.index > best.index) ? last : best;
  }, null)?.label || '';
  const selectedStatus = getOverallStatus(selectedMetrics);

  return (
    <div className={`cesium-station-map ${className}`} style={{ '--cesium-map-height': mapHeightStyle }}>
      {renderFailed ? (
        <div className="cesium-map-empty cesium-map-error">{renderFailed}</div>
      ) : safeLocations.length ? (
        <>
          <div className="cesium-map-hud">
            <Card
              className={`cesium-map-tools ${toolsOpen ? 'open' : 'collapsed'}`}
              size="small"
              aria-label="3D map tools"
              title={(
                <button
                  type="button"
                  className="cesium-tools-toggle"
                  onClick={() => setToolsOpen((open) => !open)}
                  aria-expanded={toolsOpen}
                  title={toolsOpen ? 'Collapse layer tools' : 'Expand layer tools'}
                >
                  <span><AppstoreOutlined /> Layer Tools</span>
                  {toolsOpen ? <IcoChevronDown size={13} /> : <IcoChevronRight size={13} />}
                </button>
              )}
            >
              {toolsOpen && (
                <div className="cesium-tools-body">
                  <div className="cesium-layer-field">
                    <span><IcoLayers size={14} /> Layer</span>
                    <Select
                      size="small"
                      value={mapTiler.key || !['hybrid', 'satellite', 'streets'].includes(layer) ? layer : 'osm'}
                      onChange={(value) => {
                        setToolMessage('');
                        setLayer(value);
                      }}
                      options={mapLayerOptions.map(([value, label]) => ({ value, label }))}
                      classNames={{ popup: { root: 'wqm-map-select-popup' } }}
                      getPopupContainer={(trigger) => trigger.parentElement}
                      aria-label="Map imagery layer"
                    />
                  </div>
                  <Space className="cesium-tool-grid" size={[6, 6]} wrap>
                    <Tooltip title={labelsEnabled ? 'Hide labels' : 'Show labels'}>
                      <Button size="small" icon={<EyeOutlined />} type={labelsEnabled ? 'primary' : 'default'} onClick={() => setLabelsEnabled((show) => !show)}>
                        Labels
                      </Button>
                    </Tooltip>
                    <Tooltip title="Toggle terrain elevation">
                      <Button size="small" icon={<CompassOutlined />} type={terrainEnabled ? 'primary' : 'default'} onClick={toggleTerrain} loading={terrainLoading}>
                        Terrain
                      </Button>
                    </Tooltip>
                    <Tooltip title="Toggle 3D buildings">
                      <Button size="small" icon={<BankOutlined />} type={buildingsEnabled ? 'primary' : 'default'} onClick={toggleBuildings} loading={buildingsLoading}>
                        Buildings
                      </Button>
                    </Tooltip>
                    <Tooltip title="Focus stations">
                      <Button size="small" icon={<AimOutlined />} onClick={() => focusStationBounds(viewerRef.current, safeLocations, 0.45, birdseye)}>
                        Focus
                      </Button>
                    </Tooltip>
                  </Space>
                </div>
              )}
            </Card>
            <div className="cesium-elevation-badge">
              <span>Elevation</span>
              <strong>{cameraElevation === null ? '--' : `${fmt(cameraElevation)} m`}</strong>
            </div>
          </div>
          <div ref={mountRef} className="cesium-station-map-canvas" />
          {selectedLocation && (
            <Card
              key={selectedLocation.selectionKey}
              className={`cesium-station-card status-${selectedStatus}`}
              size="small"
              title={(
                <Space align="center" className="cesium-station-card-title">
                  <span
                    className="station-pin-badge"
                    style={{ background: selectedLocation.markerColor || '#446ACB' }}
                  >
                    {selectedLocation.markerNumber ?? '•'}
                  </span>
                  <span>
                    <small>{selectedLocation.waterbodyName || waterbodyName}</small>
                    <strong>{getStationName(selectedLocation, 0)}</strong>
                  </span>
                </Space>
              )}
              extra={<Button type="text" size="small" icon={<CloseOutlined />} onClick={() => setSelectedId(null)} aria-label="Close station monitoring card" />}
            >
              <Space orientation="vertical" size="small" className="cesium-station-card-content">
                <Space wrap size={6}>
                  <Tag
                    className="station-status-tag"
                    color={selectedStatus === 'alert' ? 'red' : selectedStatus === 'watch' ? 'gold' : selectedStatus === 'safe' ? 'green' : 'default'}
                  >
                    {getStatusLabel(selectedStatus)}
                  </Tag>
                  {latestPeriod && <Tag className="station-coord-tag">Latest: {latestPeriod}</Tag>}
                  <Tag icon={<EnvironmentOutlined />} className="station-coord-tag">
                    {selectedLocation.lat.toFixed(5)}, {selectedLocation.lng.toFixed(5)}
                  </Tag>
                </Space>
                <span className="station-address">
                  <EnvironmentOutlined /> {getStationAddress(selectedLocation)}
                </span>
                <div className="cesium-quality-list">
                  {selectedMetrics.map((metric) => (
                    <div className={`quality-row ${metric.status}`} key={metric.param}>
                      <div className="quality-row-head">
                        <span className="quality-param">
                          <Badge
                            status={
                              metric.status === 'alert' ? 'error'
                              : metric.status === 'watch' ? 'warning'
                              : metric.status === 'safe' ? 'success'
                              : 'default'
                            }
                          />
                          {metric.param}
                        </span>
                        <strong>
                          {metric.label}
                          {metric.change !== null && Math.abs(metric.change) > 1e-9 && (
                            <em className={`quality-change ${metric.change > 0 ? 'up' : 'down'}`} title="Change from the previous reading">
                              {metric.change > 0 ? '▲' : '▼'}
                            </em>
                          )}
                          <em className="quality-month">{metric.monthLabel}</em>
                        </strong>
                      </div>
                      <div className={`quality-row-viz${metric.series.length < 2 ? ' no-spark' : ''}`}>
                        <Sparkline param={metric.param} series={metric.series} status={metric.status} />
                        <Progress
                          percent={Math.round(metric.percent)}
                          showInfo={false}
                          size="small"
                          status={metric.status === 'alert' ? 'exception' : metric.status === 'watch' ? 'active' : 'success'}
                        />
                      </div>
                    </div>
                  ))}
                  {!selectedMetrics.length && (
                    <div className="quality-empty">No latest numeric monitoring data matched this station.</div>
                  )}
                </div>
              </Space>
            </Card>
          )}
          {toolMessage && (
            <Tag className="cesium-tool-message" color="warning" closable onClose={() => setToolMessage('')}>
              {toolMessage}
            </Tag>
          )}
        </>
      ) : (
        <div className="cesium-map-empty">{emptyMessage}</div>
      )}
    </div>
  );
};

export default CesiumStationMap;
