import { useEffect } from 'react';
import api from '../api/axios';
import { getForecastMonths, setForecastMonths, useForecastMonths } from './forecastSettings.js';

// The forecast horizon is an app-wide setting stored in MongoDB (AppSetting
// "forecastMonths"). It used to live only in the admin's browser storage, so
// the public dashboard — and admins on any other device — kept forecasting the
// default 3 months. Kept apart from forecastSettings.js so that module stays
// importable from `npm test` (axios needs Vite's import.meta.env).

const SYNC_TTL_MS = 60 * 1000;
let lastSyncedAt = 0;
let inFlight = null;

/** Pull the server horizon into local storage; every hook updates via the event. */
export const syncForecastMonths = ({ force = false } = {}) => {
  if (inFlight) return inFlight;
  if (!force && Date.now() - lastSyncedAt < SYNC_TTL_MS) return Promise.resolve(getForecastMonths());
  lastSyncedAt = Date.now();
  inFlight = api.get('/water/public/forecast-months')
    .then(({ data }) => {
      const months = Number(data?.months);
      // Only write on change, so a routine check does not re-render every chart.
      return months && months !== getForecastMonths() ? setForecastMonths(months) : getForecastMonths();
    })
    .catch(() => getForecastMonths())
    .finally(() => { inFlight = null; });
  return inFlight;
};

/** Admin/developer: persist the horizon for every user, then apply it here. */
export const saveForecastMonthsToServer = async (value) => {
  const { data } = await api.patch('/admin/settings/forecast-months', { months: Number(value) });
  lastSyncedAt = Date.now();
  return setForecastMonths(data?.months ?? value);
};

/** useForecastMonths plus a server sync on mount and when the tab regains focus. */
export const useForecastHorizon = () => {
  const months = useForecastMonths();
  useEffect(() => {
    const sync = () => { syncForecastMonths(); };
    sync();
    window.addEventListener('focus', sync);
    return () => window.removeEventListener('focus', sync);
  }, []);
  return months;
};
