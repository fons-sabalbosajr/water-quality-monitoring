import readXlsxFile from 'read-excel-file/browser';
import stationWorkbookUrl from '../../docs/wqm_stations.xlsx?url';

const normalizeHeader = (value) => String(value || '').trim().toLowerCase();
const toText = (value) => String(value || '').trim();

const toNumber = (value) => {
  if (typeof value === 'number') return value;
  const parsed = Number(String(value || '').trim());
  return Number.isFinite(parsed) ? parsed : NaN;
};

const getColumnIndex = (headers, aliases) => headers.findIndex((header) => aliases.includes(normalizeHeader(header)));

const mapStationRows = (rows) => {
  if (!rows.length) return [];

  const [headerRow = [], ...dataRows] = rows;
  const idIndex = getColumnIndex(headerRow, ['id']);
  const stationIndex = getColumnIndex(headerRow, ['station']);
  const waterbodyLocIndex = getColumnIndex(headerRow, ['waterbody loc']);
  const waterbodyRiverIndex = getColumnIndex(headerRow, ['waterbody', 'waterbody river']);
  const barangayIndex = getColumnIndex(headerRow, ['barangay']);
  const provinceIndex = getColumnIndex(headerRow, ['province']);
  const latIndex = getColumnIndex(headerRow, ['lat']);
  const lngIndex = getColumnIndex(headerRow, ['long', 'lng', 'longitude']);

  return dataRows
    .map((row) => ({
      id: idIndex >= 0 ? row[idIndex] : '',
      station: stationIndex >= 0 ? toText(row[stationIndex]) : '',
      waterbodyLoc: waterbodyLocIndex >= 0 ? toText(row[waterbodyLocIndex]) : '',
      waterbodyRiver: waterbodyRiverIndex >= 0 ? toText(row[waterbodyRiverIndex]) : '',
      barangay: barangayIndex >= 0 ? toText(row[barangayIndex]) : '',
      province: provinceIndex >= 0 ? toText(row[provinceIndex]) : '',
      lat: latIndex >= 0 ? toNumber(row[latIndex]) : NaN,
      lng: lngIndex >= 0 ? toNumber(row[lngIndex]) : NaN,
    }))
    .filter((row) => Number.isFinite(row.lat) && Number.isFinite(row.lng));
};

export const loadStationLocations = async () => {
  const response = await fetch(stationWorkbookUrl);
  if (!response.ok) {
    throw new Error(`Unable to load station workbook: ${response.status}`);
  }

  const workbook = await readXlsxFile(await response.blob());
  const stationSheet = workbook.find(({ sheet }) => sheet === 'Station_List') || workbook[0];
  return mapStationRows(stationSheet?.data || []);
};

// In-memory, session-scoped cache for the parsed station workbook.
// The XLSX is a static bundled asset that does not change during a session, so
// parsing it once and reusing the resolved promise avoids repeated network
// fetches and expensive in-browser spreadsheet parsing across pages (dashboard,
// 3D map, visualizations, public dashboard, settings). Nothing is persisted to
// disk, so no sensitive data is exposed; on error the cache is cleared so the
// next caller can retry.
let stationLocationsCache = null;

export const loadStationLocationsCached = () => {
  if (!stationLocationsCache) {
    stationLocationsCache = loadStationLocations().catch((error) => {
      stationLocationsCache = null;
      throw error;
    });
  }
  return stationLocationsCache;
};

export const clearStationLocationsCache = () => {
  stationLocationsCache = null;
};
