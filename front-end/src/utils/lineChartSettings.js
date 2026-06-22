import { useEffect, useState } from 'react';
import encryptedStorage from './encryptedStorage';

export const LINE_CHART_MERGE_KEY = 'wqms_linechart_merge_settings';
export const LINE_CHART_MERGE_EVENT = 'wqms:linechart-merge';

const DEFAULTS = {
  includeHistoricalYears: false,
  historicalYears: [],
};

export const getLineChartMergeSettings = () => {
  try {
    return { ...DEFAULTS, ...(encryptedStorage.getItem(LINE_CHART_MERGE_KEY) || {}) };
  } catch {
    return { ...DEFAULTS };
  }
};

export const setLineChartMergeSettings = (next) => {
  const merged = { ...getLineChartMergeSettings(), ...next };
  encryptedStorage.setItem(LINE_CHART_MERGE_KEY, merged);
  window.dispatchEvent(new CustomEvent(LINE_CHART_MERGE_EVENT, { detail: merged }));
  return merged;
};

export const useLineChartMergeSettings = () => {
  const [settings, setSettings] = useState(getLineChartMergeSettings);
  useEffect(() => {
    const handleEvent = (event) => setSettings(event?.detail ?? getLineChartMergeSettings());
    const handleStorage = () => setSettings(getLineChartMergeSettings());
    window.addEventListener(LINE_CHART_MERGE_EVENT, handleEvent);
    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener(LINE_CHART_MERGE_EVENT, handleEvent);
      window.removeEventListener('storage', handleStorage);
    };
  }, []);
  return settings;
};

export const buildMultiYearTrend = (
  allYearSheets,
  years,
  waterbodyKey,
  param,
  monthsShort,
  getParamData,
  getMonthlyNumber,
  getReadableStations,
) => {
  const points = [];
  for (const yr of years) {
    const sheets = allYearSheets.get(yr) || [];
    const sheet = sheets.find((s) => s.key === waterbodyKey);
    const stations = getReadableStations(sheet);
    for (let mi = 0; mi < monthsShort.length; mi += 1) {
      const values = stations
        .map((station) => getMonthlyNumber(getParamData(station, param), mi))
        .filter((v) => v !== null && v !== undefined);
      const merged = values.length
        ? Number((values.reduce((acc, v) => acc + v, 0) / values.length).toFixed(2))
        : null;
      if (merged !== null) {
        points.push({ label: monthsShort[mi] + ' ' + yr, year: yr, monthIndex: mi, merged, count: values.length });
      }
    }
  }
  return points;
};

// Match a station record across years by station number first, then station id.
export const matchStationAcrossYears = (stations, target) =>
  stations.find((s) => (
    (target?.stnNo != null && target?.stnNo !== '' && String(s.stnNo) === String(target.stnNo))
    || (target?.stnId && s.stnId && String(s.stnId).trim().toLowerCase() === String(target.stnId).trim().toLowerCase())
  )) || null;

/**
 * Build a continuous month-by-month series for a SINGLE station and parameter
 * across multiple years, matching the same station in every year.  Returns the
 * full timeline (one entry per month per year) so the x-axis stays aligned;
 * missing months carry value null.
 *
 * [ { label: "Jan 2024", year, monthIndex, value }, ... ] oldest -> newest.
 */
export const buildStationMultiYearSeries = (
  allYearSheets,
  years,
  waterbodyKey,
  targetStation,
  param,
  monthsShort,
  getParamData,
  getMonthlyNumber,
  getReadableStations,
) => {
  const points = [];
  for (const yr of years) {
    const sheets = allYearSheets.get(yr) || [];
    const sheet = sheets.find((s) => s.key === waterbodyKey);
    const stations = getReadableStations(sheet);
    const matched = matchStationAcrossYears(stations, targetStation);
    for (let mi = 0; mi < monthsShort.length; mi += 1) {
      const raw = matched ? getMonthlyNumber(getParamData(matched, param), mi) : null;
      points.push({
        label: `${monthsShort[mi]} ${yr}`,
        year: yr,
        monthIndex: mi,
        value: raw === null || raw === undefined ? null : Number(Number(raw).toFixed(2)),
      });
    }
  }
  return points;
};

/**
 * Simple 1-step (next month) forecast from a numeric series using a linear
 * least-squares trend over the most recent `window` observed points.  Returns
 * { value, slope, trend, lower, upper, confidence } or null when there is not
 * enough data.  Values are clamped to be non-negative (and pH-bounded) and
 * rounded to 2 decimals.
 */
export const forecastNextMonth = (observedValues, param = '', window = 12) => {
  const series = observedValues.filter((v) => v !== null && v !== undefined && Number.isFinite(v));
  if (series.length < 2) return null;
  const recent = series.slice(-window);
  const n = recent.length;
  const xs = recent.map((_, i) => i);
  const xMean = xs.reduce((a, b) => a + b, 0) / n;
  const yMean = recent.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i += 1) {
    num += (xs[i] - xMean) * (recent[i] - yMean);
    den += (xs[i] - xMean) ** 2;
  }
  const slope = den ? num / den : 0;
  const intercept = yMean - slope * xMean;
  let predicted = slope * n + intercept;
  // residual RMSE for the band
  const residuals = recent.map((v, i) => v - (slope * i + intercept));
  const rmse = Math.sqrt(residuals.reduce((a, r) => a + r * r, 0) / n) || 0;
  // clamp
  const isPh = /(^|\b)ph\b/i.test(String(param));
  predicted = isPh ? Math.min(14, Math.max(0, predicted)) : Math.max(0, predicted);
  const round2 = (v) => Number(Number(v).toFixed(2));
  const scale = Math.max(Math.abs(yMean) || 0, 1);
  const confidence = Math.round(Math.max(40, Math.min(95, 92 - (rmse / scale) * 100)));
  const trend = Math.abs(slope) < 0.01 * scale ? 'stable' : slope > 0 ? 'increasing' : 'decreasing';
  return {
    value: round2(predicted),
    slope,
    trend,
    lower: round2(Math.max(0, predicted - rmse)),
    upper: round2(predicted + rmse),
    confidence,
  };
};

