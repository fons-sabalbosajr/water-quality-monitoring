import axios from 'axios';
import encryptedStorage from '../utils/encryptedStorage';

const STORAGE_KEY = 'wqm_user';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || (import.meta.env.PROD ? '/water-quality-monitoring/api' : '/api'),
  // Without a timeout a stalled request never settles: the calling effect stays
  // in its loading state forever and the spinner never clears.
  timeout: Number(import.meta.env.VITE_API_TIMEOUT_MS) || 30000,
});

// Attach JWT token automatically
api.interceptors.request.use((config) => {
  const user = encryptedStorage.getItem(STORAGE_KEY);
  if (user?.token) {
    config.headers.Authorization = `Bearer ${user.token}`;
  }
  return config;
});

// Public endpoints are reachable without a session; a 401 there is expected and
// must not bounce an anonymous visitor off the public dashboard.
const isPublicRequest = (url = '') => url.includes('/public/');

let redirecting = false;

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error.response?.status;
    const url = error.config?.url || '';

    // A revoked or expired session used to persist silently: every request
    // 401'd, the UI showed empty panels, and the stale user stayed in storage
    // until a manual logout. Clear it and send the user to the login screen once.
    if ((status === 401 || error.response?.data?.code === 'ACCOUNT_NOT_APPROVED') && !isPublicRequest(url)) {
      encryptedStorage.removeItem(STORAGE_KEY);
      // `admin` is the sign-in page; `login` stays listed so the legacy path
      // does not bounce while it redirects.
      const onAuthPage = /\/(admin|login|register|forgot-password|reset-password|welcome|public-dashboard)/.test(
        window.location.pathname,
      );
      if (!onAuthPage && !redirecting) {
        redirecting = true;
        window.location.assign('/water-quality-monitoring/admin');
      }
    }

    // Normalise the shape every caller reads so `error.response.data.message`
    // is always present, including on network failures and timeouts.
    if (!error.response) {
      // A redirect (the 401 branch above) or an unmounting component aborts
      // every in-flight request. Those arrive here indistinguishable from a
      // real outage unless the cancel codes are checked first, which is how
      // unrelated panels ended up reporting "Cannot reach the server" when the
      // only real problem was one expired token.
      const canceled = error.code === 'ERR_CANCELED'
        || error.name === 'CanceledError'
        || error.name === 'AbortError';
      const timedOut = error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT';

      error.isCanceled = canceled;
      error.isNetworkError = !canceled && !timedOut;
      error.response = {
        status: 0,
        data: {
          code: canceled ? 'REQUEST_CANCELED' : timedOut ? 'TIMEOUT' : 'NETWORK_ERROR',
          message: canceled
            ? 'Request cancelled.'
            : timedOut
              ? 'The request timed out. Check your connection and try again.'
              : 'Cannot reach the server. Check your connection and try again.',
        },
      };
    }

    return Promise.reject(error);
  },
);

export default api;
