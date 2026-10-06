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

const cleanText = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
const normalizeHeader = (value) => cleanText(value).toLowerCase();

// read-excel-file v9 returns null (not '') for empty cells. Every blank check in
// this parser must accept both, or a merged/blank "Parameter" cell resets the
// current parameter and every station after the first one is silently dropped.
// A numeric 0 is a real reading, so numbers are never blank.
const isBlankCell = (value) => {
  if (value === null || value === undefined) return true;
  if (typeof value === 'number') return !Number.isFinite(value);
  return cleanText(value) === '';
};

const cleanCell = (value) => {
  if (isBlankCell(value) || cleanText(value) === '-') return null;
  if (typeof value === 'number') return Number(value.toFixed(4));
  return typeof value === 'string' ? value.trim() : value;
};

const STN_NO_PATTERN = /^stn\.?\s*no\.?$/i;
const STN_ID_PATTERN = /^stn\.?\s*id\.?$/i;
const SAMPLING_DATE_PATTERN = /^date\s+of\s+sampling$/i;
const CLASS_PATTERN = /^(CLASS\s+|NO RIVER CLASSIFICATION|FOR CLASSIFICATION)/i;

const findHeaderIndex = (rows) => rows.findIndex((row) => (
  row.some((cell) => normalizeHeader(cell) === 'parameter')
  && row.some((cell) => STN_NO_PATTERN.test(cleanText(cell)))
  && row.some((cell) => STN_ID_PATTERN.test(cleanText(cell)))
));

const isMetadataLabel = (value) => {
  const text = cleanText(value);
  return !text
    || /^CY\s+\d{4}$/i.test(text)
    || /^F\.?\s*Y\.?\s*\d{4}$/i.test(text)
    || CLASS_PATTERN.test(text)
    || /^III$/i.test(text)
    || /^SUMMARY REPORT/i.test(text)
    || /^SUMMARY OF/i.test(text)
    || /^SUBMITTED BY/i.test(text)
    || /^REGION$/i.test(text)
    || /^PARAMETER$/i.test(text);
};

const firstFilledCell = (row = []) => row.find((cell) => !isBlankCell(cell));

/**
 * Locate the waterbody title. Older workbooks put it above the header row in
 * column A; the 2026 template moved some of them into column B *below* a
 * two-row header (or into column C above it). `firstStationRow` bounds the
 * forward scan so a parameter name in column B of a data row is never mistaken
 * for it.
 */
const findWaterbodyName = (rows, headerIndex, dataStart, firstStationRow, sheetName) => {
  for (let index = headerIndex + 1; index < Math.min(rows.length, headerIndex + 8); index += 1) {
    const value = cleanText(rows[index]?.[0]);
    if (!isMetadataLabel(value)) return value;
  }

  // Start after the (possibly two-row) header so "January" is never picked up.
  for (let index = dataStart; index < firstStationRow; index += 1) {
    const value = cleanText(firstFilledCell(rows[index]));
    if (!isMetadataLabel(value)) return value;
  }

  for (let index = Math.max(0, headerIndex - 6); index < headerIndex; index += 1) {
    const value = cleanText(firstFilledCell(rows[index]));
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

const hasPeriodColumns = (header) => findPeriodIndexes(header).indexes.some((index) => index >= 0);

/**
 * Some 2026 sheets split the header over two rows: "Parameter / Stn. No. /
 * Stn. ID" on one, "Region / Address / January…" (or "1st Quarter…") on the
 * next. Merge them column-wise so every column is found, and start reading data
 * after the second row.
 */
const resolveHeader = (rows, headerIndex) => {
  const header = rows[headerIndex] || [];
  if (hasPeriodColumns(header)) return { header, dataStart: headerIndex + 1 };

  const next = rows[headerIndex + 1] || [];
  if (!hasPeriodColumns(next)) return { header, dataStart: headerIndex + 1 };

  // The upper row carries a spanning "F.Y. 2026" label over the January
  // column, so a period/average heading in the lower row must win over it.
  const isPeriodOrAverage = (cell) => (
    hasPeriodColumns([cell]) || findAverageIndex([cell]) === 0
  );
  const width = Math.max(header.length, next.length);
  const merged = Array.from({ length: width }, (_, index) => (
    isBlankCell(header[index]) || isPeriodOrAverage(next[index]) ? next[index] : header[index]
  ));
  return { header: merged, dataStart: headerIndex + 2 };
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

// Station numbers are always numeric in the source workbooks. Requiring that
// keeps repeated header rows ("Stn. No.") and side-summary tables
// ("Waterbody") from being imported as phantom stations.
const isValidStationNo = (value) => {
  if (isBlankCell(value)) return false;
  if (typeof value === 'number') return Number.isFinite(value);
  return /^\d+(\.\d+)?$/.test(cleanText(value));
};

const buildMonthlyValues = (row, periodIndexes) => (
  Array.from({ length: 12 }, (_, index) => {
    const monthIndex = periodIndexes[index];
    return monthIndex >= 0 ? cleanCell(row[monthIndex]) : null;
  })
);

const hasAnyReading = (monthly, avg) => (
  monthly.some((value) => !isBlankCell(value))
  || !isBlankCell(avg)
);

const pad2 = (value) => String(value).padStart(2, '0');

// The tabular editor stores and parses sampling dates as MM/DD/YYYY strings.
// Excel dates arrive as UTC-midnight Date objects, so format with UTC getters.
const formatSamplingDate = (value) => {
  if (isBlankCell(value) || cleanText(value) === '-') return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return `${pad2(value.getUTCMonth() + 1)}/${pad2(value.getUTCDate())}/${value.getUTCFullYear()}`;
  }
  return cleanText(value);
};

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
    const value = cleanText(rows[index]?.find((cell) => CLASS_PATTERN.test(cleanText(cell))));
    if (value) return value;
  }
  return '';
};

/**
 * Parse already-loaded worksheets ([{ sheet, data: rows[][] }], the shape
 * read-excel-file returns). Split from parseWorkbook so it is testable without
 * fixture files.
 * @param {Array<{sheet: string, data: Array<Array<*>>}>} workbook
 * @param {number} year
 * @param {object} [options]
 * @param {boolean} [options.preserveSheetNames] use the raw worksheet name as
 *   the sheet key. The 2026 front-end data (province map, waterbody groups,
 *   saved station coordinates) is keyed by raw names such as "ZAMBALES BAY".
 * @param {boolean} [options.keepEmptyParams] keep parameters with no readings
 *   yet, so the tabular editor still offers them for data entry in a live year.
 */
const parseSheets = (workbook, year, options = {}) => {
  const { preserveSheetNames = false, keepEmptyParams = false } = options;
  const sheets = [];

  workbook.forEach(({ sheet: sheetName, data: rows = [] }) => {
    if (!sheetName || SKIP_SHEETS.has(String(sheetName).toUpperCase())) return;
    const headerIndex = findHeaderIndex(rows);
    if (headerIndex < 0) return;

    const { header, dataStart } = resolveHeader(rows, headerIndex);
    const paramIndex = findColumn(header, (value) => /^parameter$/i.test(value));
    const stationNoIndex = findColumn(header, (value) => STN_NO_PATTERN.test(value));
    const stationIdIndex = findColumn(header, (value) => STN_ID_PATTERN.test(value));
    const addressIndex = findColumn(header, (value) => /^address$/i.test(value));
    const { indexes: monthIndexes, labels: periodLabels } = findPeriodIndexes(header);
    const avgIndex = findAverageIndex(header);
    const stationMap = {};
    let currentParam = '';
    let samplingDates = null;
    let firstStationRow = -1;

    for (let rowIndex = dataStart; rowIndex < rows.length; rowIndex += 1) {
      const row = rows[rowIndex] || [];
      if (row.every(isBlankCell)) continue;
      if (!isBlankCell(row[paramIndex])) currentParam = sanitizeParamName(row[paramIndex]);

      // One "Date of Sampling" row per waterbody; it has no station number.
      if (SAMPLING_DATE_PATTERN.test(currentParam) && !isValidStationNo(row[stationNoIndex])) {
        if (!samplingDates) {
          const dates = Array.from({ length: 12 }, (_, index) => (
            monthIndexes[index] >= 0 ? formatSamplingDate(row[monthIndexes[index]]) : null
          ));
          if (dates.some(Boolean)) samplingDates = dates;
        }
        continue;
      }

      const stnNo = row[stationNoIndex];
      const stnId = cleanText(row[stationIdIndex]);
      if (!isValidStationNo(stnNo) || !stnId || !currentParam) continue;
      if (firstStationRow < 0) firstStationRow = rowIndex;

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
      if (!keepEmptyParams && !hasAnyReading(monthly, avg)) continue;

      stationMap[key].params[currentParam] = {
        monthly,
        avg,
      };
    }

    const stations = Object.values(stationMap);
    if (!stations.length) return;
    if (samplingDates) {
      stations.forEach((station) => { station.samplingDates = [...samplingDates]; });
    }

    const waterbodyName = findWaterbodyName(rows, headerIndex, dataStart, firstStationRow, sheetName);
    sheets.push({
      key: preserveSheetNames ? cleanText(sheetName) : buildSheetKey(sheetName, waterbodyName),
      name: waterbodyName,
      classInfo: findClassInfo(rows, headerIndex),
      year,
      periodLabels,
      stations,
    });
  });

  return sheets;
};

const parseWorkbook = async (filePath, year, options = {}) => {
  const { default: readXlsxFile } = await import('read-excel-file/node');
  return parseSheets(await readXlsxFile(filePath), year, options);
};

module.exports = { parseWorkbook, parseSheets, formatSamplingDate, isValidStationNo };
