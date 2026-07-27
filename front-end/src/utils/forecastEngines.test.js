import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_FORECAST_ENGINE,
  LOCAL_FORECAST_ENGINES,
  mergeForecastEngines,
} from './forecastEngines.js';

/**
 * Regression: the Settings panel rendered its engine list purely from
 * GET /water/forecast/status, so a failed request made it look as though the
 * local engines were unavailable and surfaced "Cannot reach the server" next to
 * engines that were in fact running. The local engines are pure in-browser
 * maths and must always be listed.
 */
test('mergeForecastEngines falls back to the local list when the server says nothing', () => {
  for (const input of [undefined, null, [], 'nope', {}, 0]) {
    assert.deepEqual(
      mergeForecastEngines(input),
      LOCAL_FORECAST_ENGINES,
      `input ${JSON.stringify(input)} should yield the built-in engines`,
    );
  }
});

test('the built-in list is non-empty and includes the default engine', () => {
  assert.ok(LOCAL_FORECAST_ENGINES.length >= 2);
  assert.ok(
    LOCAL_FORECAST_ENGINES.some((engine) => engine.id === DEFAULT_FORECAST_ENGINE),
    'the default engine must be present in the built-in list',
  );
  LOCAL_FORECAST_ENGINES.forEach((engine) => {
    assert.ok(engine.id, 'every engine needs an id');
    assert.ok(engine.label, `engine "${engine.id}" needs a label`);
    assert.ok(engine.description, `engine "${engine.id}" needs a description`);
  });
});

test('server entries enrich the matching local engine rather than replacing the list', () => {
  const merged = mergeForecastEngines([
    { id: 'prophet', description: 'Server-side description' },
  ]);
  const prophet = merged.find((engine) => engine.id === 'prophet');
  assert.equal(prophet.description, 'Server-side description');
  // The label the server omitted must survive from the local definition.
  assert.equal(prophet.label, 'Prophet (additive)');
  // The other local engine must not be dropped just because the server did not
  // mention it.
  assert.ok(merged.some((engine) => engine.id === 'ols'));
});

test('server-only engines are appended', () => {
  const merged = mergeForecastEngines([
    { id: 'arima', label: 'ARIMA', description: 'Server engine' },
  ]);
  assert.equal(merged.length, LOCAL_FORECAST_ENGINES.length + 1);
  assert.ok(merged.some((engine) => engine.id === 'arima'));
  assert.ok(merged.some((engine) => engine.id === 'prophet'));
});

test('malformed server entries are ignored, not rendered as blanks', () => {
  const merged = mergeForecastEngines([null, {}, { label: 'No id' }, undefined]);
  assert.deepEqual(
    merged.map((engine) => engine.id).sort(),
    LOCAL_FORECAST_ENGINES.map((engine) => engine.id).sort(),
  );
});

test('merging does not mutate the built-in list', () => {
  const snapshot = JSON.parse(JSON.stringify(LOCAL_FORECAST_ENGINES));
  mergeForecastEngines([{ id: 'prophet', label: 'Mutated', description: 'Mutated' }]);
  assert.deepEqual(LOCAL_FORECAST_ENGINES, snapshot);
});
