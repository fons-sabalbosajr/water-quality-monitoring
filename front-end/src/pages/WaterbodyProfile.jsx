import { useMemo, useState } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import wqmData from '../data/wqm2026.json';
import {
  GAUGE_PARAMS, OBSERVATION_PARAM, PARAM_LIMITS, TREND_LABELS, fmt, fmtWithUnit, getAvailableParams,
  getAverageNumber, getGaugePercent, getLatestNumber, getObservationEntries,
  getParamData, getParamStatus, getParamUnit, getStations, getTrendNumber, toTitle,
} from '../utils/wqmData';
import './WaterbodyProfile.css';

const STN_COLORS = ['#446ACB','#7CB675','#e07b54','#a78bfa','#f59e0b','#06b6d4','#ec4899','#84cc16'];

const WaterbodyProfile = ({ waterbodyKey }) => {
  const sheetData = wqmData[waterbodyKey];
  const stations = useMemo(() => getStations(sheetData), [sheetData]);
  const waterbodyName = sheetData?.name ? toTitle(sheetData.name) : toTitle(waterbodyKey);
  const classLabel = sheetData?.classInfo?.match(/CLASS\s+(\S+)/)?.[1] || '';

  const availableParams = useMemo(() => {
    return getAvailableParams(stations, true);
  }, [stations]);

  const [selectedParam, setSelectedParam] = useState('DO (mg/L)');
  const [paramMenuOpen, setParamMenuOpen] = useState(false);
  const activeParam = availableParams.includes(selectedParam) ? selectedParam : (availableParams[0] || 'DO (mg/L)');
  const activeUnit = getParamUnit(activeParam);

  const stationSeries = useMemo(() => stations.map((station, index) => ({
    station,
    chartKey: `station_${index}`,
    color: STN_COLORS[index % STN_COLORS.length],
  })), [stations]);

  const isObservationMode = activeParam === OBSERVATION_PARAM;
  const observationEntries = useMemo(() => getObservationEntries(stations), [stations]);
  const numericParams = useMemo(
    () => availableParams.filter((param) => param !== OBSERVATION_PARAM),
    [availableParams]
  );
  const gaugeParams = useMemo(
    () => GAUGE_PARAMS.filter((param) => availableParams.includes(param)),
    [availableParams]
  );
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

  // Monthly chart data for selected parameter (one line per station)
  const chartData = useMemo(() => {
    if (isObservationMode) return [];

    return TREND_LABELS.map((label, monthIndex) => {
      const point = { label };
      stationSeries.forEach(({ station, chartKey }) => {
        point[chartKey] = getTrendNumber(getParamData(station, activeParam), monthIndex);
      });
      return point;
    });
  }, [activeParam, isObservationMode, stationSeries]);

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
            <span className="wb-year-badge">CY 2026</span>
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
            <p className="wb-chart-sub">Monthly readings per monitoring station{activeUnit ? ` · ${activeUnit}` : ''} &middot; CY 2026</p>
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
                {availableParams.map((param) => (
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
          <p className="wb-summary-sub">Latest DO, TSS, pH, temperature, nitrate, and phosphate readings per station</p>
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
          <h3 className="wb-summary-title">Annual Summary</h3>
          <p className="wb-summary-sub">Annual average values per monitoring station</p>
        </div>
        <div className="wb-summary-wrap">
          <table className="wb-summary-table">
            <thead>
              <tr>
                <th className="wbs-th-param">Parameter</th>
                {stations.map((s) => (
                  <th key={s.stnId} className="wbs-th-stn">
                    <span className="wbs-stn-id">{s.stnId}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {numericParams.map((param, pIdx) => (
                <tr key={param} className={pIdx % 2 === 0 ? 'wbs-even' : 'wbs-odd'}>
                  <td className="wbs-td-param">{param}</td>
                  {stations.map((stn) => {
                    const p = getParamData(stn, param);
                    return (
                      <td
                        key={stn.stnId}
                        className={`wbs-td-val${!p || p.avg === null ? ' wbs-null' : ''}`}
                      >
                        {fmt(getAverageNumber(p))}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
};

export default WaterbodyProfile;
