const test = require('node:test');
const assert = require('node:assert/strict');
const {
  validateSheets,
  MAX_SHEETS,
  MAX_STATIONS_PER_SHEET,
} = require('../utils/validateSheets');

const station = (overrides = {}) => ({
  stnNo: 1,
  stnId: 'Station 1',
  address: 'Somewhere',
  samplingDates: Array(12).fill(null),
  params: { 'DO (mg/L)': { monthly: Array(12).fill(null), avg: null } },
  ...overrides,
});

const sheet = (overrides = {}) => ({
  key: 'BOCAUE',
  name: 'Bocaue River',
  classInfo: 'CLASS C',
  stations: [station()],
  ...overrides,
});

test('accepts a well-formed payload', () => {
  assert.equal(validateSheets([sheet()]), null);
});

test('accepts a sheet with no stations yet (newly created waterbody)', () => {
  assert.equal(validateSheets([sheet({ stations: [] })]), null);
});

test('rejects non-array and empty payloads', () => {
  assert.match(validateSheets(undefined), /sheets array is required/);
  assert.match(validateSheets(null), /sheets array is required/);
  assert.match(validateSheets('sheets'), /sheets array is required/);
  assert.match(validateSheets({ key: 'X' }), /sheets array is required/);
  // The dangerous case: an empty array would otherwise wipe the whole year.
  assert.match(validateSheets([]), /non-empty sheets array/);
});

test('rejects a sheet missing its key or name', () => {
  assert.match(validateSheets([sheet({ key: '' })]), /non-empty "key"/);
  assert.match(validateSheets([sheet({ key: '   ' })]), /non-empty "key"/);
  assert.match(validateSheets([sheet({ name: '' })]), /needs a name/);
});

test('rejects duplicate waterbody keys', () => {
  // Two sheets with the same key make every key lookup in the UI ambiguous.
  const result = validateSheets([sheet(), sheet({ name: 'Bocaue Copy' })]);
  assert.match(result, /Duplicate waterbody key "BOCAUE"/);
});

test('rejects malformed sheet and station entries', () => {
  assert.match(validateSheets([null]), /must be an object/);
  assert.match(validateSheets([['BOCAUE']]), /must be an object/);
  assert.match(validateSheets([sheet({ stations: 'nope' })]), /invalid stations list/);
  assert.match(validateSheets([sheet({ stations: [null] })]), /invalid station record/);
});

test('rejects malformed parameter blocks', () => {
  assert.match(
    validateSheets([sheet({ stations: [station({ params: 'DO' })] })]),
    /invalid params/,
  );
  assert.match(
    validateSheets([sheet({ stations: [station({ params: { pH: { monthly: 'x' } } })] })]),
    /non-array monthly series/,
  );
  assert.match(
    validateSheets([sheet({ stations: [station({ params: { pH: { monthly: Array(13).fill(1) } } })] })]),
    /more than 12 monthly readings/,
  );
  assert.match(
    validateSheets([sheet({ stations: [station({ samplingDates: 'jan' })] })]),
    /invalid sampling dates/,
  );
});

test('enforces size caps that keep the document under the MongoDB limit', () => {
  const tooManySheets = Array.from({ length: MAX_SHEETS + 1 }, (_, i) =>
    sheet({ key: `WB_${i}`, name: `Waterbody ${i}`, stations: [] }));
  assert.match(validateSheets(tooManySheets), /Too many waterbody sheets/);

  const tooManyStations = sheet({
    stations: Array.from({ length: MAX_STATIONS_PER_SHEET + 1 }, (_, i) =>
      station({ stnNo: i + 1, stnId: `Station ${i + 1}` })),
  });
  assert.match(validateSheets([tooManyStations]), /too many stations/);
});

test('allows exactly the maximum allowed sizes', () => {
  const atCap = Array.from({ length: MAX_SHEETS }, (_, i) =>
    sheet({ key: `WB_${i}`, name: `Waterbody ${i}`, stations: [] }));
  assert.equal(validateSheets(atCap), null);
});
