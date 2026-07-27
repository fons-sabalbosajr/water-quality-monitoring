/**
 * Canonical description of the in-browser forecast engines.
 *
 * These engines are pure client-side maths (linear trend + Fourier seasonality,
 * and an OLS/RMSE variant). They do not call the API and work with the network
 * down. The server exposes the same list from GET /water/forecast/status purely
 * so the Settings screen can describe them alongside the *server-side* AI
 * forecast status.
 *
 * The Settings panel used to render its engine list only from that response, so
 * a failed status request made the panel claim the local engines were
 * unavailable and surface "Cannot reach the server" — even though nothing the
 * local engines need had failed. Treat the server response as an enrichment of
 * this list, never as a precondition for it.
 */
export const LOCAL_FORECAST_ENGINES = [
  {
    id: 'prophet',
    label: 'Prophet (additive)',
    description:
      'Linear trend + Fourier seasonality + widening uncertainty interval. Runs in-browser, no API key required.',
  },
  {
    id: 'ols',
    label: 'Fast trend (OLS)',
    description:
      'Ordinary least squares trend with RMSE uncertainty band. Fast in-browser screening.',
  },
];

export const DEFAULT_FORECAST_ENGINE = 'prophet';

/**
 * Merge the server's engine list over the built-in one, keeping the local
 * entries when the request failed or returned nothing usable.
 */
export const mergeForecastEngines = (serverEngines) => {
  if (!Array.isArray(serverEngines) || !serverEngines.length) {
    return LOCAL_FORECAST_ENGINES;
  }
  const byId = new Map(LOCAL_FORECAST_ENGINES.map((engine) => [engine.id, engine]));
  serverEngines.forEach((engine) => {
    if (!engine?.id) return;
    byId.set(engine.id, { ...byId.get(engine.id), ...engine });
  });
  return [...byId.values()];
};

export default LOCAL_FORECAST_ENGINES;
