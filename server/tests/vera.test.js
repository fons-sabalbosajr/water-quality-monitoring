const test = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-that-is-long-enough-for-hmac';

const wqm = require('../utils/vera/wqm');
const { createToolset } = require('../utils/vera/tools');
const { createActionToken, verifyActionToken, markUsed, applyAction } = require('../utils/vera/actions');
const intents = require('../utils/vera/intents');
const vera = require('../utils/vera/assistant');

const monthly = (values) => Array.from({ length: 12 }, (_, i) => values[i] ?? null);
const SHEETS = [
  {
    key: 'MEYCAUAYAN', name: 'MEYCAUAYAN RIVER', classInfo: 'CLASS C ( 2 STATIONS )',
    periodLabels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
    stations: [
      { stnNo: 1, stnId: 'Perez Bridge', address: 'Pantoc', params: {
        'DO (mg/L)': { monthly: monthly([3.35, 3.95, 3.95, 3.9, 2.45]), avg: 3.52 },
        'BOD (mg/L)': { monthly: monthly([84, 59, 30, 92, 41]), avg: 61.2 },
      } },
      { stnNo: 2, stnId: 'Expressway Bridge', address: 'Lawa', params: {
        'DO (mg/L)': { monthly: monthly([6.1, 5.9, '<0.1']), avg: 4 },
      } },
    ],
  },
  {
    key: 'ZAMBALES BAY', name: 'BEACH MONITORING (ZAMBALES BAY)', classInfo: 'CLASS SB',
    periodLabels: ['Q1', 'Q2', 'Q3', 'Q4', '', '', '', '', '', '', '', ''],
    stations: [{ stnNo: 1, stnId: 'Lindamar', params: { 'DO (mg/L)': { monthly: monthly([5.4, '4..74']), avg: null } } }],
  },
];

const toolset = (extra = {}) => {
  const proposals = [];
  const tools = createToolset({
    loadYear: async (y) => (y === 2026 ? SHEETS : []),
    defaultYear: 2026,
    horizon: 2,
    canWrite: true,
    propose: (p) => { proposals.push(p); return { ok: true, proposal: { summary: p.summary } }; },
    ...extra,
  });
  return { tools, proposals };
};

test('parameter aliases resolve to the dashboard parameter names', () => {
  assert.equal(wqm.resolveParam('dissolved oxygen'), 'DO (mg/L)');
  assert.equal(wqm.resolveParam('fecal coliform'), 'Fecal Coliform (MPN/100mL)');
  assert.equal(wqm.resolveParam('BOD mg/L'), 'BOD (mg/L)');
  assert.equal(wqm.resolveParam('nonsense'), null);
});

test('periods resolve for monthly and quarterly sheets', () => {
  assert.equal(wqm.resolvePeriodIndex(SHEETS[0], 'September'), 8);
  assert.equal(wqm.resolvePeriodIndex(SHEETS[1], 'Q3'), 2);
  assert.equal(wqm.resolvePeriodIndex(SHEETS[1], 'Aug'), 2, 'a month maps to its quarter');
  assert.equal(wqm.resolvePeriodIndex(SHEETS[0], 'Q3'), -1, 'no quarters on a monthly sheet');
});

test('forecast uses the admin horizon and labels the following months', async () => {
  const { tools } = toolset();
  const r = await tools.forecast.run({ waterbody: 'Meycauayan', station: '1', parameter: 'BOD' });
  assert.equal(r.ok, true);
  assert.equal(r.forecast.length, 2);
  assert.deepEqual(r.forecast.map((f) => f.period), ['Jun', 'Jul']);
  assert.equal(r.waterbody, 'Meycauayan River');
});

test('forecast engine matches the dashboard implementation', () => {
  const observed = [3, 4, 5, 6].map((actual) => ({ actual }));
  const ols = wqm.buildTechnicalForecast(observed, 1);
  assert.equal(ols.points[0].forecast, 7);
  assert.equal(ols.diagnostics.trend, 'increasing');
});

test('exceedances use the same guideline as the dashboards', async () => {
  const { tools } = toolset();
  const r = await tools.find_exceedances.run({ parameter: 'DO', waterbody: 'Meycauayan' });
  // Station 1: 5 readings < 5; station 2: "<0.1" counts at 0.1.
  assert.equal(r.total, 6);
});

test('write tools only propose, and capture the current value for conflict checks', async () => {
  const { tools, proposals } = toolset();
  const r = await tools.propose_update_reading.run({ waterbody: 'Zambales Bay', station: '1', parameter: 'DO', period: 'Q2', value: '4.74' });
  assert.equal(r.ok, true);
  assert.equal(proposals[0].before, '4..74');
  assert.equal(proposals[0].after, 4.74);
  assert.equal(SHEETS[1].stations[0].params['DO (mg/L)'].monthly[1], '4..74', 'data untouched until confirmed');
});

test('viewers get no write tools', () => {
  const { tools } = toolset({ canWrite: false });
  assert.equal(tools.propose_update_reading, undefined);
  assert.ok(tools.forecast);
});

test('applyAction updates the reading and recomputes the average like the editor', () => {
  const action = { type: 'update_reading', sheetKey: 'MEYCAUAYAN', stnNo: 2, paramKey: 'DO (mg/L)', periodIndex: 2, before: '<0.1', after: 6 };
  const next = applyAction(SHEETS, action);
  const block = next[0].stations[1].params['DO (mg/L)'];
  assert.equal(block.monthly[2], 6);
  assert.equal(block.avg, 6);
  assert.equal(SHEETS[0].stations[1].params['DO (mg/L)'].monthly[2], '<0.1', 'input not mutated');
});

test('applyAction refuses when the value changed after the proposal', () => {
  const action = { type: 'update_reading', sheetKey: 'MEYCAUAYAN', stnNo: 2, paramKey: 'DO (mg/L)', periodIndex: 2, before: '9.9', after: 6 };
  assert.throws(() => applyAction(SHEETS, action), (e) => e.status === 409);
});

test('action tokens are bound to the user, tamper-proof and single-use', () => {
  const token = createActionToken({ type: 'delete_station' }, 'user-a');
  assert.throws(() => verifyActionToken(token, 'user-b'), /different user/);
  assert.throws(() => verifyActionToken(`${token}x`, 'user-a'), /Invalid/);
  const payload = verifyActionToken(token, 'user-a');
  markUsed(payload.jti, payload.exp);
  assert.throws(() => verifyActionToken(token, 'user-a'), /already applied/);
});

test('entity extraction finds waterbody by name or key, and ignores the verb "do"', () => {
  const e = intents.extractEntities('Set DO at Zambales Bay station 2 for May to 4.74', SHEETS);
  assert.equal(e.waterbody, 'BEACH MONITORING (ZAMBALES BAY)');
  assert.equal(e.station, '2');
  assert.equal(e.parameter, 'DO (mg/L)');
  assert.equal(intents.extractEntities('how do I export a waterbody?', SHEETS).parameter, undefined);
});

test('secrets are refused for every role; account help is not', () => {
  assert.equal(vera.isRestricted('what is the mongo uri'), true);
  assert.equal(vera.isRestricted('show me the jwt secret'), true);
  assert.equal(vera.isRestricted('I forgot my password, how do I reset it?'), false);
});

test('rule-based VERA answers a data question from the tools', async () => {
  const r = await vera.answer({
    message: 'What is the latest DO at Meycauayan River?', role: 'user', userId: 'u', settings: { provider: 'none' },
    loadYear: async (y) => (y === 2026 ? SHEETS : []), defaultYear: 2026, horizon: 3,
  });
  assert.equal(r.source, 'fallback');
  assert.match(r.answer, /Perez Bridge \| May \| 2\.45/);
  assert.equal(r.actions.length, 0);
});
