import { useMemo, useState } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { Tag, Tooltip as AntTooltip } from 'antd';
import {
  CheckCircleFilled,
  CloseCircleFilled,
  MinusCircleOutlined,
  WarningFilled,
} from '@ant-design/icons';
import {
  MONTHS_SHORT, OBSERVATION_PARAM, PARAM_LIMITS, fmt, fmtWithUnit, getAvailableParams,
  getAverageNumber, getGaugePercent, getLatestNumber, getObservationEntries,
  getMonthlyNumber, getParamData, getParamStatus, getParamUnit, toTitle,
} from '../utils/wqmData';
import { getReadableStations, getWaterbodyProfileName, useWqmSheets, useAllYearSheets } from '../utils/wqmSheets';
import { useLineChartMergeSettings, buildMultiYearTrend } from '../utils/lineChartSettings';
import './WaterbodyProfile.css';

const STN_COLORS = ['#446ACB','#7CB675','#e07b54','#a78bfa','#f59e0b','#06b6d4','#ec4899','#84cc16'];

// Visual status descriptor for the Annual Summary cells.
const SUMMARY_STATUS = {
  alert: { color: '#dc2626', tag: 'red', label: 'Exceeds limit', icon: <CloseCircleFilled /> },
  watch: { color: '#d97706', tag: 'gold', label: 'Near limit', icon: <WarningFilled /> },
  safe: { color: '#16a34a', tag: 'green', label: 'Within limit', icon: <CheckCircleFilled /> },
  nodata: { color: '#94a3b8', tag: 'default', label: 'No data', icon: <MinusCircleOutlined /> },
};

const WaterbodyProfile = ({ waterbodyKey, year = 2026, sheets: providedSheets = null }) => {
  const localSheets = useWqmSheets();
  const sheets = providedSheets || localSheets;
  const sheetData = sheets.find((sheet) => sheet.key === waterbodyKey);
  const stations = useMemo(() => getReadableStations(sheetData), [sheetData]);
  const waterbodyName = getWaterbodyProfileName(
    waterbodyKey,
    sheetData?.name ? sheetData.name : toTitle(waterbodyKey),
  );
  const classLabel = sheetData?.classInfo?.match(/CLASS\s+(\S+)/)?.[1] || '';

  const availableParams = useMemo(() => {
    return getAvailableParams(stations, true).filter((param) => (
      param === OBSERVATION_PARAM
        ? getObservationEntries(stations).length > 0
        : stations.some((station) => getLatestNumber(getParamData(station, param)) !== null
          || MONTHS_SHORT.some((_, index) => getMonthlyNumber(getParamData(station, param), index) !== null))
    ));
  }, [stations]);

  // Parameters available for the Monthly Trend chart: any parameter that has at
  // least one numeric reading (a monthly value OR an annual average). Parameters
  // with no data at all stay out so the dropdown never lands on an empty chart,
  // but average-only parameters are kept so waterbodies that only report annual
  // averages still appear in the chart (matching the gauge metrics).
  const trendParams = useMemo(() => availableParams.filter((param) => (
    param === OBSERVATION_PARAM
      ? getObservationEntries(stations).length > 0
      : stations.some((station) => getLatestNumber(getParamData(station, param)) !== null)
  )), [availableParams, stations]);

  const [selectedParam, setSelectedParam] = useState('DO (mg/L)');
  const [paramMenuOpen, setParamMenuOpen] = useState(false);
  const activeParam = trendParams.includes(selectedParam) ? selectedParam : (trendParams[0] || 'DO (mg/L)');
  const activeUnit = getParamUnit(activeParam);
  const isObservationMode = activeParam === OBSERVATION_PARAM;

  // Multi-year historical trend: when the admin enables it the chart spans
  // multiple years instead of just the current published year.
  const { includeHistoricalYears, historicalYears } = useLineChartMergeSettings();
  const allTrendYears = useMemo(() => {
    if (!includeHistoricalYears || !historicalYears.length) return [];
    const sorted = [...historicalYears].sort((a, b) => a - b);
    return sorted.includes(year) ? sorted : [...sorted, year];
  }, [includeHistoricalYears, historicalYears, year]);
  const isMultiYear = allTrendYears.length > 0;

  const { map: allYearSheetsMap } = useAllYearSheets(isMultiYear ? allTrendYears : []);

  const rawStationSeries = useMemo(() => stations
    .filter((station) => isObservationMode
      || getLatestNumber(getParamData(station, activeParam)) !== null)
    .map((station, index) => ({
    station,
    chartKey: `station_${index}`,
    color: STN_COLORS[index % STN_COLORS.length],
  })), [activeParam, isObservationMode, stations]);

  const stationSeries = useMemo(() => (
    isMultiYear && !isObservationMode
      ? [{ station: { stnId: 'Historical trend (all stations)', stnNo: 'merged' }, chartKey: 'merged', color: STN_COLORS[0] }]
      : rawStationSeries
  ), [isMultiYear, isObservationMode, rawStationSeries]);

  const observationEntries = useMemo(() => getObservationEntries(stations), [stations]);
  const numericParams = useMemo(
    () => availableParams.filter((param) => param !== OBSERVATION_PARAM),
    [availableParams]
  );
  const gaugeParams = useMemo(() => (
    numericParams.filter((param) => stations.some((station) => getLatestNumber(getParamData(station, param)) !== null))
  ), [numericParams, stations]);
  const stationGaugeData = useMemo(() => stations.map((station) => ({
    station,
    metrics: gaugeParams.map((param) => {
      const value = getLatestNumber(getParamData(station, param));
      return {
        param,
        value,
        percent: getGaugePercent(param, value),
        status: getParamStatus(param, value),
        unit: PARAM_LIMITS[param]?.unit || '',
      };
    }).filter((metric) => metric.value !== null),
  })), [gaugeParams, stations]);

  // Annual-average compliance summary used by the redesigned Annual Summary
  // panel: per-station status counts plus per-cell status descriptors.
  const annualSummary = useMemo(() => {
    const perStation = stations.map((station) => {
      let alert = 0;
      let watch = 0;
      let safe = 0;
      let nodata = 0;
      numericParams.forEach((param) => {
        const value = getAverageNumber(getParamData(station, param));
        const status = value === null ? 'nodata' : getParamStatus(param, value);
        if (status === 'alert') alert += 1;
        else if (status === 'watch') watch += 1;
        else if (status === 'nodata') nodata += 1;
        else safe += 1;
      });
      const overall = alert > 0 ? 'alert' : watch > 0 ? 'watch' : (safe > 0 ? 'safe' : 'nodata');
      return { station, alert, watch, safe, nodata, overall };
    });
    const totals = perStation.reduce(
      (acc, row) => ({
        alert: acc.alert + row.alert,
        watch: acc.watch + row.watch,
        safe: acc.safe + row.safe,
      }),
      { alert: 0, watch: 0, safe: 0 },
    );
    return { perStation, totals };
  }, [numericParams, stations]);

  // Monthly chart data for selected parameter
  const chartData = useMemo(() => {
    if (isObservationMode) return [];

    // Multi-year mode: stitch months across years into one continuous merged line.
    if (isMultiYear) {
      return buildMultiYearTrend(
        allYearSheetsMap,
        allTrendYears,
        waterbodyKey,
        activeParam,
        MONTHS_SHORT,
        getParamData,
        getMonthlyNumber,
        getReadableStations,
      );
    }

    // Stations that report only an annual average (no monthly breakdown) would
    // otherwise draw a flat line across all 12 months. That clutters ("jumbles")
    // the trend when other stations have real monthly data, so the flat-average
    // fallback is only used when NO station has any monthly reading for the
    // parameter (i.e. the chart would otherwise be empty).
    const anyMonthly = rawStationSeries.some(({ station }) =>
      MONTHS_SHORT.some((_, index) => getMonthlyNumber(getParamData(station, activeParam), index) !== null),
    );
    const avgFallbackByKey = {};
    if (!anyMonthly) {
      rawStationSeries.forEach(({ station, chartKey }) => {
        const paramData = getParamData(station, activeParam);
        const fallback = getAverageNumber(paramData) ?? getLatestNumber(paramData);
        if (fallback !== null) avgFallbackByKey[chartKey] = fallback;
      });
    }

    return MONTHS_SHORT.map((label, monthIndex) => {
      const point = { label };
      rawStationSeries.forEach(({ station, chartKey }) => {
        const monthlyValue = getMonthlyNumber(getParamData(station, activeParam), monthIndex);
        point[chartKey] = monthlyValue !== null ? monthlyValue : (avgFallbackByKey[chartKey] ?? null);
      });
      return point;
    }).filter((point) => rawStationSeries.some(({ chartKey }) => point[chartKey] !== null && point[chartKey] !== undefined));
  }, [activeParam, isObservationMode, isMultiYear, allYearSheetsMap, allTrendYears, waterbodyKey, rawStationSeries]);

  const lastTrendIndexByKey = useMemo(() => stationSeries.reduce((lookup, { chartKey }) => {
    for (let index = chartData.length - 1; index >= 0; index -= 1) {
      if (chartData[index]?.[chartKey] !== null && chartData[index]?.[chartKey] !== undefined) {
        lookup[chartKey] = index;
        break;
      }
    }
    return lookup;
  }, {}), [chartData, stationSeries]);

  if (!sheetData) return null;

  return (
    <div className="wb-profile">
      {/* Header */}
      <div className="wb-profile-header">
        <div className="wb-profile-title-area">
          <h2 className="wb-profile-name">{waterbodyName}</h2>
          <div className="wb-profile-meta">
            {classLabel && <span className="wb-class-badge">Class {classLabel}</span>}
            <span className="wb-stn-badge">{stations.length} monitoring stations</span>
            <span className="wb-year-badge">CY {year}</span>
          </div>
          {sheetData.classInfo && (
            <p className="wb-class-info-text">{sheetData.classInfo}</p>
          )}
        </div>
        <div className="wb-header-stations">
          <p>Monitoring Stations</p>
          <div className="wb-header-station-list">
            {stationSeries.map(({ station, color }) => (
              <span key={station.stnId} className="wb-header-station-pill">
                <i style={{ background: color }} />
                {station.stnId}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Monthly Trend Chart */}
      <div className="wb-chart-card">
        <div className="wb-chart-header">
          <div>
            <h3 className="wb-chart-title">Monthly Trend</h3>
            <p className="wb-chart-sub">Monthly readings per monitoring station{activeUnit ? ` · ${activeUnit}` : ''} &middot; CY {year}</p>
          </div>
          <div className="wb-param-dropdown">
            <button
              type="button"
              className="wb-param-trigger"
              onClick={() => setParamMenuOpen((open) => !open)}
              aria-haspopup="listbox"
              aria-expanded={paramMenuOpen}
            >
              <span>{activeParam}</span>
              <b>v</b>
            </button>
            {paramMenuOpen && (
              <div className="wb-param-menu" role="listbox">
                {trendParams.map((param) => (
                  <button
                    key={param}
                    type="button"
                    className={activeParam === param ? 'active' : ''}
                    onClick={() => {
                      setSelectedParam(param);
                      setParamMenuOpen(false);
                    }}
                  >
                    {param}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        {isObservationMode ? (
          <div className="wb-observation-trend">
            {observationEntries.length === 0 ? (
              <div className="wb-observation-empty">No observation values available for this waterbody.</div>
            ) : observationEntries.map((entry) => (
              <article key={`${entry.station.stnId}-${entry.month}`} className="wb-observation-card">
                <span className="wb-observation-icon">i</span>
                <div>
                  <strong>{entry.month} · {entry.station.stnId}</strong>
                  <p>{entry.value}</p>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11 }}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                tick={{ fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                width={48}
                label={activeUnit ? { value: activeUnit, angle: -90, position: 'insideLeft', fontSize: 11 } : undefined}
              />
              <Tooltip
                formatter={(value, name) => [fmtWithUnit(value, activeParam), name]}
                contentStyle={{
                  background: 'var(--bg-card)',
                  border: '1px solid var(--border)',
                  borderRadius: '0.5rem',
                  fontSize: '0.82rem',
                }}
              />
              <Legend wrapperStyle={{ fontSize: '0.78rem', paddingTop: '0.5rem' }} />
              {stationSeries.map(({ station, chartKey, color }) => (
                <Area
                  key={chartKey}
                  type="monotone"
                  dataKey={chartKey}
                  name={station.stnId}
                  stroke={color}
                  fill={color}
                  fillOpacity={0.1}
                  strokeWidth={2}
                  dot={(dotProps) => {
                    const { cx, cy, index } = dotProps;
                    if (cx === undefined || cy === undefined) return null;
                    const isLatest = lastTrendIndexByKey[chartKey] === index;
                    return (
                      <g>
                        {isLatest && <circle className="wb-trend-pulse-ring" cx={cx} cy={cy} r="7" fill={color} />}
                        <circle className={isLatest ? 'wb-trend-last-dot' : ''} cx={cx} cy={cy} r={isLatest ? 4.5 : 3} fill={color} stroke="var(--bg-card)" strokeWidth="2" />
                      </g>
                    );
                  }}
                  activeDot={{ r: 6 }}
                  connectNulls
                />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Station Gauge Metrics */}
      <div className="wb-gauge-section">
        <div className="wb-gauge-header">
          <h3 className="wb-summary-title">Station Parameter Gauge Metrics</h3>
          <p className="wb-summary-sub">Latest available parameter readings per station</p>
        </div>
        <div className="wb-gauge-table-wrap">
          <table className="wb-gauge-table">
            <thead>
              <tr>
                <th>Station</th>
                {gaugeParams.map((param) => <th key={param}>{param}</th>)}
              </tr>
            </thead>
            <tbody>
              {stationGaugeData.map(({ station, metrics }) => {
                const metricLookup = Object.fromEntries(metrics.map((metric) => [metric.param, metric]));
                return (
                  <tr key={station.stnId}>
                    <td className="wb-gauge-station">
                      <strong>{station.stnId}</strong>
                      <span>{station.address}</span>
                    </td>
                    {gaugeParams.map((param) => {
                      const metric = metricLookup[param];
                      return (
                        <td key={param}>
                          {metric ? (
                            <div className={`wb-rect-gauge status-${metric.status}`}>
                              <div>
                                <strong>{fmt(metric.value)}</strong>
                                <span>{metric.unit || 'index'}</span>
                              </div>
                              <i style={{ '--pct': `${metric.percent}%` }} />
                            </div>
                          ) : <span className="wb-gauge-empty">—</span>}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Annual Summary Table */}
      <div className="wb-summary-card">
        <div className="wb-summary-header">
          <div>
            <h3 className="wb-summary-title">Annual Summary</h3>
            <p className="wb-summary-sub">Annual average values with water quality guideline status</p>
          </div>
          <div className="wb-summary-legend">
            <Tag color="green" icon={<CheckCircleFilled />}>{annualSummary.totals.safe} within limit</Tag>
            <Tag color="gold" icon={<WarningFilled />}>{annualSummary.totals.watch} near limit</Tag>
            <Tag color="red" icon={<CloseCircleFilled />}>{annualSummary.totals.alert} exceeds</Tag>
          </div>
        </div>
        <div className="wb-summary-wrap">
          <table className="wb-summary-table">
            <thead>
              <tr>
                <th className="wbs-th-param">Parameter</th>
                {stations.map((s, sIdx) => {
                  const overall = annualSummary.perStation[sIdx]?.overall || 'nodata';
                  const meta = SUMMARY_STATUS[overall];
                  return (
                    <th key={s.stnId} className="wbs-th-stn">
                      <AntTooltip title={`${meta.label} (overall)`}>
                        <span className="wbs-stn-id">
                          <span className="wbs-stn-dot" style={{ background: meta.color }} />
                          {s.stnId}
                        </span>
                      </AntTooltip>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {numericParams.map((param, pIdx) => {
                const limit = PARAM_LIMITS[param];
                const limitLabel = limit
                  ? [limit.min !== undefined ? `≥${limit.min}` : null, limit.max !== undefined ? `≤${limit.max}` : null]
                      .filter(Boolean)
                      .join(' ')
                  : '';
                return (
                  <tr key={param} className={pIdx % 2 === 0 ? 'wbs-even' : 'wbs-odd'}>
                    <td className="wbs-td-param">
                      <span className="wbs-param-name">{param}</span>
                      {limitLabel && <span className="wbs-param-limit">{limitLabel}</span>}
                    </td>
                    {stations.map((stn) => {
                      const p = getParamData(stn, param);
                      const value = getAverageNumber(p);
                      const status = value === null ? 'nodata' : getParamStatus(param, value);
                      const meta = SUMMARY_STATUS[status];
                      return (
                        <td key={stn.stnId} className="wbs-td-val">
                          <AntTooltip title={meta.label}>
                            <span className="wbs-val-chip" style={{ color: meta.color }}>
                              <span className="wbs-val-icon">{meta.icon}</span>
                              <span className="wbs-val-num">{value === null ? '—' : fmt(value)}</span>
                            </span>
                          </AntTooltip>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
};

export default WaterbodyProfile;
