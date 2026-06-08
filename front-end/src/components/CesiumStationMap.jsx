import { useEffect, useMemo, useRef, useState } from 'react';
import {
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

const createPulsePixelSize = (index) => new CallbackProperty(() => {
  const phase = ((Date.now() / 1200) + (index * 0.18)) % 1;
  return 12 + (phase * 28);
}, false);

const createPulseColor = (index) => new CallbackProperty(() => {
  const phase = ((Date.now() / 1200) + (index * 0.18)) % 1;
  return Color.CYAN.withAlpha(0.26 * (1 - phase));
}, false);

const getStationName = (location, index) => (
  location.stationData?.stnId || location.station || location.id || `Station ${index + 1}`
);

const getStationAddress = (location) => (
  [location.barangay, location.province].filter(Boolean).join(', ') || 'Address not specified'
);

const getMarkerSvg = (color = '#f97316') => {
  const safeColor = /^#[0-9a-f]{6}$/i.test(color) ? color : '#f97316';
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="64" height="76" viewBox="0 0 64 76">
      <filter id="shadow" x="-30%" y="-20%" width="160%" height="160%">
        <feDropShadow dx="0" dy="5" stdDeviation="4" flood-color="#020617" flood-opacity=".42"/>
      </filter>
      <path filter="url(#shadow)" d="M32 4C18.2 4 7 15.1 7 28.8 7 48.6 32 72 32 72s25-23.4 25-43.2C57 15.1 45.8 4 32 4z" fill="${safeColor}"/>
      <circle cx="32" cy="29" r="15" fill="#fff" opacity=".95"/>
      <path d="M20 30c3.5 0 3.5 3 7 3s3.5-3 7-3 3.5 3 7 3 3.5-3 7-3" fill="none" stroke="${safeColor}" stroke-width="4" stroke-linecap="round"/>
      <circle cx="32" cy="23" r="3.8" fill="${safeColor}"/>
    </svg>
  `;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
};

const getStationMetrics = (station) => {
  if (!station) return [];
  const params = getAvailableParams([station])
    .filter((param) => PARAM_ORDER.includes(param))
    .sort((a, b) => PARAM_ORDER.indexOf(a) - PARAM_ORDER.indexOf(b));

  return params
    .map((param) => {
      const paramData = getParamData(station, param);
      let value = null;
      let monthLabel = 'Annual Avg';
      const monthly = paramData?.monthly || [];
      for (let index = monthly.length - 1; index >= 0; index -= 1) {
        const monthlyValue = toNumber(monthly[index]);
        if (monthlyValue !== null) {
          value = monthlyValue;
          monthLabel = MONTHS_SHORT[index] || `Month ${index + 1}`;
          break;
        }
      }
      if (value === null) value = getAverageNumber(paramData);
      if (value === null || value === undefined) return null;
      return {
        param,
        value,
        label: fmtWithUnit(value, param),
        monthLabel,
        percent: getGaugePercent(param, value),
        status: getParamStatus(param, value),
      };
    })
    .filter(Boolean)
    .slice(0, 5);
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
  const [selectedLocation, setSelectedLocation] = useState(null);

  const safeLocations = useMemo(() => (
    (locations || []).filter((location) => Number.isFinite(location.lat) && Number.isFinite(location.lng))
  ), [locations]);
  const labelsVisible = labelsEnabled && showStationLabels;
  const canUseIon = Boolean(ionToken);
  const hasRenderableLocations = safeLocations.length > 0;

  useEffect(() => {
    latestLocationsRef.current = safeLocations;
  }, [safeLocations]);

  useEffect(() => {
    onRenderErrorRef.current = onRenderError;
  }, [onRenderError]);

  useEffect(() => {
    if (mapTiler.key) return;
    let cancelled = false;
    api.get('/water/maptiler-key')
      .then(({ data }) => {
        if (cancelled) return;
        const nextKey = data?.key || '';
        setMapTiler({ key: nextKey, configured: Boolean(data?.configured) });
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
        infoBox: true,
        navigationHelpButton: !isCompactViewport(),
        sceneModePicker: false,
        selectionIndicator: true,
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

    const refocusStations = () => focusStationBounds(viewer, latestLocationsRef.current, 0.4, birdseye);
    const refocusHome = (event) => {
      if (!latestLocationsRef.current.length) return;
      event.cancel = true;
      focusStationBounds(viewer, latestLocationsRef.current, 0.45, birdseye);
    };
    const handleMapClick = (movement) => {
      const picked = viewer.scene.pick(movement.position);
      const entityId = picked?.id?.id;
      if (entityId && entityLocationsRef.current.has(entityId)) {
        setSelectedLocation(entityLocationsRef.current.get(entityId));
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
            focusStationBounds(viewer, latestLocationsRef.current, 0.45, birdseye);
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
            buildingsRef.current = viewer.scene.primitives.add(buildings);
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
  }, [birdseye, canUseIon, defaultBuildingsEnabled, defaultTerrainEnabled, hasRenderableLocations]);

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

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;

    viewer.entities.removeAll();
    entityLocationsRef.current.clear();
    setSelectedLocation(null);
    if (!safeLocations.length) return;

    const mapLabels = getMapLabelGroups(safeLocations, waterbodyName);

    safeLocations.forEach((location, index) => {
      const stationName = getStationName(location, index);
      const stationEntityId = `station-${location.id || 'point'}-${index}`;
      const markerColor = location.markerColor || '#f97316';
      const position = Cartesian3.fromDegrees(location.lng, location.lat, 28 + (index % 4) * 9);
      const groundPosition = Cartesian3.fromDegrees(location.lng, location.lat, 0);

      viewer.entities.add({
        id: `station-pulse-${location.id || 'point'}-${index}`,
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

      viewer.entities.add({
        id: stationEntityId,
        name: stationName,
        position,
        description: [
          `<strong>${waterbodyName}</strong>`,
          `<br/>Station: ${stationName}`,
          `<br/>Barangay/Province: ${getStationAddress(location)}`,
          `<br/>Coordinates: ${location.lat.toFixed(6)}, ${location.lng.toFixed(6)}`,
          Number.isFinite(location.fecal) ? `<br/>Fecal Coliform: ${location.fecal}` : '',
        ].join(''),
        billboard: {
          image: getMarkerSvg(markerColor),
          width: 26,
          height: 31,
          verticalOrigin: VerticalOrigin.BOTTOM,
          heightReference: HeightReference.RELATIVE_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        label: {
          text: stationName,
          show: labelsVisible,
          font: '700 13px Segoe UI, Arial, sans-serif',
          fillColor: Color.WHITE,
          outlineColor: Color.BLACK,
          outlineWidth: 4,
          style: LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cartesian2(0, -24),
          verticalOrigin: VerticalOrigin.BOTTOM,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
      entityLocationsRef.current.set(stationEntityId, location);
    });

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
          pixelOffset: new Cartesian2(0, 34),
          verticalOrigin: VerticalOrigin.CENTER,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
    });

    focusStationBounds(viewer, safeLocations, 0.85, birdseye);
  }, [birdseye, labelsEnabled, labelsVisible, safeLocations, waterbodyName]);

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
      const buildings = await createOsmBuildingsAsync();
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
  const selectedMetrics = getStationMetrics(selectedLocation?.stationData);
  const selectedStatus = getOverallStatus(selectedMetrics);

  return (
    <div className={`cesium-station-map ${className}`} style={{ '--cesium-map-height': `${height}px` }}>
      {renderFailed ? (
        <div className="cesium-map-empty cesium-map-error">{renderFailed}</div>
      ) : safeLocations.length ? (
        <>
          <div ref={mountRef} className="cesium-station-map-canvas" />
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
                    popupClassName="wqm-map-select-popup"
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
          <div className={`cesium-elevation-badge ${toolsOpen ? 'tools-open' : 'tools-collapsed'}`}>
            <span>Elevation</span>
            <strong>{cameraElevation === null ? '--' : `${fmt(cameraElevation)} m`}</strong>
          </div>
          {selectedLocation && (
            <Card
              className={`cesium-station-card status-${selectedStatus}`}
              size="small"
              title={(
                <Space align="center" className="cesium-station-card-title">
                  <span className="station-color-bar" style={{ background: selectedLocation.markerColor || '#f97316' }} />
                  <span>
                    <small>{selectedLocation.waterbodyName || waterbodyName}</small>
                    <strong>{getStationName(selectedLocation, 0)}</strong>
                  </span>
                </Space>
              )}
              extra={<Button type="text" size="small" icon={<CloseOutlined />} onClick={() => setSelectedLocation(null)} aria-label="Close station monitoring card" />}
            >
              <Space direction="vertical" size="small" className="cesium-station-card-content">
                <Space wrap>
                  <Tag color={selectedStatus === 'alert' ? 'red' : selectedStatus === 'watch' ? 'gold' : selectedStatus === 'safe' ? 'green' : 'default'}>
                    {getStatusLabel(selectedStatus)}
                  </Tag>
                  <Tag icon={<EnvironmentOutlined />}>{selectedLocation.lat.toFixed(6)}, {selectedLocation.lng.toFixed(6)}</Tag>
                </Space>
                <span className="station-address">{getStationAddress(selectedLocation)}</span>
                <div className="cesium-quality-list">
                  {selectedMetrics.map((metric) => (
                    <div className={`quality-row ${metric.status}`} key={metric.param}>
                      <div>
                        <span>{metric.param}</span>
                        <strong>{metric.label}</strong>
                      </div>
                      <Progress
                        percent={Math.round(metric.percent)}
                        showInfo={false}
                        size="small"
                        status={metric.status === 'alert' ? 'exception' : metric.status === 'watch' ? 'active' : 'success'}
                      />
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
