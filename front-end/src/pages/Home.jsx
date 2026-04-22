import { useState, useRef, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Cell,
} from 'recharts';
import bagongLogo from '../assets/bagongpilipinaslogo.png';
import embLogo from '../assets/emblogo.svg';
import wqmData from '../data/wqm2026.json';
import WQM2026 from './WQM2026';
import Settings from './Settings';
import WaterbodyProfile from './WaterbodyProfile';
import {
  IcoDashboard, IcoTable, IcoWater, IcoSettings,
  IcoChevronDown, IcoChevronRight, IcoCalendar,
  IcoSun, IcoMoon, IcoLogout,
} from '../components/Icons';
import './Home.css';

/* ── Constants ── */
const CHART_PARAMS = [
  'DO (mg/L)', 'BOD (mg/L)', 'TSS (mg/L)', 'pH',
  'Temp. (°C)', 'Color (TCU)', 'Fecal Coliform (MPN/100mL)',
  'NO3-N (mg/L)', 'PO4-P (mg/L)', 'Cl- (mg/L)', 'Oil and Grease',
];

const CHART_COLORS = [
  '#446ACB','#7CB675','#e07b54','#a78bfa','#f59e0b',
  '#06b6d4','#ec4899','#84cc16','#f97316','#64748b','#10b981',
];

const WATERBODIES = Object.entries(wqmData).map(([key, val]) => ({
  key,
  name: val.name ? toTitle(val.name) : toTitle(key),
  classInfo: val.classInfo || '',
  stationCount: (val.stations || []).length,
}));

const toTitle = (str) =>
  str.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

/* Abbreviate long waterbody names for chart X-axis */
const abbrev = (name, maxLen = 10) =>
  name.length <= maxLen ? name : name.split(' ').map((w) => w[0]).join('');

/* Build chart data: each sheet → average of all stations for a param */
const buildChartData = (param) =>
  Object.entries(wqmData).map(([key, sheet]) => {
    const vals = (sheet.stations || [])
      .map((s) => {
        const p = s.params[param] || s.params['Temp. (OC)' ] ;
        if (!p) return null;
        return typeof p.avg === 'number' ? p.avg : null;
      })
      .filter((v) => v !== null);
    return {
      name: abbrev(sheet.name ? toTitle(sheet.name) : toTitle(key)),
      fullName: sheet.name ? toTitle(sheet.name) : toTitle(key),
      value: vals.length ? parseFloat((vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2)) : null,
    };
  }).filter((d) => d.value !== null);

/* Custom tooltip */
const ChartTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tooltip">
      <p className="ct-name">{payload[0]?.payload?.fullName || label}</p>
      <p className="ct-val">{payload[0]?.value} <span>{payload[0]?.name}</span></p>
    </div>
  );
};

/* ── Dashboard overview ── */
const DashboardView = ({ user }) => {
  const [chartParam, setChartParam] = useState(CHART_PARAMS[0]);
  const { theme } = useTheme();
  const chartData = useMemo(() => buildChartData(chartParam), [chartParam]);
  const paramIdx = CHART_PARAMS.indexOf(chartParam);
  const barColor = CHART_COLORS[paramIdx] || '#446ACB';
  const gridColor = theme === 'dark' ? '#2d4a6a' : '#E2E8F6';
  const textColor = theme === 'dark' ? '#94a3b8' : '#64748b';

  return (
  <div className="dashboard-overview">
    <div className="overview-hero">
      <div>
        <p className="overview-eyebrow">Water Quality Monitoring System</p>
        <h2 className="overview-title">Welcome, <span>{user?.name}</span></h2>
        <p className="overview-sub">Environmental Management Bureau &middot; Region III &middot; Central Luzon</p>
      </div>
      <div className="overview-stat-row">
        <div className="ov-stat"><strong>{WATERBODIES.length}</strong><span>Waterbodies</span></div>
        <div className="ov-stat-div" />
        <div className="ov-stat"><strong>3</strong><span>Years</span></div>
        <div className="ov-stat-div" />
        <div className="ov-stat"><strong>11</strong><span>Parameters</span></div>
      </div>
    </div>

    {/* ── Parameter Summary Chart ── */}
    <div className="chart-card">
      <div className="chart-card-header">
        <div>
          <h3 className="chart-title">Parameter Summary — All Waterbodies</h3>
          <p className="chart-sub">Average value across monitoring stations per waterbody · CY 2026</p>
        </div>
        <select
          className="chart-param-sel"
          value={chartParam}
          onChange={(e) => setChartParam(e.target.value)}
        >
          {CHART_PARAMS.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
      </div>
      <div className="chart-wrap">
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 60 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
            <XAxis
              dataKey="name"
              tick={{ fontSize: 9.5, fill: textColor }}
              angle={-45}
              textAnchor="end"
              interval={0}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              tick={{ fontSize: 10, fill: textColor }}
              tickLine={false}
              axisLine={false}
              width={42}
            />
            <Tooltip content={<ChartTooltip />} cursor={{ fill: theme === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(68,106,203,0.07)' }} />
            <Bar dataKey="value" name={chartParam} radius={[4, 4, 0, 0]}>
              {chartData.map((_, i) => (
                <Cell key={i} fill={barColor} fillOpacity={0.75 + (i % 3) * 0.08} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>

    <div className="overview-guide-card">
      <h3 className="guide-card-title">Quick Guide</h3>
      <div className="guide-steps">
        <div className="guide-step">
          <span className="step-num">01</span>
          <div>
            <strong>Browse Waterbodies</strong>
            <p>Select a waterbody from the sidebar to view its monitoring profile and historical trend.</p>
          </div>
        </div>
        <div className="guide-step">
          <span className="step-num">02</span>
          <div>
            <strong>View Tabular Results</strong>
            <p>Access structured monthly data by year via Tabular Results &rarr; 2026.</p>
          </div>
        </div>
        <div className="guide-step">
          <span className="step-num">03</span>
          <div>
            <strong>Export Data</strong>
            <p>Download station data as CSV for offline analysis and reporting.</p>
          </div>
        </div>
        <div className="guide-step">
          <span className="step-num">04</span>
          <div>
            <strong>Manage System</strong>
            <p>Administrators can manage user accounts and system settings.</p>
          </div>
        </div>
      </div>
    </div>
  </div>
  );
};

/* ── Year placeholder ── */
const YearPlaceholder = ({ year }) => (
  <div className="wqm-placeholder">
    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" style={{ color: 'var(--text-secondary)', marginBottom: '1rem', opacity: 0.4 }}>
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
    </svg>
    <h3>No Data Available &mdash; {year}</h3>
    <p>Water quality data for CY {year} has not been uploaded yet.</p>
  </div>
);

/* ── Main Home layout ── */
const Home = () => {
  const { user, logout } = useAuth();
  const { theme, toggle: toggleTheme } = useTheme();
  const navigate = useNavigate();
  const userMenuRef = useRef(null);

  const [activeView, setActiveView] = useState('dashboard');
  const [tabularOpen, setTabularOpen] = useState(false);
  const [waterbodiesOpen, setWaterbodiesOpen] = useState(false);
  const [activeWaterbody, setActiveWaterbody] = useState(null);
  const [showUserMenu, setShowUserMenu] = useState(false);

  useEffect(() => {
    const handler = (e) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target)) {
        setShowUserMenu(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const nav = (view) => {
    setActiveView(view);
    if (!view.startsWith('tabular')) setTabularOpen(false);
  };

  const navWaterbody = (key) => {
    setActiveWaterbody(key);
    setActiveView('waterbody');
  };

  const handleLogout = () => { logout(); navigate('/login'); };

  const pageTitle = {
    dashboard:      'Dashboard',
    'tabular-2026': 'Tabular Results — 2026',
    'tabular-2025': 'Tabular Results — 2025',
    'tabular-2024': 'Tabular Results — 2024',
    settings:       'Settings',
    waterbody:      WATERBODIES.find((w) => w.key === activeWaterbody)?.name || 'Waterbody Profile',
  }[activeView] || 'Dashboard';

  return (
    <div className="dashboard">
      {/* ── Sidebar ── */}
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="sidebar-logos">
            <img src={bagongLogo} alt="Bagong Pilipinas" className="logo-bagong" />
            <div className="sidebar-logo-divider" />
            <img src={embLogo} alt="EMB" className="logo-emb" />
          </div>
          <div className="sidebar-brand-text">
            <span className="sidebar-brand-name">Environmental Management Bureau</span>
            <span className="sidebar-brand-sub">Region III</span>
          </div>
        </div>

        <nav className="sidebar-nav">
          <p className="nav-section-label">Main</p>

          <button
            className={`nav-item${activeView === 'dashboard' ? ' active' : ''}`}
            onClick={() => nav('dashboard')}
          >
            <IcoDashboard size={15} />
            <span className="nav-label">Dashboard</span>
          </button>

          <p className="nav-section-label">Monitoring</p>

          <button
            className={`nav-item nav-group-toggle${waterbodiesOpen ? ' open' : ''}`}
            onClick={() => setWaterbodiesOpen((o) => !o)}
          >
            <IcoWater size={15} />
            <span className="nav-label">Waterbodies</span>
            <span className="nav-chevron-icon">
              {waterbodiesOpen ? <IcoChevronDown size={12} /> : <IcoChevronRight size={12} />}
            </span>
          </button>

          {waterbodiesOpen && (
            <div className="nav-sub-group nav-wb-group">
              {WATERBODIES.map((wb) => (
                <button
                  key={wb.key}
                  className={`nav-item nav-sub-item${activeView === 'waterbody' && activeWaterbody === wb.key ? ' active' : ''}`}
                  onClick={() => navWaterbody(wb.key)}
                >
                  <span className="nav-wb-dot" />
                  <span className="nav-label">{wb.name}</span>
                </button>
              ))}
            </div>
          )}

          <p className="nav-section-label">Data</p>

          <button
            className={`nav-item nav-group-toggle${tabularOpen || activeView.startsWith('tabular') ? ' open' : ''}`}
            onClick={() => setTabularOpen((o) => !o)}
          >
            <IcoTable size={15} />
            <span className="nav-label">Tabular Results</span>
            <span className="nav-chevron-icon">
              {tabularOpen ? <IcoChevronDown size={12} /> : <IcoChevronRight size={12} />}
            </span>
          </button>

          {tabularOpen && (
            <div className="nav-sub-group">
              {[2026, 2025, 2024].map((yr) => (
                <button
                  key={yr}
                  className={`nav-item nav-sub-item${activeView === `tabular-${yr}` ? ' active' : ''}`}
                  onClick={() => nav(`tabular-${yr}`)}
                >
                  <IcoCalendar size={12} />
                  <span className="nav-label">{yr}</span>
                </button>
              ))}
            </div>
          )}

          {user?.role === 'admin' && (
            <>
              <p className="nav-section-label">System</p>
              <button
                className={`nav-item${activeView === 'settings' ? ' active' : ''}`}
                onClick={() => nav('settings')}
              >
                <IcoSettings size={15} />
                <span className="nav-label">Settings</span>
                <span className="nav-badge-admin">admin</span>
              </button>
            </>
          )}
        </nav>

        <div
          className="theme-toggle-sidebar"
          onClick={toggleTheme}
          role="button"
          tabIndex={0}
          title="Toggle theme"
        >
          {theme === 'light' ? <IcoSun size={14} /> : <IcoMoon size={14} />}
          <span className="nav-label">{theme === 'light' ? 'Light Mode' : 'Dark Mode'}</span>
          <span className={`tts-track${theme === 'dark' ? ' on' : ''}`}>
            <span className="tts-knob" />
          </span>
        </div>
      </aside>

      {/* ── Main content ── */}
      <main className="main-content">
        <header className="topbar">
          <div className="topbar-left">
            <h2 className="page-title">{pageTitle}</h2>
            <p className="page-subtitle">EMBR3 Water Quality Monitoring System &middot; Region III</p>
          </div>
          <div className="topbar-right">
            <div className="last-updated">
              <span className="pulse-dot" />
              EMBR3-WQMS
            </div>
            <div className="user-menu-wrap" ref={userMenuRef}>
              <button
                className="avatar"
                onClick={() => setShowUserMenu((v) => !v)}
                title={user?.name}
              >
                {user?.name?.charAt(0).toUpperCase()}
              </button>
              {showUserMenu && (
                <div className="user-dropdown">
                  <div className="ud-header">
                    <span className="ud-avatar-lg">{user?.name?.charAt(0).toUpperCase()}</span>
                    <div className="ud-info">
                      <p className="ud-name">{user?.name}</p>
                      <p className="ud-email">{user?.email}</p>
                      <span className="ud-role-badge">{user?.role}</span>
                    </div>
                  </div>
                  <div className="ud-divider" />
                  <button className="ud-item ud-logout" onClick={handleLogout}>
                    <IcoLogout size={14} />
                    Sign Out
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        <div className="content-area">
          {activeView === 'dashboard'    && <DashboardView user={user} />}
          {activeView === 'tabular-2026' && <WQM2026 />}
          {activeView === 'tabular-2025' && <YearPlaceholder year={2025} />}
          {activeView === 'tabular-2024' && <YearPlaceholder year={2024} />}
          {activeView === 'settings'     && <Settings />}
          {activeView === 'waterbody'    && activeWaterbody && (
            <WaterbodyProfile waterbodyKey={activeWaterbody} />
          )}
        </div>
      </main>
    </div>
  );
};

export default Home;