import { lazy, Suspense } from 'react';
import { Link } from 'react-router-dom';
import embLogo from '../assets/emblogo.svg';
import bgEmb from '../assets/bgemb.webp';
import { useTheme } from '../context/ThemeContext';
import {
  IcoAlertTriangle,
  IcoBuilding,
  IcoCalendar,
  IcoCheckCircle,
  IcoDashboard,
  IcoEye,
  IcoLayers,
  IcoMapPin,
  IcoMoon,
  IcoSun,
  IcoTable,
  IcoTrendUp,
  IcoWater,
} from '../components/Icons';
import './Welcome.css';

const CesiumStationMap = lazy(() => import('../components/CesiumStationMap'));

const talaveraStations = [
  {
    id: 'TLV_3',
    station: 'Up-stream',
    waterbodyName: 'Talavera River',
    waterbodyRiver: 'Talavera River',
    barangay: 'Capintalan',
    province: 'Nueva Ecija',
    lat: 16.104289899009,
    lng: 120.925294789861,
    markerColor: '#7CB675',
    stationData: {
      stnNo: 1,
      stnId: 'Up-stream',
      address: 'Capintalan, Carranglan, Nueva Ecija',
      params: {
        'DO (mg/L)': { avg: 7.11 },
        'BOD (mg/L)': { avg: 1 },
        'TSS (mg/L)': { avg: 3 },
        pH: { avg: 7.03 },
        'Fecal Coliform (MPN/100mL)': { avg: 3500 },
      },
    },
  },
  {
    id: 'TLV_2',
    station: 'Mid-stream',
    waterbodyName: 'Talavera River',
    waterbodyRiver: 'Talavera River',
    barangay: 'Manicla',
    province: 'Nueva Ecija',
    lat: 15.8274294236095,
    lng: 121.036631420061,
    markerColor: '#446ACB',
    stationData: {
      stnNo: 2,
      stnId: 'Mid-stream',
      address: 'Tayabo, San Jose, Nueva Ecija',
      params: {
        'DO (mg/L)': { avg: 6.99 },
        'BOD (mg/L)': { avg: 3 },
        'TSS (mg/L)': { avg: 6 },
        pH: { avg: 7.38 },
        'Fecal Coliform (MPN/100mL)': { avg: 23000 },
      },
    },
  },
  {
    id: 'TLV_1',
    station: 'Down-stream',
    waterbodyName: 'Talavera River',
    waterbodyRiver: 'Talavera River',
    barangay: 'Esguerra District',
    province: 'Nueva Ecija',
    lat: 15.587541681514,
    lng: 120.912047614979,
    markerColor: '#f59e0b',
    stationData: {
      stnNo: 3,
      stnId: 'Down-stream',
      address: 'Pag-asa, Talavera, Nueva Ecija',
      params: {
        'DO (mg/L)': { avg: 6.73 },
        'BOD (mg/L)': { avg: 4 },
        'TSS (mg/L)': { avg: 24 },
        pH: { avg: 7.41 },
        'Fecal Coliform (MPN/100mL)': { avg: 7900 },
      },
    },
  },
];

const heroCards = [
  { value: '3D', label: 'Cesium map preview', renderIcon: (props) => <IcoLayers {...props} /> },
  { value: 'AI', label: 'Forecast assistant', renderIcon: (props) => <IcoTrendUp {...props} /> },
  { value: 'R-III', label: 'Regional waterbodies', renderIcon: (props) => <IcoMapPin {...props} /> },
];

const features = [
  {
    title: 'Operational Dashboard',
    text: 'Waterbody summaries, station gauges, trend lines, compliance signals, and observation review in one monitoring surface.',
    renderIcon: (props) => <IcoDashboard {...props} />,
  },
  {
    title: 'Cesium 3D Waterbody Map',
    text: 'Station markers, map layers, terrain controls, labels, and waterbody focus tools for geospatial validation.',
    renderIcon: (props) => <IcoWater {...props} />,
  },
  {
    title: 'Workbook Aligned Records',
    text: 'Published WQMS datasets stay structured for station-level review, tabular monitoring, and audit-ready reporting.',
    renderIcon: (props) => <IcoTable {...props} />,
  },
  {
    title: 'AI Forecast Assistant',
    text: 'AI-assisted projections compare local baseline forecasts with current encoded readings for technical review.',
    renderIcon: (props) => <IcoAlertTriangle {...props} />,
  },
];

const uses = [
  'Regional waterbody status tracking',
  'Station-based monitoring review',
  'Published dataset visualization',
  'Compliance and technical reporting support',
];

const aiUses = [
  'Summarizes station trends and latest encoded readings',
  'Generates AI-adjusted forecast points from the local baseline',
  'Highlights confidence, direction, and parameter movement',
  'Supports technical review without replacing reviewer judgment',
];

const dashboardMetrics = [
  ['Stations', '3', '#446ACB'],
  ['Avg DO', '6.94', '#7CB675'],
  ['Fecal watch', '2', '#f59e0b'],
];

const menuCards = [
  {
    title: '3D Waterbody Map',
    label: 'Map menu preview',
    renderIcon: (props) => <IcoLayers {...props} />,
    rows: ['Waterbody selector', 'Layer tools', 'Terrain and labels', 'Station details'],
  },
  {
    title: 'AI Forecast',
    label: 'Forecast menu preview',
    renderIcon: (props) => <IcoTrendUp {...props} />,
    rows: ['Parameter selector', 'Observed baseline', 'AI adjusted points', 'Technical analysis'],
  },
];

const AIAssistantLogo = () => (
  <div className="welcome-ai-logo" aria-hidden="true">
    <span className="ai-logo-core">AI</span>
    <span className="ai-logo-orbit orbit-one" />
    <span className="ai-logo-orbit orbit-two" />
    <span className="ai-logo-dot dot-one" />
    <span className="ai-logo-dot dot-two" />
  </div>
);

const Welcome = () => {
  const { theme, toggle } = useTheme();
  const isDark = theme === 'dark';

  return (
    <main className="welcome-page">
      <section
        className="welcome-hero"
        style={{ '--welcome-bg': `url(${bgEmb})` }}
        aria-labelledby="welcome-title"
      >
        <header className="welcome-nav" aria-label="Landing page navigation">
          <a className="welcome-brand" href="https://r3.emb.gov.ph" target="_blank" rel="noreferrer">
            <img src={embLogo} alt="Environmental Management Bureau Region III" />
            <span>
              <strong>EMB Region III</strong>
              <small>Water Quality Monitoring System</small>
            </span>
          </a>

          <nav className="welcome-nav-links" aria-label="Page sections">
            <a href="#features">Features</a>
            <a href="#map-preview">3D Map</a>
            <a href="#ai-assistant">AI Assistant</a>
            <a href="#menus">Menus</a>
          </nav>

          <div className="welcome-nav-actions">
            <button className="welcome-theme-toggle" type="button" onClick={toggle} aria-label="Toggle light and dark theme">
              {isDark ? <IcoSun size={18} /> : <IcoMoon size={18} />}
              <span>{isDark ? 'Light' : 'Dark'}</span>
            </button>
            <Link className="welcome-login-btn" to="/login">
              <IcoCheckCircle size={18} />
              <span>Login</span>
            </Link>
          </div>
        </header>

        <div className="welcome-hero-grid">
          <div className="welcome-hero-copy">
            <p className="welcome-eyebrow">Environmental Management Bureau - Region III</p>
            <h1 id="welcome-title">Water Quality Monitoring System</h1>
            <p className="welcome-lead">
              A corporate monitoring platform for waterbody stations, parameter readings, AI-assisted forecasts, and 3D geospatial review across Central Luzon.
            </p>
            <div className="welcome-actions">
              <Link className="welcome-primary-action" to="/login">Access System</Link>
              <a className="welcome-secondary-action" href="#map-preview">View Talavera Preview</a>
            </div>
          </div>

          <div className="welcome-visual" aria-label="Dashboard desktop and tablet mockup">
            <div className="welcome-device welcome-desktop-screen">
              <div className="welcome-screen-bar">
                <span />
                <span />
                <span />
                <strong>Dashboard</strong>
              </div>
              <div className="welcome-screen-layout">
                <div className="welcome-screen-sidebar">
                  <span className="active"><IcoDashboard size={14} /> Dashboard</span>
                  <span><IcoLayers size={14} /> 3D Map</span>
                  <span><IcoTrendUp size={14} /> AI Forecast</span>
                </div>
                <div className="welcome-screen-main">
                  <div className="welcome-dashboard-head">
                    <span>Talavera River</span>
                    <strong>Class C Monitoring</strong>
                  </div>
                  <div className="welcome-screen-metrics">
                    {dashboardMetrics.map(([label, value, color]) => (
                      <span key={label} style={{ '--metric-color': color }}>
                        <small>{label}</small>
                        <strong>{value}</strong>
                      </span>
                    ))}
                  </div>
                  <div className="welcome-screen-chart">
                    <span className="bar b1" />
                    <span className="bar b2" />
                    <span className="bar b3" />
                    <span className="bar b4" />
                    <span className="bar b5" />
                    <span className="chart-line" />
                  </div>
                  <div className="welcome-screen-table">
                    <span />
                    <span />
                    <span />
                  </div>
                </div>
              </div>
            </div>

            <div className="welcome-device welcome-tablet-screen">
              <div className="welcome-tablet-map">
                <span className="welcome-map-pin pin-a" />
                <span className="welcome-map-pin pin-b" />
                <span className="welcome-map-pin pin-c" />
                <span className="welcome-water-line line-a" />
                <span className="welcome-water-line line-b" />
              </div>
              <div className="welcome-tablet-copy">
                <strong>Tablet Map Mode</strong>
                <span>Station layers and waterbody focus</span>
              </div>
            </div>
          </div>
        </div>

        <div className="welcome-hero-cards" aria-label="System highlights">
          {heroCards.map(({ value, label, renderIcon }) => (
            <article className="welcome-hero-card" key={label}>
              {renderIcon({ size: 22 })}
              <strong>{value}</strong>
              <span>{label}</span>
            </article>
          ))}
        </div>
      </section>

      <section className="welcome-section welcome-features" id="features" aria-labelledby="features-title">
        <div className="welcome-section-head">
          <p>Functions and Features</p>
          <h2 id="features-title">Built for EMB Region III monitoring workflows</h2>
        </div>
        <div className="welcome-feature-grid">
          {features.map(({ title, text, renderIcon }) => (
            <article className="welcome-feature-card" key={title}>
              <span className="welcome-feature-icon">{renderIcon({ size: 22 })}</span>
              <h3>{title}</h3>
              <p>{text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="welcome-section welcome-map-preview" id="map-preview" aria-labelledby="map-title">
        <div className="welcome-section-head">
          <p>Cesium 3D Map Preview</p>
          <h2 id="map-title">Talavera River plotted with station markers</h2>
        </div>
        <div className="welcome-map-grid">
          <div className="welcome-cesium-frame">
            <Suspense fallback={<div className="welcome-map-loading">Loading Talavera 3D map preview...</div>}>
              <CesiumStationMap
                locations={talaveraStations}
                waterbodyName="Talavera River"
                height={460}
                birdseye
                showStationLabels
                defaultTerrainEnabled={false}
                defaultBuildingsEnabled={false}
                emptyMessage="Talavera station preview is not available."
              />
            </Suspense>
          </div>
          <div className="welcome-station-panel">
            {talaveraStations.map((station) => (
              <article key={station.id}>
                <span style={{ '--station-color': station.markerColor }} />
                <div>
                  <strong>{station.station}</strong>
                  <small>{station.stationData.address}</small>
                </div>
                <em>DO {station.stationData.params['DO (mg/L)'].avg}</em>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="welcome-section welcome-ai-section" id="ai-assistant" aria-labelledby="ai-title">
        <div className="welcome-ai-card">
          <AIAssistantLogo />
          <div className="welcome-ai-copy">
            <p>AI Assistant</p>
            <h2 id="ai-title">WQMS Forecast Intelligence</h2>
            <span>
              The app uses an AI forecast assistant to help reviewers interpret current station readings, compare forecast baselines, and generate concise technical analysis for selected waterbodies and parameters.
            </span>
          </div>
        </div>
        <div className="welcome-ai-uses">
          {aiUses.map((item) => (
            <span key={item}>
              <IcoCheckCircle size={18} />
              {item}
            </span>
          ))}
        </div>
      </section>

      <section className="welcome-section welcome-menu-preview" id="menus" aria-labelledby="menus-title">
        <div className="welcome-section-head">
          <p>Menu Preview</p>
          <h2 id="menus-title">3D waterbody map and AI forecast menus</h2>
        </div>
        <div className="welcome-menu-grid">
          {menuCards.map(({ title, label, renderIcon, rows }) => (
            <article className="welcome-menu-card" key={title}>
              <header>
                <span>{renderIcon({ size: 22 })}</span>
                <div>
                  <small>{label}</small>
                  <strong>{title}</strong>
                </div>
              </header>
              <div className="welcome-menu-screen">
                {rows.map((row, index) => (
                  <span key={row} className={index === 0 ? 'selected' : ''}>
                    <IcoCheckCircle size={14} />
                    {row}
                  </span>
                ))}
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="welcome-section welcome-uses" aria-labelledby="uses-title">
        <div className="welcome-uses-copy">
          <p>Primary Uses</p>
          <h2 id="uses-title">A single entry point for water quality review</h2>
        </div>
        <div className="welcome-use-list">
          {uses.map((item) => (
            <span key={item}>
              <IcoCheckCircle size={18} />
              {item}
            </span>
          ))}
        </div>
      </section>

      <footer className="welcome-footer">
        <div className="welcome-footer-brand">
          <img src={embLogo} alt="" aria-hidden="true" />
          <div>
            <strong>Environmental Management Bureau - Region III</strong>
            <span>Water Quality Monitoring System</span>
          </div>
        </div>
        <address className="welcome-footer-details">
          <a href="https://r3.emb.gov.ph" target="_blank" rel="noreferrer">Website: r3.emb.gov.ph</a>
          <a href="https://www.facebook.com/EMB3Official" target="_blank" rel="noreferrer">Facebook: EMB3Official</a>
          <span><IcoBuilding size={16} /> Masinop corner Matalino Street, Diosdado Macapagal Government Center, Maimpis, San Fernando City, Pampanga</span>
        </address>
        <div className="welcome-footer-mark">
          <IcoCalendar size={18} />
          <span>EMB R3 WQMS</span>
        </div>
      </footer>
    </main>
  );
};

export default Welcome;
