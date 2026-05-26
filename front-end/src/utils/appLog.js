const LOG_KEY = 'wqms_app_logs';

const readLogs = () => {
  try {
    return JSON.parse(localStorage.getItem(LOG_KEY) || '[]');
  } catch {
    return [];
  }
};

export const getAppLogs = () => readLogs();

export const clearAppLogs = () => {
  localStorage.removeItem(LOG_KEY);
};

export const logActivity = (action, details = {}, user = null) => {
  const entry = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    at: new Date().toISOString(),
    action,
    actor: user?.email || user?.name || 'system',
    role: user?.role || 'system',
    details,
  };
  const next = [entry, ...readLogs()].slice(0, 500);
  localStorage.setItem(LOG_KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent('wqms:log', { detail: entry }));
  return entry;
};
