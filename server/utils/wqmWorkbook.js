const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const SKIP_SHEETS = new Set(['SUMMARY', 'PLANNING (BUDGET HEARING)']);
const PERIOD_ALIASES = [
  ['january', 'jan'],
  ['february', 'feb'],
  ['march', 'mar'],
  ['april', 'apr'],
  ['may'],
  ['june', 'jun'],
  ['july', 'jul'],
  ['august', 'aug'],
  ['september', 'sept', 'sep'],
  ['october', 'oct'],
  ['november', 'nov'],
  ['december', 'dec'],
];
const QUARTER_ALIASES = [
  ['1st quarter', 'first quarter', 'q1'],
  ['2nd quarter', 'second quarter', 'q2'],
  ['3rd quarter', 'third quarter', 'q3'],
  ['4th quarter', 'fourth quarter', 'q4'],
];

const toKey = (value) => String(value || '')
  .trim()
  .toUpperCase()
  .replace(/[^A-Z0-9]+/g, '_')
  .replace(/^_+|_+$/g, '');

const cleanText = (value) => String(value || '').replace(/\s+/g, ' ').trim();
const normalizeHeader = (value) => cleanText(value).toLowerCase();

const cleanCell = (value) => {
  if (value === '' || value === '-' || value === undefined) return null;
  if (typeof value === 'number') return Number(value.toFixed(4));
  return typeof value === 'string' ? value.trim() : value;
};

const findHeaderIndex = (rows) => rows.findIndex((row) => (
  row.some((cell) => normalizeHeader(cell) === 'parameter')
  && row.some((cell) => /^stn\.?\s*no\.?$/i.test(cleanText(cell)))
  && row.some((cell) => /^stn\.?\s*id\.?$/i.test(cleanText(cell)))
));

const isMetadataLabel = (value) => {
  const text = cleanText(value);
  return !text
    || /^CY\s+\d{4}$/i.test(text)
    || /^CLASS\s+/i.test(text)
    || /^III$/i.test(text)
    || /^SUMMARY REPORT/i.test(text)
    || /^SUMMARY OF/i.test(text)
    || /^SUBMITTED BY/i.test(text)
    || /^REGION$/i.test(text)
    || /^PARAMETER$/i.test(text);
};

const findWaterbodyName = (rows, headerIndex, sheetName) => {
  for (let index = headerIndex + 1; index < Math.min(rows.length, headerIndex + 8); index += 1) {
    const value = cleanText(rows[index]?.[0]);
    if (!isMetadataLabel(value)) return value;
  }

  for (let index = Math.max(0, headerIndex - 6); index < headerIndex; index += 1) {
    const value = cleanText(rows[index]?.find((cell) => cleanText(cell)));
    if (!isMetadataLabel(value)) return value;
  }

  return cleanText(sheetName).replace(/_/g, ' ');
};

const findColumn = (header, matcher) => header.findIndex((cell) => matcher(cleanText(cell)));

const findPeriodIndexes = (header) => {
  const periodIndexes = PERIOD_ALIASES.map((aliases) => (
    header.findIndex((cell) => aliases.includes(normalizeHeader(cell)))
  ));
  const hasMonthlyColumns = periodIndexes.some((index) => index >= 0);
  if (hasMonthlyColumns) {
    return {
      indexes: periodIndexes,
      labels: MONTHS.map((month) => month.slice(0, 3)),
    };
  }

  const quarterIndexes = QUARTER_ALIASES.map((aliases) => (
    header.findIndex((cell) => aliases.includes(normalizeHeader(cell)))
  ));
  return {
    indexes: Array.from({ length: 12 }, (_, index) => quarterIndexes[index] ?? -1),
    labels: ['Q1', 'Q2', 'Q3', 'Q4', '', '', '', '', '', '', '', ''],
  };
};

const findAverageIndex = (header) => header.findIndex((cell) => {
  const normalized = normalizeHeader(cell);
  return normalized === 'average'
    || normalized === 'average/geomean'
    || normalized === 'ave/ geomean'
    || normalized === 'ave/geomean';
});

const getStationKey = (value) => {
  if (typeof value === 'number') return String(value);
  return cleanText(value);
};

const isValidStationNo = (value) => {
  if (value === '' || value === undefined || value === null) return false;
  if (typeof value === 'number') return Number.isFinite(value);
  return cleanText(value) !== '';
};

const buildMonthlyValues = (row, periodIndexes) => (
  Array.from({ length: 12 }, (_, index) => {
    const monthIndex = periodIndexes[index];
    return monthIndex >= 0 ? cleanCell(row[monthIndex]) : null;
  })
);

const hasAnyReading = (monthly, avg) => (
  monthly.some((value) => value !== null && value !== '')
  || (avg !== null && avg !== '')
);

const buildSheetKey = (sheetName, waterbodyName) => {
  const fromWaterbody = toKey(waterbodyName);
  const fromSheet = toKey(sheetName);
  if (!fromSheet || /^SHEET\d+$/i.test(fromSheet)) return fromWaterbody;
  return fromSheet;
};

const sanitizeParamName = (value) => {
  const param = cleanText(value);
  if (!param) return '';
  if (/^BOD\s*mg\/L$/i.test(param)) return 'BOD (mg/L)';
  if (/^oil\s*&\s*grease$/i.test(param)) return 'Oil & Grease';
  return param;
};

const findClassInfo = (rows, headerIndex) => {
  for (let index = Math.max(0, headerIndex - 2); index < Math.min(rows.length, headerIndex + 8); index += 1) {
    const value = cleanText(rows[index]?.find((cell) => /^CLASS\s+/i.test(cleanText(cell))));
    if (value) return value;
  }
  return '';
};

const parseWorkbook = async (filePath, year) => {
  const { default: readXlsxFile } = await import('read-excel-file/node');
  const workbook = await readXlsxFile(filePath);
  const sheets = [];

  workbook.forEach(({ sheet: sheetName, data: rows = [] }) => {
    if (!sheetName || SKIP_SHEETS.has(String(sheetName).toUpperCase())) return;
    const headerIndex = findHeaderIndex(rows);
    if (headerIndex < 0) return;

    const header = rows[headerIndex];
    const paramIndex = findColumn(header, (value) => /^parameter$/i.test(value));
    const stationNoIndex = findColumn(header, (value) => /^stn\.?\s*no\.?$/i.test(value));
    const stationIdIndex = findColumn(header, (value) => /^stn\.?\s*id\.?$/i.test(value));
    const addressIndex = findColumn(header, (value) => /^address$/i.test(value));
    const { indexes: monthIndexes, labels: periodLabels } = findPeriodIndexes(header);
    const avgIndex = findAverageIndex(header);
    const stationMap = {};
    let currentParam = '';

    for (let rowIndex = headerIndex + 1; rowIndex < rows.length; rowIndex += 1) {
      const row = rows[rowIndex] || [];
      if (!row.some((cell) => cell !== '')) continue;
      if (row[paramIndex] !== '') currentParam = sanitizeParamName(row[paramIndex]);
      const stnNo = row[stationNoIndex];
      const stnId = cleanText(row[stationIdIndex]);
      if (!isValidStationNo(stnNo) || !stnId || !currentParam) continue;

      const key = getStationKey(stnNo);
      if (!stationMap[key]) {
        stationMap[key] = {
          stnNo,
          stnId,
          address: addressIndex >= 0 ? cleanText(row[addressIndex]) : '',
          params: {},
        };
      }

      const monthly = buildMonthlyValues(row, monthIndexes);
      const avg = avgIndex >= 0 ? cleanCell(row[avgIndex]) : null;
      if (!hasAnyReading(monthly, avg)) continue;

      stationMap[key].params[currentParam] = {
        monthly,
        avg,
      };
    }

    const stations = Object.values(stationMap);
    if (!stations.length) return;

    const waterbodyName = findWaterbodyName(rows, headerIndex, sheetName);
    sheets.push({
      key: buildSheetKey(sheetName, waterbodyName),
      name: waterbodyName,
      classInfo: findClassInfo(rows, headerIndex),
      year,
      periodLabels,
      stations,
    });
  });

  return sheets;
};

module.exports = { parseWorkbook };
