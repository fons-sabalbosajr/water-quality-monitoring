import { useMemo, useState } from 'react';
import wqmData from '../data/wqm2026.json';
import { IcoSearch, IcoDownload } from '../components/Icons';
import './WQM2026.css';

const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// Standard parameter display order
const PARAM_ORDER = [
  'DO (mg/L)', 'BOD (mg/L)', 'TSS (mg/L)', 'pH',
  'Temp. (°C)', 'Color (TCU)', 'Fecal Coliform (MPN/100mL)',
  'NO3-N (mg/L)', 'PO4-P (mg/L)', 'Cl- (mg/L)', 'Oil and Grease',
];

// Normalize param names from raw data
const normalizeParam = (p) => {
  if (/temp/i.test(p)) return 'Temp. (°C)';
  if (/observ/i.test(p)) return null;
  return p;
};

// Title-case helper
const toTitle = (str) =>
  str.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

// Format numeric value
const fmt = (v) => {
  if (v === null || v === undefined || v === '') return '-';
  if (typeof v === 'number') return v >= 1000 ? v.toFixed(0) : v < 10 ? v.toFixed(2) : v.toFixed(1);
  return String(v);
};

const SHEETS = Object.entries(wqmData).map(([key, val]) => ({
  key,
  name: val.name ? toTitle(val.name) : toTitle(key),
  classInfo: val.classInfo || '',
  stations: val.stations || [],
}));

const WQM2026 = () => {
  const [activeTab, setActiveTab] = useState(SHEETS[0]?.key || '');
  const [search, setSearch] = useState('');

  const sheet = SHEETS.find((s) => s.key === activeTab);

  // Compute ordered params for this sheet
  const params = useMemo(() => {
    if (!sheet) return [];
    const raw = [...new Set(
      sheet.stations.flatMap((s) => Object.keys(s.params)).map(normalizeParam).filter(Boolean)
    )];
    const ordered = PARAM_ORDER.filter((p) => raw.includes(p));
    const extra = raw.filter((p) => !PARAM_ORDER.includes(p));
    return [...ordered, ...extra];
  }, [sheet]);

  // Get station param data (handles Temp alias)
  const getParam = (station, paramKey) => {
    let p = station.params[paramKey];
    if (!p && paramKey === 'Temp. (°C)') p = station.params['Temp. (OC)'];
    return p || null;
  };

  // Filter stations
  const filtered = useMemo(() => {
    if (!sheet) return [];
    const q = search.toLowerCase().trim();
    return sheet.stations.filter(
      (s) =>
        !q ||
        s.stnId.toLowerCase().includes(q) ||
        s.address.toLowerCase().includes(q) ||
        String(s.stnNo).includes(q)
    );
  }, [sheet, search]);

  // Export CSV — Excel template format (one row per station-parameter)
  const exportCSV = () => {
    if (!sheet) return;
    const headers = ['Stn. No.', 'Station ID', 'Address', 'Parameter', ...MONTHS_SHORT, 'Annual Avg'];
    const rows = [];
    filtered.forEach((s) => {
      params.forEach((param) => {
        const p = getParam(s, param);
        rows.push([
          s.stnNo, s.stnId, s.address, param,
          ...(p ? p.monthly.map((v) => (v !== null ? v : '')) : Array(12).fill('')),
          p ? (p.avg !== null ? p.avg : '') : '',
        ]);
      });
    });
    const csv = [headers, ...rows]
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `WQM2026_${activeTab}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const classLabel = sheet?.classInfo?.match(/CLASS\s+(\S+)/)?.[1] || '';

  return (
    <div className="wqm2026">
      {/* Page header */}
      <div className="wqm-page-header">
        <div>
          <h2 className="wqm-title">Water Quality Data <span>2026</span></h2>
          <p className="wqm-subtitle">CY 2026 Summary Report · Environmental Management Bureau Region III</p>
        </div>
      </div>

      {/* Waterbody tab bar */}
      <div className="wb-tabbar-wrapper">
        <div className="wb-tabbar">
          {SHEETS.map((s) => (
            <button
              key={s.key}
              className={`wb-tab${activeTab === s.key ? ' active' : ''}`}
              onClick={() => { setActiveTab(s.key); setSearch(''); }}
            >
              {s.name}
            </button>
          ))}
        </div>
      </div>

      {/* Sheet area */}
      {sheet && (
        <div className="wqm-sheet-area">
          <div className="wqm-sheet-header">
            <div className="wqm-sheet-info">
              <h3 className="wqm-wb-name">{sheet.name}</h3>
              {classLabel && <span className="class-badge">Class {classLabel}</span>}
              <span className="stn-count-badge">{sheet.stations.length} stations</span>
            </div>
            <div className="wqm-controls">
              <div className="wqm-search-wrap">
                <span className="search-icon"><IcoSearch size={13} /></span>
                <input
                  className="wqm-search"
                  type="search"
                  placeholder="Filter station…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <button className="wqm-btn export-btn" onClick={exportCSV}>
                <IcoDownload size={13} />
                Export CSV
              </button>
            </div>
          </div>

          {/* ── Excel-template table ── */}
          <div className="wqm-table-wrap">
            <table className="wqm-table">
              <thead>
                <tr className="wqm-thead-row">
                  <th className="col-stnno th-s0">No.</th>
                  <th className="col-stninfo th-s1">Station / Address</th>
                  <th className="col-param th-s2">Parameter</th>
                  {MONTHS_SHORT.map((m) => (
                    <th key={m} className="col-month">{m}</th>
                  ))}
                  <th className="col-avg">Ann. Avg</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={16} className="empty-row">No stations match your filter.</td>
                  </tr>
                ) : (
                  filtered.flatMap((station, sIdx) =>
                    params.map((param, pIdx) => {
                      const p = getParam(station, param);
                      const isFirst = pIdx === 0;
                      const isLast = pIdx === params.length - 1;
                      const grp = sIdx % 2 === 0 ? 'grp-even' : 'grp-odd';
                      const rowCls = ['prow', grp, isLast ? 'grp-last' : ''].filter(Boolean).join(' ');

                      return (
                        <tr key={`${station.stnNo}-${param}`} className={rowCls}>
                          {isFirst && (
                            <>
                              <td rowSpan={params.length} className="td-stnno td-s0">
                                {station.stnNo}
                              </td>
                              <td rowSpan={params.length} className="td-stninfo td-s1">
                                <span className="stn-id-txt">{station.stnId}</span>
                                <span className="stn-addr-txt">{station.address}</span>
                              </td>
                            </>
                          )}
                          <td className="td-param td-s2">{param}</td>
                          {MONTHS_SHORT.map((_, mIdx) => {
                            const v = p ? p.monthly[mIdx] : null;
                            return (
                              <td key={mIdx} className={`td-mv${v === null ? ' td-null' : ''}`}>
                                {fmt(v)}
                              </td>
                            );
                          })}
                          <td className="td-avg">{fmt(p ? p.avg : null)}</td>
                        </tr>
                      );
                    })
                  )
                )}
              </tbody>
            </table>
          </div>

          <div className="wqm-table-footer">
            <span>
              {filtered.length} station{filtered.length !== 1 ? 's' : ''} &middot; {params.length} parameters &middot; CY 2026
            </span>
          </div>
        </div>
      )}
    </div>
  );
};

export default WQM2026;
