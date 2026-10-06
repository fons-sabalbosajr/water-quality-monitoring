import { useCallback, useEffect, useMemo, useState } from 'react';
import wqmData from '../data/wqm2026.json';
import api from '../api/axios';
import encryptedStorage from './encryptedStorage.js';
import { getStations, hasNumericReading, toTitle } from './wqmData.js';
import { needsDownload, titleCaseSheetNames, toVersion } from './yearSync.js';

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
    // getAllTabularYears() builds a new array each call, so an unconditional
    // setState here re-rendered the whole sidebar on every unrelated storage
    // event. Compare contents and keep the existing reference when equal.
    const refresh = () => setYears((current) => {
      const next = getAllTabularYears();
      const same = next.length === current.length && next.every((year, i) => year === current[i]);
      return same ? current : next;
    });
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
    // Quarterly waterbodies carry Q1–Q4 labels; without them the tables and
    // charts label quarterly readings as Jan–Apr.
    ...(Array.isArray(val.periodLabels) ? { periodLabels: val.periodLabels } : {}),
    stations: getStations(val),
  }))
  .filter((sheet) => sheet.stations.some(hasNumericReading));

export const INITIAL_SHEETS = buildSheets();

// When no draft exists this used to return a fresh deep clone of the bundled
// dataset on every call. Each call produced a new array identity, so every
// consumer's useMemo/useEffect saw "changed data" and recomputed the whole
// dashboard. Hold one clone and reuse it until a draft is written or reset.
let bundledSheetsFallback = null;

const getBundledFallback = () => {
  if (!bundledSheetsFallback) bundledSheetsFallback = clone(INITIAL_SHEETS);
  return bundledSheetsFallback;
};

export const getStoredWqmSheets = () => encryptedStorage.getItem(WQM_DRAFTS_KEY) || getBundledFallback();

export const saveStoredWqmSheets = (sheets) => {
  encryptedStorage.setItem(WQM_DRAFTS_KEY, sheets);
  window.dispatchEvent(new CustomEvent(WQM_DRAFTS_EVENT));
};

export const resetStoredWqmSheets = () => {
  encryptedStorage.removeItem(WQM_DRAFTS_KEY);
  // Force a fresh clone so the reset actually restores pristine source data
  // rather than handing back an object a previous editor may have touched.
  bundledSheetsFallback = null;
  window.dispatchEvent(new CustomEvent(WQM_DRAFTS_EVENT));
};

/**
 * Read the locally cached (encrypted storage) sheets for any year — this
 * browser's copy of the MongoDB year (see revalidateYear). For 2026 it falls
 * back to the bundled workbook snapshot before the first sync.
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

// Cached per sheet, like getStations(). buildWaterbodyOptions() calls this once
// per waterbody on every invocation, and several views call it again per render.
const readableStationsCache = new WeakMap();
const EMPTY_READABLE = Object.freeze([]);

export const getReadableStations = (sheet) => {
  if (!sheet || typeof sheet !== 'object') return EMPTY_READABLE;
  const cached = readableStationsCache.get(sheet);
  if (cached) return cached;
  const stations = getStations(sheet).filter(hasNumericReading);
  readableStationsCache.set(sheet, stations);
  return stations;
};

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
    // Bail out when the stored reference is unchanged. Profile-settings and
    // cross-tab storage events fire for unrelated keys too; without this guard
    // every one of them re-rendered every consumer of this hook.
    const refresh = () => setSheets((current) => {
      const next = getStoredWqmSheets();
      return next === current ? current : next;
    });
    // A renamed waterbody must still propagate even though the sheets object is
    // untouched, so this listener forces a new identity.
    const forceRefresh = () => setSheets(() => {
      const next = getStoredWqmSheets();
      return Array.isArray(next) ? [...next] : next;
    });

    // Pull the MongoDB copy of the live year on mount and whenever the tab
    // regains focus. Deduped and TTL-limited inside revalidateYear, so the
    // many components using this hook share one cheap meta request.
    const sync = () => { revalidateYear(DEFAULT_WQM_YEAR); };
    sync();

    window.addEventListener(WQM_DRAFTS_EVENT, refresh);
    window.addEventListener('storage', refresh);
    window.addEventListener('wqms:waterbody-profile-settings', forceRefresh);
    window.addEventListener('focus', sync);
    return () => {
      window.removeEventListener(WQM_DRAFTS_EVENT, refresh);
      window.removeEventListener('storage', refresh);
      window.removeEventListener('wqms:waterbody-profile-settings', forceRefresh);
      window.removeEventListener('focus', sync);
    };
  }, []);

  return sheets;
};

// ── Shared published-year store ─────────────────────────────────────────────
// Every component using usePublishedWqmDataset() previously fired its own
// GET /water/visualization-year on mount. On the dashboard that is Home, the
// dashboard view, Visualizations and the 3D map — four identical requests per
// navigation. One module-level store fetches once, dedupes concurrent callers,
// and pushes the result to every subscriber.
const yearSubscribers = new Set();
let yearFetchPromise = null;
let yearFetchedAt = 0;
const YEAR_TTL_MS = 5 * 60 * 1000;

const notifyYearSubscribers = (year) => {
  yearSubscribers.forEach((listener) => listener(year));
};

const fetchPublishedYear = (isPublic) => {
  const fresh = Date.now() - yearFetchedAt < YEAR_TTL_MS;
  if (yearFetchPromise || fresh) return yearFetchPromise || Promise.resolve(getLocalPublishedWqmYear());

  const endpoint = isPublic ? '/water/public/visualization-year' : '/water/visualization-year';
  yearFetchPromise = api.get(endpoint)
    .then(({ data }) => {
      yearFetchedAt = Date.now();
      const year = publishWqmYear(data?.year);
      notifyYearSubscribers(year);
      return year;
    })
    .catch(() => getLocalPublishedWqmYear())
    .finally(() => { yearFetchPromise = null; });

  return yearFetchPromise;
};

/**
 * @param {{ isPublic?: boolean }} options — pass isPublic on unauthenticated
 * routes so the public endpoint is used instead of one that requires a token.
 */
export const usePublishedWqmYear = ({ isPublic = false } = {}) => {
  const [year, setYear] = useState(getLocalPublishedWqmYear);

  useEffect(() => {
    let mounted = true;
    const listener = (next) => { if (mounted) setYear(next); };
    yearSubscribers.add(listener);

    fetchPublishedYear(isPublic).then((next) => {
      if (mounted) setYear(next);
    });

    const refresh = (event) => {
      setYear(normalizeWqmYear(event?.detail || encryptedStorage.getItem(WQM_PUBLISHED_YEAR_KEY)));
    };
    window.addEventListener(WQM_PUBLISHED_YEAR_EVENT, refresh);
    window.addEventListener('storage', refresh);
    return () => {
      mounted = false;
      yearSubscribers.delete(listener);
      window.removeEventListener(WQM_PUBLISHED_YEAR_EVENT, refresh);
      window.removeEventListener('storage', refresh);
    };
  }, [isPublic]);

  const setPublishedYear = useCallback((nextYear) => {
    const applied = publishWqmYear(nextYear);
    yearFetchedAt = Date.now();
    setYear(applied);
    return applied;
  }, []);

  return { year, setPublishedYear };
};

// ── MongoDB sync for stored years ───────────────────────────────────────────
// Every year in WQM_YEAR_OPTIONS lives in MongoDB. Each browser keeps an
// encrypted local copy for instant rendering, stamped with the server's
// importedAt. Two bugs this replaces:
//   • 2026 was never sent to or read from the server, so an admin's edits
//     stayed in that admin's browser and the public dashboard kept showing
//     the bundled workbook snapshot.
//   • 2024/2025 were cached on first fetch and never re-checked, so saves made
//     from another device never appeared until storage was cleared.
// Now the local copy is served immediately and revalidated against a tiny
// meta endpoint; the full year is downloaded only when its version changed.
const yearDraftKey = (year) => `wqm_${year}_drafts`;
const yearMetaKey = (year) => `wqm_${year}_meta`;
const REVALIDATE_TTL_MS = 60 * 1000;

export const isServerYear = (year) => WQM_YEAR_OPTIONS.includes(Number(year));

const getLocalVersion = (year) => encryptedStorage.getItem(yearMetaKey(year))?.importedAt || null;

const setLocalVersion = (year, importedAt) => {
  encryptedStorage.setItem(yearMetaKey(year), { importedAt: toVersion(importedAt) });
};

const normalizeLiveSheets = (year, sheets) => (
  Number(year) === DEFAULT_WQM_YEAR ? titleCaseSheetNames(sheets) : sheets
);

const writeYearCache = (year, sheets, importedAt) => {
  encryptedStorage.setItem(yearDraftKey(year), normalizeLiveSheets(year, sheets));
  setLocalVersion(year, importedAt);
  window.dispatchEvent(new CustomEvent(WQM_DRAFTS_EVENT, { detail: { year } }));
};

const lastRevalidated = new Map();
const revalidations = new Map();

/**
 * Bring this browser's copy of a stored year up to date with MongoDB.
 * Resolves to 'updated' (local copy replaced), 'current' or 'offline' (server
 * unreachable — the local copy, or the bundled 2026 snapshot, stays in use).
 * Local edits whose save failed are kept until the server copy changes.
 * @param {number} year
 * @param {{ force?: boolean }} [options] force skips the TTL; it never discards
 *   an up-to-date local copy.
 */
export const revalidateYear = (year, { force = false } = {}) => {
  const numericYear = Number(year);
  if (!isServerYear(numericYear)) return Promise.resolve('current');
  if (revalidations.has(numericYear)) return revalidations.get(numericYear);
  if (!force && Date.now() - (lastRevalidated.get(numericYear) || 0) < REVALIDATE_TTL_MS) {
    return Promise.resolve('current');
  }
  lastRevalidated.set(numericYear, Date.now());

  const downloadYear = () => api.get(`/water/public/wqm/${numericYear}`).then(({ data }) => {
    const sheets = data?.sheets || [];
    if (!sheets.length) return 'offline';
    writeYearCache(numericYear, sheets, data?.importedAt);
    return 'updated';
  });

  const run = api.get(`/water/public/wqm/${numericYear}/meta`)
    .then(({ data }) => (
      needsDownload({
        hasLocal: Array.isArray(encryptedStorage.getItem(yearDraftKey(numericYear))),
        serverVersion: data?.importedAt,
        localVersion: getLocalVersion(numericYear),
      }) ? downloadYear() : 'current'
    ))
    // A 404 means the meta route or the stored year is missing (e.g. an older
    // server). Fall back to the full endpoint, which also auto-imports a year.
    .catch((error) => (error.response?.status === 404 ? downloadYear() : 'offline'))
    .catch(() => 'offline')
    .finally(() => { revalidations.delete(numericYear); });

  revalidations.set(numericYear, run);
  return run;
};

/** Discard local edits for a stored year and reload the MongoDB copy. */
export const refetchYearFromServer = async (year) => {
  const { data } = await api.get(`/water/wqm/${year}`);
  const sheets = data?.sheets || [];
  if (!sheets.length) throw new Error(`MongoDB has no WQM ${year} data.`);
  writeYearCache(year, sheets, data?.importedAt);
  lastRevalidated.set(Number(year), Date.now());
  return encryptedStorage.getItem(yearDraftKey(year));
};

/**
 * Save a stored year to MongoDB (admin/developer). Stamping the local copy with
 * the returned version stops the next revalidation from re-downloading what
 * this browser just uploaded.
 */
export const saveYearToServer = async (year, sheets) => {
  const { data } = await api.put(`/water/wqm/${year}`, { sheets });
  setLocalVersion(year, data?.importedAt);
  lastRevalidated.set(Number(year), Date.now());
  return data;
};

// ── Shared archive-year fetcher ─────────────────────────────────────────────
// Concurrent callers for the same year (dashboard + visualizations + settings
// preview all mounting at once) previously each issued their own request for a
// multi-MB payload. Dedupe by year for the lifetime of the in-flight request.
const yearRequests = new Map();

const fetchYearSheets = (year, isPublic = false) => {
  const cached = encryptedStorage.getItem(yearDraftKey(year));
  if (Array.isArray(cached) && cached.length) {
    // Serve the cached copy instantly and check the server in the background.
    // A newer version is written to the cache and announced on
    // WQM_DRAFTS_EVENT, which makes every year hook re-read it.
    revalidateYear(year);
    return Promise.resolve(cached);
  }

  const cacheKey = `${isPublic ? 'public' : 'auth'}:${year}`;
  const inFlight = yearRequests.get(cacheKey);
  if (inFlight) return inFlight;

  const endpoint = isPublic ? `/water/public/wqm/${year}` : `/water/wqm/${year}`;
  const request = api.get(endpoint)
    .then((response) => {
      const sheets = response.data?.sheets || [];
      if (sheets.length) {
        encryptedStorage.setItem(yearDraftKey(year), sheets);
        setLocalVersion(year, response.data?.importedAt);
        lastRevalidated.set(Number(year), Date.now());
      }
      return sheets;
    })
    .finally(() => { yearRequests.delete(cacheKey); });

  yearRequests.set(cacheKey, request);
  return request;
};

const EMPTY_SHEETS = Object.freeze([]);

/**
 * @param {{ isPublic?: boolean }} options
 */
export const usePublishedWqmDataset = ({ isPublic = false } = {}) => {
  const localSheets = useWqmSheets();
  const { year, setPublishedYear } = usePublishedWqmYear({ isPublic });
  // Remote state is stored together with the year it belongs to. Keeping them
  // in one object means switching years cannot momentarily pair the new year
  // with the previous year's sheets, and lets the effect avoid resetting state
  // synchronously just to clear stale data.
  const [remote, setRemote] = useState({ year: null, sheets: EMPTY_SHEETS, error: '' });
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
    // 2026 is read through useWqmSheets, which syncs it with MongoDB itself.
    if (year === DEFAULT_WQM_YEAR) return undefined;
    const sync = () => { revalidateYear(year); };
    window.addEventListener('focus', sync);
    return () => window.removeEventListener('focus', sync);
  }, [year]);

  useEffect(() => {
    if (year === DEFAULT_WQM_YEAR) return undefined;

    let cancelled = false;
    fetchYearSheets(year, isPublic)
      .then((sheets) => {
        if (!cancelled) setRemote({ year, sheets: sheets.length ? sheets : EMPTY_SHEETS, error: '' });
      })
      .catch((requestError) => {
        if (cancelled) return;
        setRemote({
          year,
          sheets: EMPTY_SHEETS,
          error: requestError.response?.data?.message || `Unable to load WQM ${year} data.`,
        });
      });

    return () => { cancelled = true; };
  }, [year, reloadKey, isPublic]);

  const isLocalYear = year === DEFAULT_WQM_YEAR;
  const isResolved = isLocalYear || remote.year === year;
  const sheets = isLocalYear ? localSheets : (isResolved ? remote.sheets : EMPTY_SHEETS);

  // A new object literal on every render forced every consumer that spreads
  // this result into props (the public dashboard does) to re-render.
  return useMemo(
    () => ({
      year,
      sheets,
      loading: !isResolved,
      error: isResolved && !isLocalYear ? remote.error : '',
      setPublishedYear,
    }),
    [year, sheets, isResolved, isLocalYear, remote.error, setPublishedYear],
  );
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
  const [reloadKey, setReloadKey] = useState(0);

  const yearsKey = [...years].sort((a, b) => a - b).join(',');
  const pendingYears = useMemo(
    () => (yearsKey ? yearsKey.split(',').map(Number).filter((y) => y !== DEFAULT_WQM_YEAR) : []),
    [yearsKey],
  );
  // Derived rather than stored: "loading" is simply "a requested archive year is
  // not in the cache yet", which removes a setState-in-effect round trip.
  const loading = pendingYears.some((yr) => !cache.has(yr));

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
    if (!pendingYears.length) return undefined;
    let cancelled = false;
    // fetchYearSheets already serves the local cache and dedupes concurrent
    // requests for the same year across every hook instance in the tree.
    Promise.all(
      pendingYears.map((yr) => fetchYearSheets(yr).then((sheets) => [yr, sheets]).catch(() => [yr, EMPTY_SHEETS])),
    ).then((entries) => {
      if (cancelled) return;
      setCache((prev) => {
        // Only replace the Map when something actually changed, so a repeated
        // event does not hand every consumer a new identity for the same data.
        const changed = entries.some(([yr, sheets]) => prev.get(yr) !== sheets);
        if (!changed) return prev;
        const next = new Map(prev);
        entries.forEach(([yr, sheets]) => next.set(yr, sheets));
        return next;
      });
    });
    return () => { cancelled = true; };
  }, [pendingYears, reloadKey]);

  const includesDefault = yearsKey.split(',').includes(String(DEFAULT_WQM_YEAR));

  return useMemo(() => {
    const map = new Map(cache);
    if (includesDefault) map.set(DEFAULT_WQM_YEAR, localSheets);
    return { map, loading };
  }, [cache, localSheets, loading, includesDefault]);
};

export const buildWaterbodyOptions = (sheets) => sheets
  .map((sheet, fallbackIndex) => {
    const groupInfo = getWaterbodyGroupInfo(sheet.key, fallbackIndex);
    return {
      key: sheet.key,
      name: getWaterbodyProfileName(sheet.key, sheet.name),
      classInfo: sheet.classInfo || '',
      // Quarterly sheets label their slots Q1–Q4; the map cards need this.
      periodLabels: sheet.periodLabels || null,
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
