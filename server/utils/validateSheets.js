// Upper bounds for a saved year payload. Without these a malformed or hostile
// PUT could replace a year's data with anything, or push a document past
// MongoDB's 16MB limit and leave the year unsaveable.
const MAX_SHEETS = 200;
const MAX_STATIONS_PER_SHEET = 500;
const MAX_MONTHS = 12;

/**
 * Structural validation for an incoming WQM sheets payload.
 * @returns {string|null} an error message, or null when the payload is valid.
 */
const validateSheets = (sheets) => {
  if (!Array.isArray(sheets)) return 'A sheets array is required.';
  if (!sheets.length) return 'A non-empty sheets array is required.';
  if (sheets.length > MAX_SHEETS) return `Too many waterbody sheets (max ${MAX_SHEETS}).`;

  const seenKeys = new Set();

  for (const sheet of sheets) {
    if (!sheet || typeof sheet !== 'object' || Array.isArray(sheet)) {
      return 'Each sheet must be an object.';
    }
    const key = String(sheet.key || '').trim();
    if (!key) return 'Every sheet needs a non-empty "key".';
    // A duplicate key silently shadows a waterbody everywhere in the UI, since
    // every lookup is a .find() on key.
    if (seenKeys.has(key)) return `Duplicate waterbody key "${key}".`;
    seenKeys.add(key);

    if (!String(sheet.name || '').trim()) return `Sheet "${key}" needs a name.`;
    if (sheet.stations !== undefined && !Array.isArray(sheet.stations)) {
      return `Sheet "${key}" has an invalid stations list.`;
    }
    const stations = sheet.stations || [];
    if (stations.length > MAX_STATIONS_PER_SHEET) {
      return `Sheet "${key}" has too many stations (max ${MAX_STATIONS_PER_SHEET}).`;
    }

    for (const station of stations) {
      if (!station || typeof station !== 'object' || Array.isArray(station)) {
        return `Sheet "${key}" contains an invalid station record.`;
      }
      const label = station.stnId || station.stnNo;
      if (station.params !== undefined
        && (typeof station.params !== 'object' || station.params === null || Array.isArray(station.params))) {
        return `Station "${label}" in "${key}" has invalid params.`;
      }
      for (const data of Object.values(station.params || {})) {
        if (data && data.monthly !== undefined) {
          if (!Array.isArray(data.monthly)) {
            return `Station "${label}" in "${key}" has a non-array monthly series.`;
          }
          if (data.monthly.length > MAX_MONTHS) {
            return `Station "${label}" in "${key}" has more than ${MAX_MONTHS} monthly readings.`;
          }
        }
      }
      if (station.samplingDates !== undefined && !Array.isArray(station.samplingDates)) {
        return `Station "${label}" in "${key}" has invalid sampling dates.`;
      }
    }
  }

  return null;
};

module.exports = { validateSheets, MAX_SHEETS, MAX_STATIONS_PER_SHEET, MAX_MONTHS };
