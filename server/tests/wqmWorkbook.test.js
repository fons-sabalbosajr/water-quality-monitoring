const test = require('node:test');
const assert = require('node:assert/strict');
const { parseSheets, formatSamplingDate, isValidStationNo } = require('../utils/wqmWorkbook');

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const blank12 = () => Array(12).fill(null);
const monthRow = (prefix, values) => [...prefix, ...values, ...blank12().slice(values.length)];

// Classic layout: title rows above a single header row; read-excel-file v9
// returns null for empty cells, including the merged "Parameter" cell.
const classicSheet = {
  sheet: 'BOCAUE',
  data: [
    ['SUMMARY REPORT OF WATER QUALITY MONITORING DATA'],
    ['CY 2026'],
    ['BOCAUE RIVER'],
    ['CLASS C ( 2 STATIONS )'],
    ['Region', 'Parameter', 'Stn. No.', 'Stn. ID', 'Address', ...MONTHS, 'Average/Geomean'],
    monthRow(['III', 'DO (mg/L)', 1, 'Bridge A', 'Town A'], [3.4, 0]),
    monthRow([null, null, 2, 'Bridge B', 'Town B'], [4.1, '<0.1']),
    monthRow([null, 'BOD mg/L', 1, 'Bridge A', 'Town A'], [12, 15]),
    monthRow([null, null, 2, 'Bridge B', 'Town B'], ['-', 9]),
    monthRow([null, 'Date of Sampling', null, null, null], [new Date(Date.UTC(2026, 0, 7)), new Date(Date.UTC(2026, 1, 12))]),
  ],
};

// 2026 template: header split over two rows with a spanning "F.Y. 2026" label
// above January, the title *below* the header in column B, and a chart-helper
// table to the right whose own "January" heading must not be matched.
const splitHeaderSheet = {
  sheet: 'ZAMBALES BAY',
  data: [
    ['Region', 'Parameter', 'Stn. No.', 'Stn. ID', 'Address', 'F.Y. 2026'],
    [null, null, null, null, null, ...MONTHS, 'Average/Geomean', 'Remarks', 'WQG', null, null, 'January'],
    [null, 'SANTA MARIA RIVER'],
    [null, 'CLASS C ( 1 STATIONS )'],
    ['III', 'DO (mg/L)', 1, 'Catmon Bridge', 'Catmon', 3.41, 2.79, ...Array(10).fill(null), 3.1, 'Failed', 5, null, 'Catmon Bridge'],
  ],
};

test('keeps every station when the merged Parameter cell is null', () => {
  const [sheet] = parseSheets([classicSheet], 2026);
  assert.equal(sheet.stations.length, 2);
  assert.deepEqual(sheet.stations[1].params['DO (mg/L)'].monthly.slice(0, 2), [4.1, '<0.1']);
  assert.deepEqual(sheet.stations[1].params['BOD (mg/L)'].monthly.slice(0, 2), [null, 9]);
});

test('a numeric 0 reading is kept, not treated as blank', () => {
  const [sheet] = parseSheets([classicSheet], 2026);
  assert.equal(sheet.stations[0].params['DO (mg/L)'].monthly[1], 0);
});

test('reads the Date of Sampling row as MM/DD/YYYY onto every station', () => {
  const [sheet] = parseSheets([classicSheet], 2026);
  sheet.stations.forEach((station) => {
    assert.deepEqual(station.samplingDates.slice(0, 3), ['01/07/2026', '02/12/2026', null]);
  });
  assert.equal(sheet.stations[0].params['Date of Sampling'], undefined);
});

test('merges a two-row header and prefers January over the F.Y. label', () => {
  const [sheet] = parseSheets([splitHeaderSheet], 2026);
  assert.deepEqual(sheet.stations[0].params['DO (mg/L)'].monthly.slice(0, 3), [3.41, 2.79, null]);
  assert.equal(sheet.stations[0].params['DO (mg/L)'].avg, 3.1);
});

test('finds a waterbody title placed below a two-row header', () => {
  const [sheet] = parseSheets([splitHeaderSheet], 2026);
  assert.equal(sheet.name, 'SANTA MARIA RIVER');
  assert.equal(sheet.classInfo, 'CLASS C ( 1 STATIONS )');
});

test('preserveSheetNames keeps the raw worksheet name as the key', () => {
  assert.equal(parseSheets([splitHeaderSheet], 2026)[0].key, 'ZAMBALES_BAY');
  assert.equal(parseSheets([splitHeaderSheet], 2026, { preserveSheetNames: true })[0].key, 'ZAMBALES BAY');
});

test('keepEmptyParams retains parameters with no readings for data entry', () => {
  const sheet = {
    sheet: 'X',
    data: [
      ['Region', 'Parameter', 'Stn. No.', 'Stn. ID', 'Address', ...MONTHS],
      monthRow(['III', 'DO (mg/L)', 1, 'A', ''], [5]),
      monthRow([null, 'Oil & Grease', 1, 'A', ''], []),
    ],
  };
  assert.equal(parseSheets([sheet], 2026)[0].stations[0].params['Oil & Grease'], undefined);
  assert.ok(parseSheets([sheet], 2026, { keepEmptyParams: true })[0].stations[0].params['Oil & Grease']);
});

test('quarterly sheets map quarters onto the first four slots', () => {
  const sheet = {
    sheet: 'ATLAG',
    data: [
      ['Region', 'Parameter', 'Stn. No.', 'Stn. ID', 'Address', '1st Quarter', '2nd Quarter', '3rd Quarter', '4th Quarter', 'Average/Geomean'],
      ['III', 'DO (mg/L)', 1, 'A', '', 3.38, 3, 0.3, '-', 1.67],
    ],
  };
  const [parsed] = parseSheets([sheet], 2026);
  assert.deepEqual(parsed.periodLabels.slice(0, 5), ['Q1', 'Q2', 'Q3', 'Q4', '']);
  assert.deepEqual(parsed.stations[0].params['DO (mg/L)'].monthly.slice(0, 5), [3.38, 3, 0.3, null, null]);
});

test('repeated header rows and summary tables never become stations', () => {
  assert.equal(isValidStationNo('Stn. No.'), false);
  assert.equal(isValidStationNo('Waterbody'), false);
  assert.equal(isValidStationNo(null), false);
  assert.equal(isValidStationNo(3), true);
  assert.equal(isValidStationNo('3'), true);
});

test('formatSamplingDate uses UTC so dates do not shift by timezone', () => {
  assert.equal(formatSamplingDate(new Date(Date.UTC(2026, 11, 31))), '12/31/2026');
  assert.equal(formatSamplingDate('-'), null);
  assert.equal(formatSamplingDate(null), null);
});
