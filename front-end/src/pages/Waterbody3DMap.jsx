import { useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  Cartesian2,
  Cartesian3,
  Color,
  Credit,
  EllipsoidTerrainProvider,
  HeightReference,
  Ion,
  LabelStyle,
  Rectangle,
  UrlTemplateImageryProvider,
  VerticalOrigin,
  Viewer,
} from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import stationWorkbookUrl from '../../docs/wqm_stations.xlsx?url';
import api from '../api/axios';
import { buildWaterbodyOptions, getReadableStations, usePublishedWqmDataset } from '../utils/wqmSheets';
import './Waterbody3DMap.css';

Ion.defaultAccessToken = '';

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

const isWaterbodyMatch = (location, matches) => {
  const river = normalizeForMatch(location.waterbodyRiver);
  const loc = normalizeForMatch(location.waterbodyLoc);
  if (river && matches.has(river)) return true;
  if (!river && loc && [...matches].some((match) => match.includes(loc) || loc.includes(match))) return true;
  return false;
};

const getBounds = (locations) => {
  if (!locations.length) return null;
  const lats = locations.map((point) => point.lat);
  const lngs = locations.map((point) => point.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const latPad = Math.max((maxLat - minLat) * 0.65, 0.018);
  const lngPad = Math.max((maxLng - minLng) * 0.65, 0.018);
  return {
    west: minLng - lngPad,
    south: minLat - latPad,
    east: maxLng + lngPad,
    north: maxLat + latPad,
  };
};

const loadStationLocations = async () => {
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

const Waterbody3DMap = () => {
  const mountRef = useRef(null);
  const viewerRef = useRef(null);
  const { year, sheets, loading, error } = usePublishedWqmDataset();
  const waterbodies = useMemo(() => buildWaterbodyOptions(sheets), [sheets]);
  const [waterbodyKey, setWaterbodyKey] = useState('');
  const [stationLocations, setStationLocations] = useState([]);
  const [locationError, setLocationError] = useState('');
  const [mapTiler, setMapTiler] = useState({
    key: import.meta.env.VITE_MAPTILER_API_KEY || import.meta.env.VITE_MAPTILER_KEY || '',
    configured: false,
  });

  const activeWaterbodyKey = waterbodies.some((waterbody) => waterbody.key === waterbodyKey)
    ? waterbodyKey
    : (waterbodies[0]?.key || '');
  const selected = waterbodies.find((waterbody) => waterbody.key === activeWaterbodyKey) || waterbodies[0];
  const selectedSheet = sheets.find((sheet) => sheet.key === selected?.key);
  const stations = useMemo(() => getReadableStations(selectedSheet), [selectedSheet]);

  useEffect(() => {
    if (!waterbodyKey && waterbodies[0]?.key) setWaterbodyKey(waterbodies[0].key);
  }, [waterbodies, waterbodyKey]);

  useEffect(() => {
    let cancelled = false;
    loadStationLocations()
      .then((locations) => {
        if (!cancelled) setStationLocations(locations);
      })
      .catch(() => {
        if (!cancelled) setLocationError('Unable to load station coordinates workbook.');
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (mapTiler.key) return;
    let cancelled = false;
    api.get('/water/maptiler-key')
      .then(({ data }) => {
        if (!cancelled) setMapTiler({ key: data?.key || '', configured: Boolean(data?.configured) });
      })
      .catch(() => {
        if (!cancelled) setMapTiler({ key: '', configured: false });
      });
    return () => { cancelled = true; };
  }, [mapTiler.key]);

  const matchedLocations = useMemo(() => {
    if (!selected) return [];
    const matches = getWaterbodyMatches(activeWaterbodyKey, selected.name);
    const stationNames = stations.map((station) => normalizeForMatch(station.stnId));
    const stationMatches = (location) => {
      const workbookStation = normalizeForMatch(location.station);
      return !workbookStation || stationNames.some((name) => name && (
        workbookStation === name || workbookStation.includes(name) || name.includes(workbookStation)
      ));
    };
    const byWaterbody = stationLocations.filter((location) => isWaterbodyMatch(location, matches)).filter(stationMatches);
    if (byWaterbody.length) return byWaterbody;
    return stationLocations.filter(stationMatches);
  }, [activeWaterbodyKey, selected, stationLocations, stations]);

  useEffect(() => {
    if (!mountRef.current || !mapTiler.key || viewerRef.current) return undefined;

    const viewer = new Viewer(mountRef.current, {
      animation: false,
      baseLayerPicker: false,
      fullscreenButton: false,
      geocoder: false,
      homeButton: false,
      infoBox: true,
      navigationHelpButton: false,
      sceneModePicker: true,
      selectionIndicator: true,
      timeline: false,
      contextOptions: {
        webgl: {
          preserveDrawingBuffer: true,
        },
      },
      terrainProvider: new EllipsoidTerrainProvider(),
      imageryProvider: new UrlTemplateImageryProvider({
        url: `https://api.maptiler.com/maps/satellite/{z}/{x}/{y}.jpg?key=${encodeURIComponent(mapTiler.key)}`,
        credit: new Credit('MapTiler satellite imagery'),
        maximumLevel: 20,
      }),
    });

    viewer.scene.globe.enableLighting = true;
    viewer.scene.globe.depthTestAgainstTerrain = false;
    viewer.scene.skyAtmosphere.show = true;
    viewer.scene.screenSpaceCameraController.minimumZoomDistance = 80;
    viewer.scene.screenSpaceCameraController.maximumZoomDistance = 8000000;
    viewerRef.current = viewer;

    return () => {
      viewerRef.current = null;
      viewer.destroy();
    };
  }, [mapTiler.key]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !matchedLocations.length) return;

    viewer.entities.removeAll();
    const bounds = getBounds(matchedLocations);
    const positions = [];

    matchedLocations.forEach((location, index) => {
      const position = Cartesian3.fromDegrees(location.lng, location.lat, 28 + (index % 4) * 9);
      positions.push(position);
      viewer.entities.add({
        id: `station-${location.id || index}`,
        name: location.station || location.id || `Station ${index + 1}`,
        position,
        description: [
          `<strong>${selected?.name || 'Waterbody'}</strong>`,
          `<br/>Station: ${location.station || location.id || 'Station'}`,
          `<br/>Barangay/Province: ${[location.barangay, location.province].filter(Boolean).join(', ') || 'Not specified'}`,
          `<br/>Coordinates: ${location.lat.toFixed(6)}, ${location.lng.toFixed(6)}`,
        ].join(''),
        point: {
          pixelSize: 13,
          color: Color.ORANGE,
          outlineColor: Color.WHITE,
          outlineWidth: 2,
          heightReference: HeightReference.RELATIVE_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        label: {
          text: location.station || String(location.id || `Station ${index + 1}`),
          font: '700 13px Segoe UI, Arial, sans-serif',
          fillColor: Color.WHITE,
          outlineColor: Color.BLACK,
          outlineWidth: 4,
          style: LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cartesian2(0, -24),
          verticalOrigin: VerticalOrigin.BOTTOM,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          scaleByDistance: undefined,
        },
      });
    });

    if (positions.length > 1) {
      viewer.entities.add({
        name: `${selected?.name || 'Waterbody'} station route`,
        polyline: {
          positions,
          width: 3,
          material: Color.CYAN.withAlpha(0.82),
          clampToGround: false,
        },
      });
    }

    if (bounds) {
      viewer.camera.flyTo({
        destination: Rectangle.fromDegrees(bounds.west, bounds.south, bounds.east, bounds.north),
        duration: 0.9,
      });
    }
  }, [matchedLocations, selected?.name]);

  return (
    <div className="map3d-page">
      <section className="map3d-header">
        <div>
          <p>Cesium 3D Waterbody Map</p>
          <h2>{selected?.name || 'Waterbody'} · CY {year}</h2>
        </div>
        <label>
          <span>Waterbody</span>
          <select value={activeWaterbodyKey} onChange={(event) => setWaterbodyKey(event.target.value)}>
            {waterbodies.map((waterbody) => <option key={waterbody.key} value={waterbody.key}>{waterbody.name}</option>)}
          </select>
        </label>
      </section>

      {(loading || error || locationError || !mapTiler.key || !matchedLocations.length) && (
        <section className="map3d-state">
          {loading && <div className="app-loading compact"><span />Loading published WQM dataset...</div>}
          {!loading && error && <p>{error}</p>}
          {!loading && locationError && <p>{locationError}</p>}
          {!loading && !mapTiler.key && <p>MapTiler API key is not configured. Add MAPTILER_API_KEY to server/.env and restart the backend.</p>}
          {!loading && mapTiler.key && !matchedLocations.length && <p>No station coordinates matched this waterbody.</p>}
        </section>
      )}

      <section className="map3d-stage">
        <div ref={mountRef} className="map3d-canvas" />
        <aside className="map3d-panel">
          <span>{matchedLocations.length} mapped stations</span>
          <strong>{selected?.name}</strong>
          <p>Cesium globe with MapTiler satellite imagery, workbook station coordinates, station labels, and a waterbody station path.</p>
          <div>
            {matchedLocations.map((location) => (
              <small key={`${location.id}-${location.lat}-${location.lng}`}>
                {location.station || location.id}
              </small>
            ))}
          </div>
        </aside>
      </section>
    </div>
  );
};

export default Waterbody3DMap;
