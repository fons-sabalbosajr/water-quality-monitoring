// "Meet VERA" landing-page section — same structure, identity and motion as the
// VERA section on the EMB ESWMP landing page, with WQMS-specific capabilities.
//
// Motion (anime.js): idle loops (floating avatar, counter-rotating rings,
// blinking accent grid) plus a one-shot entrance when the section scrolls into
// view. Content is visible by default, so nothing stays hidden if the observer
// never fires, and everything is skipped under prefers-reduced-motion.

import { useEffect, useRef } from 'react';
import { animate, stagger, utils } from 'animejs';
import VeraFlameIcon from './VeraFlameIcon';
import './VeraLandingSection.css';

const FEATURES = [
  {
    title: 'Answers from the Data',
    desc: 'Ask in plain language for readings, rankings and exceedances — every figure is computed from the stored monitoring records, never guessed.',
    icon: <><path d="M12 2a2 2 0 0 1 2 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 0 1 7 7h1a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-1a7 7 0 0 1-7 7h-4a7 7 0 0 1-7-7H2a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1h1a7 7 0 0 1 7-7h1V5.73c-.6-.34-1-.99-1-1.73a2 2 0 0 1 2-2z" /><circle cx="8.5" cy="14.5" r="1.5" /><circle cx="15.5" cy="14.5" r="1.5" /></>,
  },
  {
    title: 'Station Forecasts',
    desc: 'Projects any parameter at any station for the coming months, with a likely range and confidence — the same engine and horizon as the dashboards.',
    icon: <><path d="M3 3v18h18" /><path d="M18.7 8l-5.1 5.2-2.8-2.7L7 14.3" /></>,
  },
  {
    title: 'Guideline Checks',
    desc: 'Flags readings outside the water quality guidelines and shows which waterbodies and stations fail most often.',
    icon: <><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></>,
  },
  {
    title: 'Multi-Year Trends',
    desc: 'Compares 2024, 2025 and 2026 for the same waterbody or station to show whether water quality is improving.',
    icon: <><polyline points="22 12 18 12 15 21 9 3 6 12 2 12" /></>,
  },
  {
    title: 'Confirm-before-Save Edits',
    desc: 'Administrators can correct a reading or update a station just by asking — nothing changes until they review and confirm it.',
    icon: <><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></>,
  },
  {
    title: 'Private by Design',
    desc: 'Available to signed-in EMB staff only. VERA never exposes credentials, keys or system configuration.',
    icon: <><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></>,
  },
];

export default function VeraLandingSection() {
  const sectionRef = useRef(null);

  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return undefined;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return undefined;

    const created = [];
    const track = (a) => { if (a) created.push(a); return a; };
    const cleanDone = (self) => { try { utils.cleanInlineStyles(self); } catch { /* ignore */ } };

    const orb = section.querySelector('.wv-avatar-orb');
    if (orb) track(animate(orb, { translateY: [-6, 6], duration: 3200, ease: 'inOutSine', loop: true, alternate: true }));
    const ring1 = section.querySelector('.wv-ring');
    if (ring1) track(animate(ring1, { rotate: '1turn', duration: 14000, ease: 'linear', loop: true }));
    const ring2 = section.querySelector('.wv-ring-2');
    if (ring2) track(animate(ring2, { rotate: '-1turn', duration: 20000, ease: 'linear', loop: true }));
    const cells = section.querySelectorAll('.wv-grid-cell');
    if (cells.length) {
      track(animate(cells, {
        opacity: [0.05, 0.4], scale: [0.85, 1.15], duration: 2600,
        delay: stagger(140, { from: 'random' }), ease: 'inOutSine', loop: true, alternate: true,
      }));
    }

    const io = new IntersectionObserver((entries, obs) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        obs.disconnect();
        const intro = section.querySelector('.wv-intro');
        if (intro) track(animate(intro, { opacity: [0, 1], translateX: [-24, 0], duration: 720, ease: 'out(3)', onComplete: cleanDone }));
        const features = section.querySelectorAll('.wv-feature');
        if (features.length) {
          track(animate(features, {
            opacity: [0, 1], translateY: [24, 0], scale: [0.96, 1], duration: 620,
            delay: stagger(90, { start: 120 }), ease: 'outBack', onComplete: cleanDone,
          }));
        }
      });
    }, { threshold: 0.15, rootMargin: '0px 0px -60px 0px' });
    io.observe(section);

    return () => {
      io.disconnect();
      created.forEach((a) => { try { a.pause?.(); a.revert?.(); } catch { /* ignore */ } });
    };
  }, []);

  return (
    <section className="welcome-vera-section" id="vera" ref={sectionRef} aria-labelledby="vera-title">
      <div className="wv-bg" aria-hidden="true">
        <div className="wv-grid">
          {Array.from({ length: 24 }).map((_, i) => <span className="wv-grid-cell" key={i} />)}
        </div>
        <div className="wv-orb wv-orb-1" />
        <div className="wv-orb wv-orb-2" />
      </div>

      <div className="wv-inner">
        <div className="wv-intro">
          <div className="wv-avatar-wrap">
            <span className="wv-ring" aria-hidden="true" />
            <span className="wv-ring wv-ring-2" aria-hidden="true" />
            <span className="wv-avatar-orb"><VeraFlameIcon size={64} anime title="VERA" /></span>
          </div>
          <span className="wv-tag">Meet VERA</span>
          <h2 id="vera-title">Your <span className="wv-gradient-text">AI Environmental Assistant</span></h2>
          <p className="wv-lead">
            VERA — the Virtual Environmental Response Assistant — is built into the Water Quality
            Monitoring System to answer questions about Central Luzon&apos;s rivers, bays and beaches
            straight from the monitoring records.
          </p>
          <p className="wv-desc">
            Available to EMB Region III staff inside the dashboard, VERA looks up readings, explains
            guideline exceedances, compares years and forecasts the months ahead — and helps
            administrators keep the data correct, one confirmed change at a time.
          </p>
        </div>

        <div className="wv-features">
          {FEATURES.map((f) => (
            <div className="wv-feature" key={f.title}>
              <span className="wv-feature-icon">
                <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{f.icon}</svg>
              </span>
              <div className="wv-feature-body">
                <h3>{f.title}</h3>
                <p>{f.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
