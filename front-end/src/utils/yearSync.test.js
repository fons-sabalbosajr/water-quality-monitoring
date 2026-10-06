import test from 'node:test';
import assert from 'node:assert/strict';
import { needsDownload, titleCaseSheetNames, toVersion } from './yearSync.js';

const STAMP = '2026-10-06T01:17:35.516Z';

test('toVersion canonicalises importedAt and rejects junk', () => {
  assert.equal(toVersion(STAMP), STAMP);
  assert.equal(toVersion(new Date(STAMP)), STAMP);
  assert.equal(toVersion(null), null);
  assert.equal(toVersion('not a date'), null);
});

test('an up-to-date local copy is kept', () => {
  assert.equal(needsDownload({ hasLocal: true, serverVersion: STAMP, localVersion: STAMP }), false);
});

test('a newer server version replaces the local copy (cross-device edits)', () => {
  assert.equal(needsDownload({ hasLocal: true, serverVersion: STAMP, localVersion: '2026-06-22T05:53:31.693Z' }), true);
});

test('an unstamped local copy is out of date (pre-sync 2026 drafts)', () => {
  assert.equal(needsDownload({ hasLocal: true, serverVersion: STAMP, localVersion: null }), true);
});

test('no local copy always downloads', () => {
  assert.equal(needsDownload({ hasLocal: false, serverVersion: STAMP, localVersion: STAMP }), true);
});

test('only all-caps waterbody names are title-cased', () => {
  const [caps, mixed, empty] = titleCaseSheetNames([
    { key: 'BOCAUE', name: 'BOCAUE RIVER' },
    { key: 'X', name: 'Gumain River (Palakol)' },
    { key: 'Y', name: '' },
  ]);
  assert.equal(caps.name, 'Bocaue River');
  assert.equal(mixed.name, 'Gumain River (Palakol)');
  assert.equal(empty.name, '');
});
