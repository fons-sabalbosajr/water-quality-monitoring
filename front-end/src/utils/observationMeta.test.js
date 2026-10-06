import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyObservation } from './observationMeta.js';

test('the most common field note — solid waste — is recognised', () => {
  const r = classifyObservation('Presence of solid waste, water hyacinths and residential area.');
  assert.equal(r.scene, 'waste');
  assert.equal(r.status, 'watch');
  assert.ok(r.tags.includes('Aquatic Plants'));
});

test('pollution outranks everything else', () => {
  const r = classifyObservation('High tide, oil sheen near the outfall, fishing boats');
  assert.equal(r.scene, 'pollution');
  assert.equal(r.status, 'critical');
});

test('tide notes keep their high/low label and scene', () => {
  assert.equal(classifyObservation('High tide, presence of fishing boats').label, 'High Tide');
  const low = classifyObservation('low tide, wavy, swimming/ surfing activity was observed');
  assert.equal(low.scene, 'tide-low');
  assert.equal(low.label, 'Low Tide');
});

test('"no solid waste" is good news, not a waste sighting', () => {
  const r = classifyObservation('Calm water, no solid waste observed');
  assert.equal(r.scene, 'calm');
  assert.equal(r.status, 'good');
});

test('construction and boats map to their scenes', () => {
  assert.equal(classifyObservation('On-going construction of bridge, visible dredger').scene, 'construction');
  assert.equal(classifyObservation('Presence of fishing boats and fish traps').scene, 'boats');
});

test('unknown notes fall back to a neutral observed scene', () => {
  const r = classifyObservation('Sampling done at 9am');
  assert.deepEqual([r.scene, r.status, r.tags.length], ['observed', 'observed', 0]);
});
