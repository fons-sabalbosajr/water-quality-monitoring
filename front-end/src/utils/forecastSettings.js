import { useEffect, useState } from "react";
import encryptedStorage from "./encryptedStorage";

export const FORECAST_MONTHS_KEY = "wqms_forecast_months";
export const FORECAST_EVENT = "wqms:forecast-months";

export const clampForecastMonths = (value) => {
  const n = Number(value);
  return Number.isFinite(n) && n >= 1 && n <= 3 ? Math.round(n) : 3;
};

export const getForecastMonths = () => {
  try {
    return clampForecastMonths(encryptedStorage.getItem(FORECAST_MONTHS_KEY));
  } catch {
    return 3;
  }
};

export const setForecastMonths = (value) => {
  const clamped = clampForecastMonths(value);
  encryptedStorage.setItem(FORECAST_MONTHS_KEY, String(clamped));
  window.dispatchEvent(new CustomEvent(FORECAST_EVENT, { detail: clamped }));
  return clamped;
};

/**
 * React hook that returns the current forecast horizon (months) and keeps it in
 * sync across the whole app. It listens to the in-tab CustomEvent as well as the
 * cross-tab `storage` event so the setting takes effect everywhere immediately.
 */
export const useForecastMonths = () => {
  const [months, setMonths] = useState(getForecastMonths);

  useEffect(() => {
    const handleEvent = (event) =>
      setMonths(clampForecastMonths(event?.detail ?? getForecastMonths()));
    const handleStorage = () => setMonths(getForecastMonths());

    window.addEventListener(FORECAST_EVENT, handleEvent);
    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener(FORECAST_EVENT, handleEvent);
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  return months;
};
