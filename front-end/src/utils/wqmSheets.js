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

export const getLocalPublishedWqmYear = () => normalizeWqmYear(encryptedStorage.getItem(WQM_PUBLISHED_YEAR_KEY));

export const publishWqmYear = (nextYear) => {
  const year = normalizeWqmYear(nextYear);
  encryptedStorage.setItem(WQM_PUBLISHED_YEAR_KEY, String(year));
  window.dispatchEvent(new CustomEvent(WQM_PUBLISHED_YEAR_EVENT, { detail: year }));
  return year;
};

export const getReadableStations = (sheet) => getStations(sheet).filter(hasNumericReading);

export const useWqmSheets = () => {
  const [sheets, setSheets] = useState(getStoredWqmSheets);

  useEffect(() => {
    const refresh = () => setSheets(getStoredWqmSheets());
    window.addEventListener(WQM_DRAFTS_EVENT, refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener(WQM_DRAFTS_EVENT, refresh);
      window.removeEventListener('storage', refresh);
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
    queueMicrotask(() => {
      if (!cancelled) {
        setLoading(true);
        setError('');
      }
    });
    api.get(`/water/wqm/${year}`)
      .then((response) => {
        if (!cancelled) setRemoteSheets(response.data?.sheets || []);
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
  }, [year]);

  return {
    year,
    sheets: year === DEFAULT_WQM_YEAR ? localSheets : remoteSheets,
    loading,
    error,
    setPublishedYear,
  };
};

export const buildWaterbodyOptions = (sheets) => sheets
  .map((sheet, fallbackIndex) => {
    const groupInfo = getWaterbodyGroupInfo(sheet.key, fallbackIndex);
    return {
      key: sheet.key,
      name: sheet.name,
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
    a.groupIndex - b.groupIndex
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
