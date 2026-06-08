import { useEffect, useMemo, useState } from 'react';
import { Button, Card, Modal, Select, Space, Tag } from 'antd';
import { DownOutlined, RightOutlined } from '@ant-design/icons';
import CesiumStationMap from '../components/CesiumStationMap';
import encryptedStorage from '../utils/encryptedStorage';
import { loadStationLocations } from '../utils/stationWorkbook';
import { buildWaterbodyOptions, getReadableStations, usePublishedWqmDataset } from '../utils/wqmSheets';
import './Waterbody3DMap.css';

const WATERBODY_GROUP_COLORS = {
  'Priority Water Bodies': '#f97316',
  'Other Water Bodies': '#14b8a6',
  'Remaining WQM 2026 Sheets': '#6366f1',
  Waterbodies: '#0ea5e9',
};

const normalizeForMatch = (value) => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
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

const isWaterbodyMatch = (location, matches) => {
  const river = normalizeForMatch(location.waterbodyRiver);
  const loc = normalizeForMatch(location.waterbodyLoc);
  if (river && matches.has(river)) return true;
  if (!river && loc && [...matches].some((match) => match.includes(loc) || loc.includes(match))) return true;
  return false;
};

const getLocationStationNumber = (location) => {
  const match = String(location?.id || '').match(/(?:^|_)(\d+)$/);
  return match ? Number(match[1]) : null;
};

const getStationAssignmentKey = (waterbodyKey, station) => [
  waterbodyKey,
  station?.stnNo ?? '',
  station?.stnId ?? '',
  station?.address ?? '',
].join('::');

const parseCoordinateOverride = (value, fallback) => {
  if (value === '' || value === null || value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const getStationAddress = (location) => (
  [location.barangay, location.province].filter(Boolean).join(', ') || 'Address not specified'
);

const formatCoordinates = (location) => `${location.lat.toFixed(6)}, ${location.lng.toFixed(6)}`;

const getGroupColor = (group) => WATERBODY_GROUP_COLORS[group] || '#0ea5e9';

const matchStationData = (location, stationList, allowNumberMatch = true) => {
  const locationNo = getLocationStationNumber(location);
  const workbookValues = [location.station, location.id, location.barangay]
    .map(normalizeForMatch)
    .filter(Boolean);

  return stationList.find((station) => {
    if (allowNumberMatch && Number.isFinite(Number(station.stnNo)) && Number(station.stnNo) === locationNo) {
      return true;
    }

    const values = [station.stnId, station.address]
      .map(normalizeForMatch)
      .filter(Boolean);
    return values.some((value) => workbookValues.some((workbookValue) => (
      workbookValue === value || workbookValue.includes(value) || value.includes(workbookValue)
    )));
  }) || null;
};

const enrichLocation = (location, waterbody, stationList, profileSettings = {}) => {
  const stationData = matchStationData(location, stationList);
  const profile = profileSettings[waterbody?.key] || {};
  const overrideKey = stationData ? getStationAssignmentKey(waterbody?.key, stationData) : null;
  const override = overrideKey ? profile.stationOverrides?.[overrideKey] : null;
  const overrideName = String(override?.name || '').trim();
  const nextStationData = overrideName && stationData ? { ...stationData, stnId: overrideName } : stationData;

  return {
    ...location,
    station: overrideName || location.station,
    lat: parseCoordinateOverride(override?.lat, location.lat),
    lng: parseCoordinateOverride(override?.lng, location.lng),
    stationData: nextStationData,
    waterbodyName: waterbody?.name || location.waterbodyRiver || 'Waterbody',
    waterbodyGroup: waterbody?.group || 'Waterbodies',
    markerColor: getGroupColor(waterbody?.group),
  };
};

const Waterbody3DMap = () => {
  const { year, sheets, loading, error } = usePublishedWqmDataset();
  const waterbodies = useMemo(() => buildWaterbodyOptions(sheets), [sheets]);
  const [waterbodyKey, setWaterbodyKey] = useState('');
  const [stationLocations, setStationLocations] = useState([]);
  const [locationsLoaded, setLocationsLoaded] = useState(false);
  const [locationError, setLocationError] = useState('');
  const [collapsedWaterbodies, setCollapsedWaterbodies] = useState(() => new Set());
  const [profileSettings, setProfileSettings] = useState(() => encryptedStorage.getItem('wqms_waterbody_profile_settings') || {});
  const [mapRenderError, setMapRenderError] = useState('');

  const activeWaterbodyKey = waterbodies.some((waterbody) => waterbody.key === waterbodyKey)
    ? waterbodyKey
    : (waterbodies[0]?.key || '');
  const selected = waterbodies.find((waterbody) => waterbody.key === activeWaterbodyKey) || waterbodies[0];
  const selectedSheet = sheets.find((sheet) => sheet.key === selected?.key);
  const stations = useMemo(() => getReadableStations(selectedSheet), [selectedSheet]);
  const [showAllStations, setShowAllStations] = useState(false);
  const stationScope = showAllStations ? 'all' : 'selected';
  const waterbodySelectOptions = useMemo(() => {
    const grouped = new Map();
    waterbodies.forEach((waterbody) => {
      const group = waterbody.group || 'Waterbodies';
      const options = grouped.get(group) || [];
      options.push({ value: waterbody.key, label: waterbody.name, searchLabel: waterbody.name });
      grouped.set(group, options);
    });
    return [...grouped.entries()].map(([label, options]) => ({ label, options }));
  }, [waterbodies]);

  useEffect(() => {
    if (waterbodyKey || !waterbodies[0]?.key) return;
    queueMicrotask(() => setWaterbodyKey(waterbodies[0].key));
  }, [waterbodies, waterbodyKey]);

  useEffect(() => {
    let cancelled = false;
    loadStationLocations()
      .then((locations) => {
        if (!cancelled) {
          setStationLocations(locations);
          setLocationsLoaded(true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLocationError('Unable to load station coordinates workbook.');
          setLocationsLoaded(true);
        }
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const refreshProfileSettings = (event) => {
      setProfileSettings(event.detail || encryptedStorage.getItem('wqms_waterbody_profile_settings') || {});
    };
    window.addEventListener('wqms:waterbody-profile-settings', refreshProfileSettings);
    return () => window.removeEventListener('wqms:waterbody-profile-settings', refreshProfileSettings);
  }, []);

  const matchedLocations = useMemo(() => {
    if (!selected) return [];
    const matches = getWaterbodyMatches(activeWaterbodyKey, selected.name);
    const stationTokens = stations.map((station) => ({
      no: Number(station.stnNo),
      values: [station.stnId, station.address]
        .map(normalizeForMatch)
        .filter(Boolean),
    }));
    const stationMatches = (location, allowNumberMatch = false) => {
      const workbookValues = [location.station, location.id, location.barangay]
        .map(normalizeForMatch)
        .filter(Boolean);
      if (!workbookValues.length) return true;
      return stationTokens.some(({ no, values }) => {
        if (allowNumberMatch && Number.isFinite(no) && getLocationStationNumber(location) === no) return true;
        return values.some((value) => workbookValues.some((workbookValue) => (
          workbookValue === value || workbookValue.includes(value) || value.includes(workbookValue)
        )));
      });
    };
    const waterbodyMatches = stationLocations.filter((location) => isWaterbodyMatch(location, matches));
    const byWaterbody = waterbodyMatches.filter((location) => stationMatches(location, true));
    const matched = byWaterbody.length
      ? byWaterbody
      : waterbodyMatches.length
        ? waterbodyMatches
        : stationLocations.filter((location) => stationMatches(location));
    return matched.map((location) => enrichLocation(location, selected, stations, profileSettings));
  }, [activeWaterbodyKey, profileSettings, selected, stationLocations, stations]);

  const allMappedLocations = useMemo(() => stationLocations.map((location) => {
    const waterbody = waterbodies.find((item) => isWaterbodyMatch(location, getWaterbodyMatches(item.key, item.name)));
    const sheet = sheets.find((item) => item.key === waterbody?.key);
    return enrichLocation(location, waterbody, getReadableStations(sheet), profileSettings);
  }), [profileSettings, sheets, stationLocations, waterbodies]);

  const visibleLocations = showAllStations ? allMappedLocations : matchedLocations;
  const hasCoordinateMiss = locationsLoaded && !loading && !error && !locationError && !visibleLocations.length;
  const groupedVisibleLocations = useMemo(() => {
    const grouped = new Map();
    visibleLocations.forEach((location, index) => {
      const key = location.waterbodyName || location.waterbodyRiver || 'Unassigned waterbody';
      const current = grouped.get(key) || {
        key,
        name: key,
        group: location.waterbodyGroup || 'Waterbodies',
        locations: [],
      };
      current.locations.push({ ...location, displayIndex: index + 1 });
      grouped.set(key, current);
    });
    return [...grouped.values()];
  }, [visibleLocations]);
  const toggleWaterbodyGroup = (key) => {
    setCollapsedWaterbodies((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  useEffect(() => {
    if (!mapRenderError) return undefined;
    const modal = Modal.error({
      title: 'Unable to render the 3D map',
      content: mapRenderError,
      okText: 'Dismiss',
      afterClose: () => setMapRenderError(''),
    });
    return () => modal.destroy();
  }, [mapRenderError]);

  return (
    <div className="map3d-page">
      <Card className="map3d-header" size="small">
        <div>
          <p>Cesium 3D Waterbody Map</p>
          <h2>{selected?.name || 'Waterbody'} &middot; CY {year}</h2>
        </div>
        <Space className="map3d-controls" size="middle" wrap>
          <label>
            <span>Waterbody</span>
            <Select
              value={activeWaterbodyKey}
              onChange={setWaterbodyKey}
              options={waterbodySelectOptions}
              showSearch
              optionFilterProp="searchLabel"
              popupClassName="wqm-map-select-popup map3d-waterbody-popup"
              getPopupContainer={(trigger) => trigger.parentElement}
              style={{ minWidth: 240 }}
            />
          </label>
          <label className="map3d-scope-field">
            <span>Station Scope</span>
            <Select
              value={stationScope}
              onChange={(value) => setShowAllStations(value === 'all')}
              options={[
                { value: 'selected', label: 'Selected waterbody' },
                { value: 'all', label: 'Show all stations' },
              ]}
              popupClassName="wqm-map-select-popup map3d-waterbody-popup"
              getPopupContainer={(trigger) => trigger.parentElement}
              style={{ minWidth: 190 }}
            />
          </label>
        </Space>
      </Card>

      {(loading || error || locationError || hasCoordinateMiss) && (
        <Card className="map3d-state" size="small">
          {loading && <div className="app-loading compact"><span />Loading published WQM dataset...</div>}
          {!loading && error && <p>{error}</p>}
          {!loading && locationError && <p>{locationError}</p>}
          {hasCoordinateMiss && <p>No station coordinates matched this waterbody.</p>}
        </Card>
      )}

      <section className="map3d-stage">
        <CesiumStationMap
          locations={visibleLocations}
          waterbodyName={selected?.name || 'Waterbody'}
          height={620}
          defaultTerrainEnabled
          defaultBuildingsEnabled
          birdseye
          onRenderError={setMapRenderError}
          emptyMessage="No station coordinates matched this waterbody."
        />
      </section>

      {!!visibleLocations.length && (
        <Card className="map3d-station-details" size="small">
          <div className="map3d-details-head">
            <div>
              <p>Mapped station details</p>
              <h3>{showAllStations ? 'All mapped stations' : selected?.name}</h3>
            </div>
            <Tag color="blue">{visibleLocations.length} coordinate points</Tag>
          </div>
          <div className="map3d-waterbody-groups">
            {groupedVisibleLocations.map((group) => (
              <section className="map3d-waterbody-group" key={group.key}>
                <div className="map3d-waterbody-group-head">
                  <Button
                    type="text"
                    size="small"
                    className="map3d-group-toggle"
                    icon={collapsedWaterbodies.has(group.key) ? <RightOutlined /> : <DownOutlined />}
                    onClick={() => toggleWaterbodyGroup(group.key)}
                    aria-label={`${collapsedWaterbodies.has(group.key) ? 'Expand' : 'Collapse'} ${group.name}`}
                  />
                  <span style={{ '--group-color': getGroupColor(group.group) }} />
                  <button type="button" onClick={() => toggleWaterbodyGroup(group.key)}>
                    {group.name}
                  </button>
                  {/* <Tag>{group.locations.length} station{group.locations.length === 1 ? '' : 's'}</Tag> */}
                </div>
                {!collapsedWaterbodies.has(group.key) && (
                  <div className="map3d-detail-grid">
                    {group.locations.map((location) => (
                      <Card className="map3d-detail-card" size="small" key={`${location.id}-${location.lat}-${location.lng}`}>
                        <div className="map3d-detail-index" style={{ background: getGroupColor(location.waterbodyGroup) }}>
                          {location.displayIndex}
                        </div>
                        <div className="map3d-detail-body">
                          <strong>{location.station || location.id || `Station ${location.displayIndex}`}</strong>
                          <span>{getStationAddress(location)}</span>
                          <code>{formatCoordinates(location)}</code>
                        </div>
                      </Card>
                    ))}
                  </div>
                )}
              </section>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
};

export default Waterbody3DMap;
