import { useEffect, useMemo, useState } from 'react';
import { Button, Card, Modal, Select, Space, Tag } from 'antd';
import { DownOutlined, RightOutlined } from '@ant-design/icons';
import CesiumStationMap from '../components/CesiumStationMap';
import encryptedStorage from '../utils/encryptedStorage';
import { loadStationLocationsCached } from '../utils/stationWorkbook';
import { resolveWaterbodyMapLocations } from '../utils/stationGeo';
import { buildWaterbodyOptions, getAllStations, usePublishedWqmDataset } from '../utils/wqmSheets';
import './Waterbody3DMap.css';

const WATERBODY_GROUP_COLORS = {
  'Priority Water Bodies': '#f97316',
  'Other Water Bodies': '#14b8a6',
  'Remaining WQM 2026 Sheets': '#6366f1',
  Waterbodies: '#0ea5e9',
};

const getStationAddress = (location) => (
  [location.barangay, location.province].filter(Boolean).join(', ') || 'Address not specified'
);

const formatCoordinates = (location) => `${location.lat.toFixed(6)}, ${location.lng.toFixed(6)}`;

const getGroupColor = (group) => WATERBODY_GROUP_COLORS[group] || '#0ea5e9';

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
    loadStationLocationsCached()
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

  const allResolvedLocations = useMemo(
    () => waterbodies.flatMap((waterbody) => {
      const sheet = sheets.find((s) => s.key === waterbody.key);
      const stationList = getAllStations(sheet);
      return resolveWaterbodyMapLocations(
        { key: waterbody.key, name: waterbody.name, province: waterbody.province },
        stationList,
        stationLocations,
        profileSettings,
      ).map((location) => ({
        ...location,
        assignedWaterbodyKey: waterbody.key,
        waterbodyGroup: waterbody.group || 'Waterbodies',
        markerColor: getGroupColor(waterbody.group),
      }));
    }),
    [profileSettings, sheets, stationLocations, waterbodies],
  );

  const matchedLocations = useMemo(() => {
    if (!selected) return [];
    return allResolvedLocations.filter((location) => location.assignedWaterbodyKey === activeWaterbodyKey);
  }, [activeWaterbodyKey, allResolvedLocations, selected]);

  const visibleLocations = showAllStations ? allResolvedLocations : matchedLocations;
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
              classNames={{ popup: { root: 'wqm-map-select-popup map3d-waterbody-popup' } }}
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
              classNames={{ popup: { root: 'wqm-map-select-popup map3d-waterbody-popup' } }}
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
