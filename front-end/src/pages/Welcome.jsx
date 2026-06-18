import { lazy, Suspense, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import embLogo from '../assets/emblogo.svg';
import bgEmb from '../assets/bgemb.webp';
import { useTheme } from '../context/ThemeContext';
import {
  IcoAlertTriangle,
  IcoArrowUp,
  IcoBuilding,
  IcoCalendar,
  IcoCheckCircle,
  IcoClose,
  IcoDashboard,
  IcoEye,
  IcoGlobe,
  IcoLayers,
  IcoMail,
  IcoMapPin,
  IcoMenu,
  IcoMoon,
  IcoPhone,
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
  { value: '3-Dimensional', label: 'Cesium map preview', renderIcon: (props) => <IcoLayers {...props} /> },
  { value: 'Artificial Intelligence', label: 'Forecast assistant', renderIcon: (props) => <IcoTrendUp {...props} /> },
  { value: 'Central Luzon', label: 'all waterbodies', renderIcon: (props) => <IcoMapPin {...props} /> },
];

// Talavera coordinates are reused only as an unnamed sample preview.
const SAMPLE_WATERBODY_NAME = 'Sample Waterbody';
const sampleStations = talaveraStations.map((station) => ({
  ...station,
  waterbodyName: SAMPLE_WATERBODY_NAME,
  waterbodyRiver: SAMPLE_WATERBODY_NAME,
}));

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

const EMB_CONTACTS = [
  {
    icon: (props) => <IcoGlobe {...props} />,
    label: 'Website',
    value: 'r3.emb.gov.ph',
    href: 'https://r3.emb.gov.ph',
  },
  {
    icon: (props) => <IcoMail {...props} />,
    label: 'Email',
    value: 'emb.region3@emb.gov.ph',
    href: 'mailto:emb.region3@emb.gov.ph',
  },
  {
    icon: (props) => <IcoPhone {...props} />,
    label: 'Telephone',
    value: '(045) 455 5391',
    href: 'tel:+63454555391',
  },
  {
    icon: (props) => <IcoBuilding {...props} />,
    label: 'Office',
    value:
      'Masinop cor. Matalino St., Diosdado Macapagal Government Center, Maimpis, City of San Fernando, Pampanga',
  },
];

const ContactsModal = ({ open, onClose }) => {
  useEffect(() => {
    if (!open) return undefined;
    const handleKey = (event) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="welcome-modal-backdrop"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="welcome-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="welcome-contacts-title"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          className="welcome-modal-close"
          onClick={onClose}
          aria-label="Close contact information"
        >
          <IcoClose size={18} />
        </button>
        <div className="welcome-modal-head">
          <img src={embLogo} alt="" aria-hidden="true" />
          <div>
            <p className="welcome-modal-eyebrow">Restricted System Access</p>
            <h3 id="welcome-contacts-title">Account Required</h3>
          </div>
        </div>
        <p className="welcome-modal-lead">
          The Water Quality Monitoring System is an internal EMB Region III
          platform. Login is reserved for authorized personnel. For account
          requests, system inquiries, or water quality data, please contact EMB
          Region III through the details below.
        </p>
        <ul className="welcome-modal-contacts">
          {EMB_CONTACTS.map(({ icon, label, value, href }) => (
            <li key={label}>
              <span className="welcome-modal-contact-icon">{icon({ size: 18 })}</span>
              <div>
                <small>{label}</small>
                {href ? (
                  <a href={href} target="_blank" rel="noreferrer">
                    {value}
                  </a>
                ) : (
                  <span>{value}</span>
                )}
              </div>
            </li>
          ))}
        </ul>
        <div className="welcome-modal-actions">
          <Link to="/public-dashboard" className="welcome-primary-action">
            Open Public Dashboard
          </Link>
          <button
            type="button"
            className="welcome-secondary-action"
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

const Welcome = () => {
  const { theme, toggle } = useTheme();
  const isDark = theme === 'dark';
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [contactsOpen, setContactsOpen] = useState(false);

  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => entries.forEach((entry) => {
        if (entry.isIntersecting) entry.target.classList.add('is-visible');
      }),
      { threshold: 0.12 },
    );
    document.querySelectorAll('.welcome-animate').forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    const onScroll = () => setShowScrollTop(window.scrollY > 480);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const closeMobileNav = () => setMobileNavOpen(false);
  const scrollToTop = () =>
    window.scrollTo({ top: 0, behavior: 'smooth' });

  return (
    <main className="welcome-page">
      <ContactsModal open={contactsOpen} onClose={() => setContactsOpen(false)} />
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
            <Link to="/public-dashboard" className="welcome-nav-publink">Public Dashboard</Link>
          </nav>

          <div className="welcome-nav-actions">
            <button className="welcome-theme-toggle" type="button" onClick={toggle} aria-label="Toggle light and dark theme">
              {isDark ? <IcoSun size={18} /> : <IcoMoon size={18} />}
              <span>{isDark ? 'Light' : 'Dark'}</span>
            </button>
            <button className="welcome-login-btn" type="button" onClick={() => setContactsOpen(true)}>
              <IcoCheckCircle size={18} />
              <span>Login</span>
            </button>
            <button
              className="welcome-burger"
              type="button"
              onClick={() => setMobileNavOpen((open) => !open)}
              aria-label={mobileNavOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={mobileNavOpen}
            >
              {mobileNavOpen ? <IcoClose size={22} /> : <IcoMenu size={22} />}
            </button>
          </div>
        </header>

        {mobileNavOpen && (
          <div className="welcome-mobile-nav" role="dialog" aria-label="Mobile navigation">
            <a href="#features" onClick={closeMobileNav}>Features</a>
            <a href="#map-preview" onClick={closeMobileNav}>3D Map</a>
            <a href="#ai-assistant" onClick={closeMobileNav}>AI Assistant</a>
            <a href="#menus" onClick={closeMobileNav}>Menus</a>
            <Link to="/public-dashboard" className="welcome-mobile-publink" onClick={closeMobileNav}>
              Public Dashboard
            </Link>
            <button
              type="button"
              className="welcome-mobile-login"
              onClick={() => {
                closeMobileNav();
                setContactsOpen(true);
              }}
            >
              <IcoCheckCircle size={18} />
              <span>Staff Login</span>
            </button>
          </div>
        )}

        <div className="welcome-hero-grid">
          <div className="welcome-hero-copy">
            <p className="welcome-eyebrow">Environmental Management Bureau - Region III</p>
            <h1 id="welcome-title">Water Quality Monitoring System</h1>
            <p className="welcome-lead">
              A corporate monitoring platform for waterbody stations, parameter readings, AI-assisted forecasts, and 3D geospatial review across Central Luzon.
            </p>
            <div className="welcome-actions">
              <button className="welcome-primary-action" type="button" onClick={() => setContactsOpen(true)}>Access System</button>
              <a className="welcome-secondary-action" href="#map-preview">View Sample Preview</a>
            </div>
          </div>

          <div className="welcome-visual" aria-label="3D map and dashboard mockup">
            {/* Bigger screen — Cesium 3D Map */}
            <div className="welcome-device welcome-desktop-screen" aria-label="Sample waterbody 3D aerial map">
              <div className="welcome-screen-bar">
                <span />
                <span />
                <span />
                <strong>3D Station Map — Sample Waterbody</strong>
              </div>
              <div className="welcome-hero-map-frame welcome-hero-map-full">
                <Suspense fallback={<div className="welcome-map-loading">Loading 3D map preview...</div>}>
                  <CesiumStationMap
                    locations={sampleStations}
                    waterbodyName={SAMPLE_WATERBODY_NAME}
                    height={355}
                    birdseye
                    showStationLabels={false}
                    emptyMessage="Sample waterbody preview is not available."
                  />
                </Suspense>
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
        <div className="welcome-water-waves" aria-hidden="true">
          <svg className="welcome-wave welcome-wave-a" viewBox="0 0 1200 80" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M0,40 C150,80 350,0 600,40 C850,80 1050,0 1200,40 L1200,80 L0,80 Z" />
          </svg>
          <svg className="welcome-wave welcome-wave-b" viewBox="0 0 1200 80" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M0,20 C200,60 400,0 600,30 C800,60 1000,0 1200,20 L1200,80 L0,80 Z" />
          </svg>
          <svg className="welcome-wave welcome-wave-c" viewBox="0 0 1200 80" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M0,55 C200,20 500,70 700,40 C900,15 1100,60 1200,55 L1200,80 L0,80 Z" />
          </svg>
        </div>
      </section>

      <section className="welcome-section welcome-features" id="features" aria-labelledby="features-title">
        <div className="welcome-section-head">
          <p>Functions and Features</p>
          <h2 id="features-title">Built for EMB Region III monitoring workflows</h2>
        </div>
        <div className="welcome-feature-grid">
          {features.map(({ title, text, renderIcon }) => (
            <article className="welcome-feature-card welcome-animate" key={title}>
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
          <h2 id="map-title">Sample waterbody plotted with station markers</h2>
        </div>
        <div className="welcome-map-grid">
          <div className="welcome-map-note">
            <span className="welcome-map-note-icon"><IcoLayers size={22} /></span>
            <h3>Sample waterbody preview</h3>
            <p>The interactive 3D aerial map is shown on the device in the hero section above, with an inclined terrain view, station markers, layer tools, and station detail cards.</p>
            <button className="welcome-secondary-action welcome-map-note-action" type="button" onClick={() => setContactsOpen(true)}>Request Full Access</button>
          </div>
          <div className="welcome-station-panel">
            {sampleStations.map((station) => (
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
            <span key={item} className="welcome-animate">
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
            <article className="welcome-menu-card welcome-animate" key={title}>
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
            <span key={item} className="welcome-animate">
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

      <button
        type="button"
        className={`welcome-scroll-top${showScrollTop ? ' is-visible' : ''}`}
        onClick={scrollToTop}
        aria-label="Scroll back to top"
      >
        <IcoArrowUp size={20} />
      </button>
    </main>
  );
};

export default Welcome;
