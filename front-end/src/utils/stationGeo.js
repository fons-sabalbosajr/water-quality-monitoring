// Shared resolver that maps a waterbody's OWN stations to map coordinates.
//
// This guarantees the maps only ever plot stations that belong to the selected
// waterbody group (no bleed-over from neighbouring waterbodies), applies any
// admin coordinate/label overrides from the Waterbody Profiles settings, and
// attaches the full station record so popups can show live monitoring metrics.

import encryptedStorage from './encryptedStorage';

export const WATERBODY_PROFILE_KEY = 'wqms_waterbody_profile_settings';
export const WATERBODY_PROFILE_EVENT = 'wqms:waterbody-profile-settings';

const normalizeForMatch = (value) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

export const getStationAssignmentKey = (waterbodyKey, station) =>
  [
    waterbodyKey,
    station?.stnNo ?? '',
    station?.stnId ?? '',
    station?.address ?? '',
  ].join('::');

const getLocationStationNumber = (location) => {
  const match = String(location?.id || '').match(/(?:^|_)(\d+)$/);
  return match ? Number(match[1]) : null;
};

const parseCoordinateValue = (value) => {
  if (value === '' || value === null || value === undefined) return NaN;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : NaN;
};

export const getStoredWaterbodyProfiles = () => {
  try {
    return encryptedStorage.getItem(WATERBODY_PROFILE_KEY) || {};
  } catch {
    return {};
  }
};

// Display name applied from the Waterbody Profiles "Profile Name" override.
export const getWaterbodyDisplayName = (profiles, key, fallback) => {
  const profile = profiles?.[key];
  const name = profile?.profileName || profile?.assignedWaterbody;
  return (name && String(name).trim()) || fallback;
};

// Best-effort match of a single station to a workbook coordinate row, scoped to
// the waterbody so we never borrow a coordinate from a different waterbody.
const matchWorkbookLocation = (station, waterbody, workbookLocations) => {
  const waterbodyName = normalizeForMatch(waterbody?.name);
  const stationNo = Number(station?.stnNo);
  const stationValues = [station?.stnId, station?.address]
    .map(normalizeForMatch)
    .filter(Boolean);

  // Pass 1: same waterbody + matching station number.
  const sameWaterbody = workbookLocations.filter((location) => {
    const locWb = normalizeForMatch(location.waterbodyRiver || location.waterbodyLoc);
    return !waterbodyName || !locWb || locWb === waterbodyName || locWb.includes(waterbodyName) || waterbodyName.includes(locWb);
  });

  if (Number.isFinite(stationNo)) {
    const byNumber = sameWaterbody.find(
      (location) => getLocationStationNumber(location) === stationNo,
    );
    if (byNumber) return byNumber;
  }

  // Pass 2: same waterbody + matching station/barangay name.
  const byName = sameWaterbody.find((location) => {
    const locValues = [location.station, location.barangay, location.province]
      .map(normalizeForMatch)
      .filter(Boolean);
    return stationValues.some((value) =>
      locValues.some(
        (locValue) =>
          value === locValue ||
          value.includes(locValue) ||
          locValue.includes(value),
      ),
    );
  });
  return byName || null;
};

/**
 * Resolve the map-ready locations for a single waterbody.
 *
 * @param {object} waterbody  { key, name, province }
 * @param {Array}  stations   the waterbody's station records (from the sheet)
 * @param {Array}  workbookLocations  parsed station coordinate workbook rows
 * @param {object} profiles   stored waterbody profile settings (overrides)
 * @returns {Array} location objects ready for <CesiumStationMap>
 */
export const resolveWaterbodyMapLocations = (
  waterbody,
  stations,
  workbookLocations,
  profiles = getStoredWaterbodyProfiles(),
) => {
  if (!waterbody || !stations?.length) return [];

  const profile = profiles?.[waterbody.key] || {};
  const overrides = profile.stationOverrides || {};
  const assignments = profile.stationAssignments || {};
  const displayName = getWaterbodyDisplayName(profiles, waterbody.key, waterbody.name);

  return stations
    .map((station, index) => {
      const assignmentKey = getStationAssignmentKey(waterbody.key, station);

      // Station reassigned to a different waterbody — exclude it here.
      const assignedTo = assignments[assignmentKey];
      if (assignedTo && assignedTo !== waterbody.key) return null;

      const override = overrides[assignmentKey] || {};
      const workbook = matchWorkbookLocation(station, waterbody, workbookLocations);

      const lat = Number.isFinite(parseCoordinateValue(override.lat))
        ? parseCoordinateValue(override.lat)
        : workbook?.lat;
      const lng = Number.isFinite(parseCoordinateValue(override.lng))
        ? parseCoordinateValue(override.lng)
        : workbook?.lng;

      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

      const stationName = String(override.name || station.stnId || `Station ${index + 1}`);
      const address = String(override.address || station.address || '');
      const addressParts = address.split(',').map((part) => part.trim()).filter(Boolean);

      return {
        id: assignmentKey,
        station: stationName,
        stationData: station,
        markerNumber: station.stnNo ?? index + 1,
        waterbodyName: displayName,
        waterbodyRiver: displayName,
        waterbodyLoc: '',
        barangay: workbook?.barangay || addressParts[0] || '',
        province: workbook?.province || waterbody.province || addressParts[addressParts.length - 1] || '',
        address,
        lat,
        lng,
      };
    })
    .filter(Boolean);
};

/**
 * React-friendly snapshot reader for the stored profile settings, with a live
 * subscription so maps re-resolve when an admin edits coordinates or names.
 */
export const subscribeWaterbodyProfiles = (callback) => {
  const handler = () => callback(getStoredWaterbodyProfiles());
  window.addEventListener(WATERBODY_PROFILE_EVENT, handler);
  window.addEventListener('storage', handler);
  return () => {
    window.removeEventListener(WATERBODY_PROFILE_EVENT, handler);
    window.removeEventListener('storage', handler);
  };
};
