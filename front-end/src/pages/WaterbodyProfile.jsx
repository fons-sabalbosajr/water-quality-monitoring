import { useState, useMemo } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import wqmData from '../data/wqm2026.json';
import './WaterbodyProfile.css';

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const PARAM_ORDER = [
  'DO (mg/L)', 'BOD (mg/L)', 'TSS (mg/L)', 'pH',
  'Temp. (°C)', 'Color (TCU)', 'Fecal Coliform (MPN/100mL)',
  'NO3-N (mg/L)', 'PO4-P (mg/L)', 'Cl- (mg/L)', 'Oil and Grease',
];

const STN_COLORS = ['#446ACB','#7CB675','#e07b54','#a78bfa','#f59e0b','#06b6d4','#ec4899','#84cc16'];

const toTitle = (str) =>
  str.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

const fmt = (v) => {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'number') return v < 10 ? v.toFixed(2) : v.toFixed(1);
  return String(v);
};

const getParamData = (station, param) => {
  let p = station.params[param];
  if (!p && param === 'Temp. (°C)') p = station.params['Temp. (OC)'];
  return p || null;
};

const WaterbodyProfile = ({ waterbodyKey }) => {
  const sheetData = wqmData[waterbodyKey];
  if (!sheetData) return null;

  const waterbodyName = sheetData.name ? toTitle(sheetData.name) : toTitle(waterbodyKey);
  const classLabel = sheetData.classInfo?.match(/CLASS\s+(\S+)/)?.[1] || '';

  const availableParams = useMemo(() => {
    const raw = [
      ...new Set(sheetData.stations.flatMap((s) => Object.keys(s.params))),
    ].map((p) => (/temp/i.test(p) ? 'Temp. (°C)' : /observ/i.test(p) ? null : p))
      .filter(Boolean);
    const ordered = PARAM_ORDER.filter((p) => raw.includes(p));
    const extra = raw.filter((p) => !PARAM_ORDER.includes(p));
    return [...new Set([...ordered, ...extra])];
  }, [sheetData]);

  const [selectedParam, setSelectedParam] = useState(availableParams[0] || PARAM_ORDER[0]);

  // Monthly chart data for selected parameter (one line per station)
  const chartData = useMemo(() => {
    return MONTHS.map((month, mIdx) => {
      const point = { month };
      sheetData.stations.forEach((stn) => {
        const p = getParamData(stn, selectedParam);
        point[stn.stnId] = p ? p.monthly[mIdx] : null;
      });
      return point;
    });
  }, [sheetData, selectedParam]);

  return (
    <div className="wb-profile">
      {/* Header */}
      <div className="wb-profile-header">
        <div className="wb-profile-title-area">
          <h2 className="wb-profile-name">{waterbodyName}</h2>
          <div className="wb-profile-meta">
            {classLabel && <span className="wb-class-badge">Class {classLabel}</span>}
            <span className="wb-stn-badge">{sheetData.stations.length} monitoring stations</span>
            <span className="wb-year-badge">CY 2026</span>
          </div>
          {sheetData.classInfo && (
            <p className="wb-class-info-text">{sheetData.classInfo}</p>
          )}
        </div>
      </div>

      {/* Monthly Trend Chart */}
      <div className="wb-chart-card">
        <div className="wb-chart-header">
          <div>
            <h3 className="wb-chart-title">Monthly Trend</h3>
            <p className="wb-chart-sub">Monthly readings per monitoring station &middot; CY 2026</p>
          </div>
          <select
            className="wb-param-sel"
            value={selectedParam}
            onChange={(e) => setSelectedParam(e.target.value)}
          >
            {availableParams.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </div>
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis
              dataKey="month"
              tick={{ fontSize: 11 }}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              tick={{ fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              width={48}
            />
            <Tooltip
              contentStyle={{
                background: 'var(--bg-card)',
                border: '1px solid var(--border)',
                borderRadius: '0.5rem',
                fontSize: '0.82rem',
              }}
            />
            <Legend wrapperStyle={{ fontSize: '0.78rem', paddingTop: '0.5rem' }} />
            {sheetData.stations.map((stn, i) => (
              <Line
                key={stn.stnId}
                type="monotone"
                dataKey={stn.stnId}
                stroke={STN_COLORS[i % STN_COLORS.length]}
                strokeWidth={2}
                dot={{ r: 3 }}
                connectNulls={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
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
                {sheetData.stations.map((s) => (
                  <th key={s.stnId} className="wbs-th-stn">
                    <span className="wbs-stn-id">{s.stnId}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {availableParams.map((param, pIdx) => (
                <tr key={param} className={pIdx % 2 === 0 ? 'wbs-even' : 'wbs-odd'}>
                  <td className="wbs-td-param">{param}</td>
                  {sheetData.stations.map((stn) => {
                    const p = getParamData(stn, param);
                    return (
                      <td
                        key={stn.stnId}
                        className={`wbs-td-val${!p || p.avg === null ? ' wbs-null' : ''}`}
                      >
                        {fmt(p?.avg)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Station list */}
      <div className="wb-stations-grid">
        {sheetData.stations.map((stn, i) => (
          <div key={stn.stnId} className="wb-stn-card">
            <div className="wb-stn-num" style={{ background: STN_COLORS[i % STN_COLORS.length] }}>
              {stn.stnNo}
            </div>
            <div className="wb-stn-info">
              <p className="wb-stn-id">{stn.stnId}</p>
              <p className="wb-stn-addr">{stn.address}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default WaterbodyProfile;
