import encryptedStorage from './encryptedStorage.js';

const LOG_KEY = 'wqms_app_logs';
const MAX_ENTRIES = 500;
// Persisting means AES-encrypting the whole log array. Doing that inline on
// every navigation click added a visible pause to the UI thread, so writes are
// coalesced and pushed out when the browser is idle.
const FLUSH_DELAY_MS = 400;

const readLogs = () => {
  try {
    const stored = encryptedStorage.getItem(LOG_KEY);
    return Array.isArray(stored) ? stored : [];
  } catch {
    return [];
  }
};

// In-memory view of the log. Reads never touch storage after the first load,
// and writes mutate this first so the UI updates immediately.
let logs = null;
let flushTimer = null;

const ensureLoaded = () => {
  if (logs === null) logs = readLogs();
  return logs;
};

const flush = () => {
  flushTimer = null;
  try {
    encryptedStorage.setItem(LOG_KEY, logs);
  } catch {
    // Storage full or unavailable — drop the oldest half and try once more so
    // logging never breaks the action the user actually requested.
    try {
      logs = logs.slice(0, Math.floor(MAX_ENTRIES / 2));
      encryptedStorage.setItem(LOG_KEY, logs);
    } catch {
      /* give up silently; logging is best-effort */
    }
  }
};

// requestIdleCallback takes an options object, not a delay, so the two APIs
// need separate call sites rather than one shared reference.
const hasIdleCallback = typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function';

const cancelFlush = () => {
  if (flushTimer === null) return;
  if (hasIdleCallback) window.cancelIdleCallback(flushTimer);
  else window.clearTimeout(flushTimer);
  flushTimer = null;
};

const scheduleFlush = () => {
  if (flushTimer !== null) return;
  flushTimer = hasIdleCallback
    ? window.requestIdleCallback(flush, { timeout: FLUSH_DELAY_MS * 4 })
    : window.setTimeout(flush, FLUSH_DELAY_MS);
};

// Anything still buffered when the tab closes must be written synchronously.
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => {
    if (flushTimer !== null && logs !== null) {
      cancelFlush();
      flush();
    }
  });
}

/**
 * Entries written before categories existed have no `category`/`severity`.
 * Backfill them on read so the table can filter and colour every row rather
 * than showing blanks for historical entries.
 */
const withDerivedFields = (entry) => {
  if (entry && entry.category && entry.severity) return entry;
  const category = entry?.category || categorizeAction(entry?.action);
  return { ...entry, category, severity: entry?.severity || severityForCategory(category) };
};

export const getAppLogs = () => ensureLoaded().map(withDerivedFields);

export const clearAppLogs = () => {
  logs = [];
  cancelFlush();
  encryptedStorage.removeItem(LOG_KEY);
};

const MAX_DETAIL_CHARS = 2000;

// Details come from arbitrary call sites; a huge object (e.g. a whole sheet)
// would bloat the log and slow every subsequent encrypt.
const safeDetails = (details) => {
  try {
    const json = JSON.stringify(details ?? {});
    if (json.length <= MAX_DETAIL_CHARS) return details ?? {};
    return { truncated: true, preview: json.slice(0, MAX_DETAIL_CHARS) };
  } catch {
    return { unserializable: true };
  }
};

/**
 * Classify an action so the log can be filtered and colour-coded without every
 * call site having to pass a category. Derived from the verb the action starts
 * with, which is the convention every existing call already follows
 * ("Added station record", "Deleted user account", "Signed in", …).
 */
export const LOG_CATEGORIES = ['auth', 'create', 'update', 'delete', 'export', 'navigate', 'system'];

export const categorizeAction = (action) => {
  const text = String(action || '').toLowerCase();
  if (/^(signed in|signed out|logged|session|password|account status|reviewed account)/.test(text)) return 'auth';
  if (/\b(sign|login|logout|auth|password)\b/.test(text)) return 'auth';
  if (/^(added|created|imported|registered)/.test(text)) return 'create';
  if (/^(deleted|removed|cleared|reset)/.test(text)) return 'delete';
  if (/^(updated|saved|edited|changed|published|renamed|assigned)/.test(text)) return 'update';
  if (/^(exported|downloaded|generated)/.test(text)) return 'export';
  if (/^(navigated|opened|viewed)/.test(text)) return 'navigate';
  return 'system';
};

/** Severity so the table can surface destructive actions at a glance. */
export const severityForCategory = (category) => {
  if (category === 'delete') return 'critical';
  if (category === 'auth' || category === 'create' || category === 'update') return 'notice';
  return 'info';
};

export const logActivity = (action, details = {}, user = null) => {
  const safeAction = String(action || 'Unknown action').slice(0, 200);
  const category = categorizeAction(safeAction);
  const entry = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    at: new Date().toISOString(),
    action: safeAction,
    actor: user?.email || user?.name || 'system',
    actorName: user?.name || '',
    actorId: user?._id || null,
    role: user?.role || 'system',
    // Enrichment for the Activity Log table: lets it filter, colour-code and
    // group entries without each call site having to describe itself.
    category,
    severity: severityForCategory(category),
    // Which screen the action was performed on — previously impossible to tell
    // apart for generic actions like "Saved settings".
    path: typeof window !== 'undefined' ? window.location.pathname.replace(/^\/water-quality-monitoring/, '') || '/' : '',
    details: safeDetails(details),
  };

  ensureLoaded();
  logs = [entry, ...logs].slice(0, MAX_ENTRIES);
  scheduleFlush();
  window.dispatchEvent(new CustomEvent('wqms:log', { detail: entry }));
  return entry;
};
