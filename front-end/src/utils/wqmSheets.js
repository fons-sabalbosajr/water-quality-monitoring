import { useEffect, useMemo, useState } from 'react';
import wqmData from '../data/wqm2026.json';
import api from '../api/axios';
import encryptedStorage from './encryptedStorage';
import { getStations, hasNumericReading, toTitle } from './wqmData';

export const WQM_DRAFTS_KEY = 'wqm_2026_drafts';
export const WQM_DRAFTS_EVENT = 'wqm:drafts-updated';
export const WQM_PUBLISHED_YEAR_KEY = 'wqms_visualization_year';
export const WQM_PUBLISHED_YEAR_EVENT = 'wqms:visualization-year';
export const WQM_YEAR_OPTIONS = [2026, 2025, 2024];
export const DEFAULT_WQM_YEAR = 2026;

// ── Custom monitoring-year templates (e.g. 2027, 2028) ─────────────────────
// Admins/developers can create new monitoring plans for future years from the
// Tabular Results page. Each custom year is stored locally as its own encrypted
// draft (wqm_{year}_drafts) and registered in this list so the navigation can
// surface it.
export const CUSTOM_YEARS_KEY = 'wqms_custom_tabular_years';
export const CUSTOM_YEARS_EVENT = 'wqms:custom-years';

export const getCustomTabularYears = () => {
  try {
    const list = encryptedStorage.getItem(CUSTOM_YEARS_KEY);
    return Array.isArray(list)
      ? [...new Set(list.map(Number).filter((y) => Number.isInteger(y)))]
      : [];
  } catch {
    return [];
  }
};

export const getAllTabularYears = () =>
  [...new Set([...WQM_YEAR_OPTIONS, ...getCustomTabularYears()])].sort(
    (a, b) => b - a,
  );

export const isCustomTabularYear = (year) =>
  getCustomTabularYears().includes(Number(year));

// Build empty sheets (no readings) for a new monitoring year from a set of
// existing waterbody sheets, preserving the exact 2026-template structure:
// waterbody key/name/class, per-station identity (no., id, address, class),
// the full parameter set (blank monthly + avg), and a blank Date-of-Sampling row.
export const buildBlankYearSheets = (sourceSheets, selectedKeys) => {
  const keys = new Set(selectedKeys);
  return sourceSheets
    .filter((sheet) => keys.has(sheet.key))
    .map((sheet) => ({
      key: sheet.key,
      name: sheet.name,
      classInfo: sheet.classInfo || '',
      ...(sheet.periodLabels ? { periodLabels: sheet.periodLabels } : {}),
      stations: getStations(sheet).map((station) => ({
        stnNo: station.stnNo,
        stnId: station.stnId,
        address: station.address || '',
        classInfo: station.classInfo || '',
        samplingDates: Array(12).fill(null),
        params: Object.fromEntries(
          Object.keys(station.params || {}).map((param) => [
            param,
            { monthly: Array(12).fill(null), avg: null },
          ]),
        ),
      })),
    }));
};

export const createTabularYear = (year, sheets) => {
  const numericYear = Number(year);
  if (!Number.isInteger(numericYear)) return false;
  encryptedStorage.setItem(`wqm_${numericYear}_drafts`, sheets);
  if (
    !WQM_YEAR_OPTIONS.includes(numericYear) &&
    !getCustomTabularYears().includes(numericYear)
  ) {
    encryptedStorage.setItem(CUSTOM_YEARS_KEY, [
      ...getCustomTabularYears(),
      numericYear,
    ]);
  }
  window.dispatchEvent(new CustomEvent(CUSTOM_YEARS_EVENT, { detail: numericYear }));
  return true;
};

export const removeTabularYear = (year) => {
  const numericYear = Number(year);
  encryptedStorage.removeItem(`wqm_${numericYear}_drafts`);
  encryptedStorage.setItem(
    CUSTOM_YEARS_KEY,
    getCustomTabularYears().filter((y) => y !== numericYear),
  );
  window.dispatchEvent(new CustomEvent(CUSTOM_YEARS_EVENT, { detail: numericYear }));
};

export const useTabularYears = () => {
  const [years, setYears] = useState(getAllTabularYears);
  useEffect(() => {
    const refresh = () => setYears(getAllTabularYears());
    window.addEventListener(CUSTOM_YEARS_EVENT, refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener(CUSTOM_YEARS_EVENT, refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);
  return years;
};

export const WQM_WATERBODY_GROUPS = [
  {
    label: 'Priority Water Bodies',
    keys: ['BOCAUE', 'SANTA_MARIA_RIVER'],
  },
  {
    label: 'Other Water Bodies',
    keys: [
      'PAMPANGA_RIVER', 'LABANGAN', 'ANGAT_R4L', 'TALAVERA_RIVER',
      'BAGSIT', 'PUDOC_RIVER', 'PALAKOL',
    ],
  },
  {
    label: 'Remaining WQM 2026 Sheets',
    keys: [
      'BALER_BAY', 'BATAAN_COAST', 'BATHING_BEACHES', 'JUNESS',
      'MONTEMAR_BC', 'TALISAY_RIVER', 'MOUTH_OF_TALISAY', 'BULACAN_COAST',
      'ATLAG', 'HAGONOY', 'MARILAO', 'MEYCAUAYAN', 'OBANDO',
      'MOUTH_OF_OBANDO', 'PAMPANGA_COAST', 'PAMPANGA_UPSTREAM',
      'ASFMSRS', 'GUAGUA', 'MOUTH_OF_PAMPANGA', 'LUCONG_RIVER',
      'SUBIC_BAY', 'MASINLOC_OYON_BAY', 'ZAMBALES BAY',
    ],
  },
];

export const WATERBODY_PROVINCE = {
  BALER_BAY: 'Aurora',
  PUDOC_RIVER: 'Aurora',
  BATAAN_COAST: 'Bataan',
  BATHING_BEACHES: 'Bataan',
  JUNESS: 'Bataan',
  MONTEMAR_BC: 'Bataan',
  TALISAY_RIVER: 'Bataan',
  MOUTH_OF_TALISAY: 'Bataan',
  ANGAT_R4L: 'Bulacan',
  ATLAG: 'Bulacan',
  BOCAUE: 'Bulacan',
  BULACAN_COAST: 'Bulacan',
  HAGONOY: 'Bulacan',
  LABANGAN: 'Bulacan',
  MARILAO: 'Bulacan',
  MEYCAUAYAN: 'Bulacan',
  MOUTH_OF_OBANDO: 'Bulacan',
  OBANDO: 'Bulacan',
  SANTA_MARIA_RIVER: 'Bulacan',
  TALAVERA_RIVER: 'Nueva Ecija',
  PAMPANGA_UPSTREAM: 'Nueva Ecija',
  ASFMSRS: 'Pampanga',
  GUAGUA: 'Pampanga',
  MOUTH_OF_PAMPANGA: 'Pampanga',
  PALAKOL: 'Pampanga',
  PAMPANGA_COAST: 'Pampanga',
  PAMPANGA_RIVER: 'Pampanga',
  LUCONG_RIVER: 'Tarlac',
  BAGSIT: 'Zambales',
  MASINLOC_OYON_BAY: 'Zambales',
  SUBIC_BAY: 'Zambales',
  'ZAMBALES BAY': 'Zambales',
};

const WATERBODY_GROUP_LOOKUP = WQM_WATERBODY_GROUPS.reduce((lookup, group, groupIndex) => {
  group.keys.forEach((key, keyIndex) => {
    lookup[key] = { group: group.label, groupIndex, sortIndex: keyIndex };
  });
  return lookup;
}, {});

const getWaterbodyGroupInfo = (key, fallbackIndex = 0) => (
  WATERBODY_GROUP_LOOKUP[key] || {
    group: 'Waterbodies',
    groupIndex: WQM_WATERBODY_GROUPS.length,
    sortIndex: fallbackIndex,
  }
);

const clone = (value) => JSON.parse(JSON.stringify(value));

export const normalizeWqmYear = (year) => {
  const numericYear = Number(year);
  return WQM_YEAR_OPTIONS.includes(numericYear) ? numericYear : DEFAULT_WQM_YEAR;
};

export const buildSheets = (source = wqmData) => Object.entries(source)
  .map(([key, val]) => ({
    key,
    name: val.name ? toTitle(val.name) : toTitle(key),
    classInfo: val.classInfo || '',
    stations: getStations(val),
  }))
  .filter((sheet) => sheet.stations.some(hasNumericReading));

export const INITIAL_SHEETS = buildSheets();

export const getStoredWqmSheets = () => encryptedStorage.getItem(WQM_DRAFTS_KEY) || clone(INITIAL_SHEETS);

export const saveStoredWqmSheets = (sheets) => {
  encryptedStorage.setItem(WQM_DRAFTS_KEY, sheets);
  window.dispatchEvent(new CustomEvent(WQM_DRAFTS_EVENT));
};

export const resetStoredWqmSheets = () => {
  encryptedStorage.removeItem(WQM_DRAFTS_KEY);
  window.dispatchEvent(new CustomEvent(WQM_DRAFTS_EVENT));
};

/**
 * Read the locally cached (encrypted storage) sheets for any year.
 * For 2026 this is the live draft; for 2024/2025 this is a locally-cached
 * copy (fetched and stored after an import or a save).
 */
export const getYearSheetsLocal = (year) => {
  if (year === DEFAULT_WQM_YEAR) return getStoredWqmSheets();
  return encryptedStorage.getItem(`wqm_${year}_drafts`) || null;
};

/**
 * Persist edited sheets for a specific year locally so ChartConfiguration and
 * other multi-year views pick up the corrections immediately, without a page
 * reload.  For 2026 the live draft store is updated.
 */
export const saveYearSheetsLocal = (year, sheets) => {
  if (year === DEFAULT_WQM_YEAR) {
    saveStoredWqmSheets(sheets);
    return;
  }
  encryptedStorage.setItem(`wqm_${year}_drafts`, sheets);
  // Fire the same draft event so any hook listening on multi-year data refreshes.
  window.dispatchEvent(new CustomEvent(WQM_DRAFTS_EVENT));
};

export const getLocalPublishedWqmYear = () => normalizeWqmYear(encryptedStorage.getItem(WQM_PUBLISHED_YEAR_KEY));

export const publishWqmYear = (nextYear) => {
  const year = normalizeWqmYear(nextYear);
  encryptedStorage.setItem(WQM_PUBLISHED_YEAR_KEY, String(year));
  window.dispatchEvent(new CustomEvent(WQM_PUBLISHED_YEAR_EVENT, { detail: year }));
  return year;
};

export const getReadableStations = (sheet) => getStations(sheet).filter(hasNumericReading);

// All valid station records for a sheet, including newly added stations that do
// not yet have any numeric readings. Used by the Waterbody Profiles editor so
// freshly created stations can be assigned coordinates.
export const getAllStations = (sheet) => getStations(sheet);

// Display-name override applied from the Waterbody Profiles "Profile Name"
// setting so renamed waterbodies appear consistently across the whole app.
export const getWaterbodyProfileName = (key, fallback) => {
  try {
    const profiles = encryptedStorage.getItem('wqms_waterbody_profile_settings') || {};
    const profile = profiles[key];
    const name = profile?.profileName || profile?.assignedWaterbody;
    return (name && String(name).trim()) || fallback;
  } catch {
    return fallback;
  }
};

export const useWqmSheets = () => {
  const [sheets, setSheets] = useState(getStoredWqmSheets);

  useEffect(() => {
    const refresh = () => setSheets(getStoredWqmSheets());
    window.addEventListener(WQM_DRAFTS_EVENT, refresh);
    window.addEventListener('storage', refresh);
    // Refresh when a waterbody profile name/assignment changes so renamed
    // waterbodies update everywhere immediately (new array reference forces
    // dependent buildWaterbodyOptions() memos to recompute with the new name).
    window.addEventListener('wqms:waterbody-profile-settings', refresh);
    return () => {
      window.removeEventListener(WQM_DRAFTS_EVENT, refresh);
      window.removeEventListener('storage', refresh);
      window.removeEventListener('wqms:waterbody-profile-settings', refresh);
    };
  }, []);

  return useMemo(() => sheets, [sheets]);
};

export const usePublishedWqmYear = () => {
  const [year, setYear] = useState(getLocalPublishedWqmYear);

  useEffect(() => {
    let mounted = true;
    api.get('/water/visualization-year')
      .then(({ data }) => {
        if (mounted) setYear(publishWqmYear(data?.year));
      })
      .catch(() => {
        if (mounted) setYear(getLocalPublishedWqmYear());
      });

    const refresh = (event) => {
      setYear(normalizeWqmYear(event.detail || encryptedStorage.getItem(WQM_PUBLISHED_YEAR_KEY)));
    };
    window.addEventListener(WQM_PUBLISHED_YEAR_EVENT, refresh);
    window.addEventListener('storage', refresh);
    return () => {
      mounted = false;
      window.removeEventListener(WQM_PUBLISHED_YEAR_EVENT, refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);

  const setPublishedYear = (nextYear) => setYear(publishWqmYear(nextYear));

  return { year, setPublishedYear };
};

export const usePublishedWqmDataset = () => {
  const localSheets = useWqmSheets();
  const { year, setPublishedYear } = usePublishedWqmYear();
  const [remoteSheets, setRemoteSheets] = useState([]);
  const [loading, setLoading] = useState(year !== DEFAULT_WQM_YEAR);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  // Re-read whenever any year's draft is saved or pushed so edits to past-year
  // data (e.g. from Waterbody Profiles & Station Locations) propagate to every
  // view — Dashboard, Visualizations, Waterbody Profiles, etc.
  useEffect(() => {
    const bump = () => setReloadKey((key) => key + 1);
    window.addEventListener(WQM_DRAFTS_EVENT, bump);
    window.addEventListener('storage', bump);
    return () => {
      window.removeEventListener(WQM_DRAFTS_EVENT, bump);
      window.removeEventListener('storage', bump);
    };
  }, []);

  useEffect(() => {
    if (year === DEFAULT_WQM_YEAR) {
      queueMicrotask(() => {
        setRemoteSheets([]);
        setLoading(false);
        setError('');
      });
      return undefined;
    }

    let cancelled = false;

    // Prefer the locally-cached (possibly admin-edited) copy of the past year so
    // corrections appear immediately across the app; fall back to the server.
    const local = encryptedStorage.getItem(`wqm_${year}_drafts`);
    if (Array.isArray(local) && local.length) {
      queueMicrotask(() => {
        if (!cancelled) {
          setRemoteSheets(local);
          setLoading(false);
          setError('');
        }
      });
      return () => { cancelled = true; };
    }

    queueMicrotask(() => {
      if (!cancelled) {
        setLoading(true);
        setError('');
      }
    });
    api.get(`/water/wqm/${year}`)
      .then((response) => {
        if (!cancelled) {
          const sheets = response.data?.sheets || [];
          if (sheets.length) encryptedStorage.setItem(`wqm_${year}_drafts`, sheets);
          setRemoteSheets(sheets);
        }
      })
      .catch((requestError) => {
        if (!cancelled) {
          setRemoteSheets([]);
          setError(requestError.response?.data?.message || `Unable to load WQM ${year} data.`);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [year, reloadKey]);

  return {
    year,
    sheets: year === DEFAULT_WQM_YEAR ? localSheets : remoteSheets,
    loading,
    error,
    setPublishedYear,
  };
};

/**
 * Given a list of years, fetch/serve the sheets for each one and return them
 * as a Map<year, sheets[]>.  2026 comes from encrypted local storage; 2024 and
 * 2025 are fetched from the API (same path as usePublishedWqmDataset).
 * The hook re-fetches whenever the years array reference changes.
 */
export const useAllYearSheets = (years) => {
  const localSheets = useWqmSheets();
  const [cache, setCache] = useState(() => new Map());
  const [loading, setLoading] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const yearsKey = [...years].sort((a, b) => a - b).join(',');

  // Re-read whenever any year's draft is saved/pushed so live edits to past-year
  // data refresh Chart Configuration and the settings panel immediately.
  useEffect(() => {
    const bump = () => setReloadKey((key) => key + 1);
    window.addEventListener(WQM_DRAFTS_EVENT, bump);
    window.addEventListener('storage', bump);
    return () => {
      window.removeEventListener(WQM_DRAFTS_EVENT, bump);
      window.removeEventListener('storage', bump);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const remoteYears = years.filter((y) => y !== DEFAULT_WQM_YEAR);
    if (!remoteYears.length) {
      setLoading(false);
      return undefined;
    }
    setLoading(true);
    Promise.all(
      remoteYears.map((yr) => {
        // If we already have a locally-cached copy (e.g. after a previous
        // fetch or after the admin edits+saves that year), use it immediately
        // without hitting the network.
        const local = encryptedStorage.getItem(`wqm_${yr}_drafts`);
        if (Array.isArray(local) && local.length) {
          return Promise.resolve([yr, local]);
        }
        return api
          .get(`/water/wqm/${yr}`)
          .then((res) => {
            const sheets = res.data?.sheets || [];
            // Cache locally so future renders are instant.
            if (sheets.length) encryptedStorage.setItem(`wqm_${yr}_drafts`, sheets);
            return [yr, sheets];
          })
          .catch(() => [yr, []]);
      }),
    ).then((entries) => {
      if (!cancelled) {
        setCache((prev) => {
          const next = new Map(prev);
          entries.forEach(([yr, sheets]) => next.set(yr, sheets));
          return next;
        });
        setLoading(false);
      }
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [yearsKey, reloadKey]);

  return useMemo(() => {
    const map = new Map(cache);
    if (years.includes(DEFAULT_WQM_YEAR)) map.set(DEFAULT_WQM_YEAR, localSheets);
    return { map, loading };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cache, localSheets, loading, yearsKey]);
};

export const buildWaterbodyOptions = (sheets) => sheets
  .map((sheet, fallbackIndex) => {
    const groupInfo = getWaterbodyGroupInfo(sheet.key, fallbackIndex);
    return {
      key: sheet.key,
      name: getWaterbodyProfileName(sheet.key, sheet.name),
      classInfo: sheet.classInfo || '',
      stations: getReadableStations(sheet),
      group: groupInfo.group,
      groupIndex: groupInfo.groupIndex,
      sortIndex: groupInfo.sortIndex,
      sourceIndex: fallbackIndex,
      province: WATERBODY_PROVINCE[sheet.key] || 'Other',
    };
  })
  .filter((waterbody) => waterbody.stations.length)
  .sort((a, b) => (
    // Province alphabetical first so the dropdowns always flow Aurora → Bataan →
    // Bulacan → …; group/source order are kept as tiebreakers within a province.
    (a.province || 'Other').localeCompare(b.province || 'Other')
    || a.groupIndex - b.groupIndex
    || a.sortIndex - b.sortIndex
    || a.sourceIndex - b.sourceIndex
    || a.name.localeCompare(b.name)
  ))
  .map(({ stations, ...waterbody }) => ({
    ...waterbody,
    stationCount: stations.length,
  }));

export const groupWaterbodyByProvince = (waterbodies) => {
  const groups = new Map();
  [...waterbodies]
    .sort((a, b) => (a.province || 'Other').localeCompare(b.province || 'Other') || a.name.localeCompare(b.name))
    .forEach((wb) => {
      const prov = wb.province || 'Other';
      if (!groups.has(prov)) groups.set(prov, []);
      groups.get(prov).push(wb);
    });
  return [...groups.entries()].map(([province, items]) => ({ province, items }));
};

export const groupWaterbodyOptions = (waterbodies) => {
  const groups = [];
  const byLabel = new Map();

  waterbodies.forEach((waterbody) => {
    const label = waterbody.group || 'Waterbodies';
    if (!byLabel.has(label)) {
      const group = { label, items: [] };
      byLabel.set(label, group);
      groups.push(group);
    }
    byLabel.get(label).items.push(waterbody);
  });

  return groups.filter((group) => group.items.length);
};
