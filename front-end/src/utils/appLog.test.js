import test from 'node:test';
import assert from 'node:assert/strict';

// appLog imports encryptedStorage, which reads window.location.origin at module
// load to derive its key. Shim just enough of the browser for the import to
// succeed; these tests only exercise the pure classification helpers.
class MemoryStorage {
  constructor() { this.map = new Map(); }
  getItem(key) { return this.map.has(key) ? this.map.get(key) : null; }
  setItem(key, value) { this.map.set(key, String(value)); }
  removeItem(key) { this.map.delete(key); }
  clear() { this.map.clear(); }
  get length() { return this.map.size; }
}
globalThis.localStorage = new MemoryStorage();
globalThis.sessionStorage = new MemoryStorage();
globalThis.window = {
  location: { origin: 'http://localhost:5173', pathname: '/water-quality-monitoring/dashboard' },
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => true,
};
globalThis.CustomEvent = class {
  constructor(type, init) { this.type = type; this.detail = init?.detail; }
};

const { LOG_CATEGORIES, categorizeAction, severityForCategory } = await import('./appLog.js');

/**
 * The Activity Log derives its category, colour and severity from the action
 * text rather than making every call site declare them. These cover the phrases
 * actually used across the app so a rename does not silently drop entries into
 * "system".
 */

test('every category the classifier can return is declared in LOG_CATEGORIES', () => {
  const samples = [
    'Signed in', 'Added station record', 'Deleted user account',
    'Updated user details', 'Exported tabular results CSV',
    'Navigated app view', 'Something entirely unknown',
  ];
  samples.forEach((action) => {
    assert.ok(
      LOG_CATEGORIES.includes(categorizeAction(action)),
      `"${action}" produced an undeclared category`,
    );
  });
});

test('classifies the real action strings used across the app', () => {
  const cases = {
    // auth
    'Signed in': 'auth',
    'Signed out': 'auth',
    'Reviewed account status': 'auth',
    // create
    'Added station record': 'create',
    'Added new waterbody': 'create',
    'Created monitoring year': 'create',
    // update
    'Updated station record': 'update',
    'Updated user details': 'update',
    'Updated user access override': 'update',
    'Saved chart configuration': 'update',
    // delete
    'Deleted station record': 'delete',
    'Deleted user account': 'delete',
    'Deleted monitoring year': 'delete',
    'Deleted waterbody from tabular dataset': 'delete',
    'Cleared app logs': 'delete',
    'Reset tabular draft data': 'delete',
    // export
    'Exported tabular results CSV': 'export',
    // navigate
    'Navigated app view': 'navigate',
    'Opened developer manager section': 'navigate',
    'Opened settings section': 'navigate',
    'Opened visualization': 'navigate',
  };
  for (const [action, expected] of Object.entries(cases)) {
    assert.equal(categorizeAction(action), expected, `"${action}"`);
  }
});

test('classification is case-insensitive and falls back to system', () => {
  assert.equal(categorizeAction('DELETED STATION RECORD'), 'delete');
  assert.equal(categorizeAction('deleted station record'), 'delete');
  assert.equal(categorizeAction('Recalculated something'), 'system');
  assert.equal(categorizeAction(''), 'system');
  assert.equal(categorizeAction(null), 'system');
  assert.equal(categorizeAction(undefined), 'system');
  assert.equal(categorizeAction(12345), 'system');
});

test('destructive actions are the only ones marked critical', () => {
  assert.equal(severityForCategory('delete'), 'critical');
  for (const category of LOG_CATEGORIES.filter((c) => c !== 'delete')) {
    assert.notEqual(
      severityForCategory(category),
      'critical',
      `${category} should not be critical`,
    );
  }
  assert.equal(severityForCategory('auth'), 'notice');
  assert.equal(severityForCategory('navigate'), 'info');
  // Unknown categories must still yield a usable severity for the row class.
  assert.equal(severityForCategory('nonsense'), 'info');
});

test('severity is always one of the three the stylesheet handles', () => {
  const allowed = new Set(['critical', 'notice', 'info']);
  [...LOG_CATEGORIES, 'unknown', '', null].forEach((category) => {
    assert.ok(allowed.has(severityForCategory(category)), `category ${category}`);
  });
});
