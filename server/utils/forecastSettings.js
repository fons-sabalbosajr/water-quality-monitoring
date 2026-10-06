// Shared by the admin (write) and public (read) forecast-horizon routes. Must
// match clampForecastMonths in front-end/src/utils/forecastSettings.js.
const FORECAST_MONTHS_KEY = 'forecastMonths';
const MAX_FORECAST_MONTHS = 3;
const DEFAULT_FORECAST_MONTHS = 3;

const clampForecastMonths = (value) => {
  const n = Number(value);
  return Number.isFinite(n) && n >= 1 && n <= MAX_FORECAST_MONTHS ? Math.round(n) : DEFAULT_FORECAST_MONTHS;
};

module.exports = { FORECAST_MONTHS_KEY, MAX_FORECAST_MONTHS, DEFAULT_FORECAST_MONTHS, clampForecastMonths };
