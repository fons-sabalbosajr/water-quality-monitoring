// Shared VERA flame icon — a blue→teal→green gradient flame with a subtle,
// professional "alive" animation. Reused across every VERA surface (floating
// launcher, chat header, dashboard card, onboarding modal, landing avatar) so the
// brand mark stays identical everywhere.
//
// Two animation tiers, both honoring prefers-reduced-motion (they freeze to a
// steady glow):
//   • Default (CSS): lightweight glow-pulse + gentle flicker — used on the many
//     small icons so there is no per-instance JS cost.
//   • anime (Anime.js): a richer "living flame/core" — pulsing core, breathing
//     glow halo, and gentle movement — opt-in via the `anime` prop for hero spots
//     (onboarding modal, landing VERA avatar) where the extra life is wanted.
//
// Usage:
//   <VeraFlameIcon size={24} />            // CSS-animated (default)
//   <VeraFlameIcon size={56} anime />      // Anime.js living-flame/core

import { useEffect, useId, useRef } from "react";
import { animate } from "animejs";

// One <style> injected once per document (keyframes + reduced-motion rules).
const STYLE_ID = "vera-flame-anim-styles";
function ensureStyles() {
  if (typeof document === "undefined") return;
  if (document.getElementById(STYLE_ID)) return;
  const el = document.createElement("style");
  el.id = STYLE_ID;
  el.textContent = `
    .vera-flame { display: inline-flex; line-height: 0; position: relative; }
    .vera-flame svg { display: block; position: relative; z-index: 1; }
    .vera-flame-animated .vera-flame-glow {
      transform-box: fill-box;
      transform-origin: 50% 70%;
      animation: veraFlameFlicker 2.6s ease-in-out infinite;
      filter: drop-shadow(0 0 1.5px rgba(19,194,194,0.55));
      will-change: transform, opacity, filter;
    }
    .vera-flame-animated .vera-flame-core {
      transform-box: fill-box;
      transform-origin: 50% 70%;
      animation: veraFlameCore 1.9s ease-in-out infinite;
    }
    /* Anime.js tier: JS drives the paths, so disable the CSS keyframes. */
    .vera-flame-anime .vera-flame-glow,
    .vera-flame-anime .vera-flame-core { animation: none !important; }
    .vera-flame-halo {
      position: absolute; inset: 0; z-index: 0; border-radius: 50%; pointer-events: none;
      background: radial-gradient(circle at 50% 55%, rgba(19,194,194,0.45), rgba(22,119,255,0.12) 55%, transparent 72%);
      opacity: 0.6; will-change: transform, opacity;
    }
    @keyframes veraFlameFlicker {
      0%,100% { transform: scaleY(1) scaleX(1); opacity: 1; filter: drop-shadow(0 0 1.5px rgba(19,194,194,0.5)); }
      35%     { transform: scaleY(1.06) scaleX(0.98); opacity: 0.94; filter: drop-shadow(0 0 3px rgba(82,196,26,0.6)); }
      70%     { transform: scaleY(0.97) scaleX(1.02); opacity: 1; filter: drop-shadow(0 0 2px rgba(22,119,255,0.55)); }
    }
    @keyframes veraFlameCore {
      0%,100% { opacity: 0.85; transform: scaleY(1); }
      50%     { opacity: 1; transform: scaleY(1.08); }
    }
    @media (prefers-reduced-motion: reduce) {
      .vera-flame-animated .vera-flame-glow,
      .vera-flame-animated .vera-flame-core,
      .vera-flame-anime .vera-flame-glow,
      .vera-flame-anime .vera-flame-core { animation: none !important; filter: drop-shadow(0 0 2px rgba(19,194,194,0.5)); }
      .vera-flame-halo { opacity: 0.5 !important; }
    }
  `;
  document.head.appendChild(el);
}

const reducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false;

export default function VeraFlameIcon({ size = 20, animated = true, anime = false, className = "", title }) {
  const uid = useId().replace(/[:]/g, "");
  const gid = `veraFlame_${uid}`;
  ensureStyles();

  const glowRef = useRef(null);
  const coreRef = useRef(null);
  const haloRef = useRef(null);

  // Anime.js "living flame/core": pulsing core, breathing glow halo, and gentle
  // movement. Loops until unmount; cleaned up and skipped under reduced motion.
  useEffect(() => {
    if (!anime || reducedMotion()) return undefined;
    const created = [];
    const push = (a) => { if (a) created.push(a); };
    if (coreRef.current) {
      push(animate(coreRef.current, {
        scale: [1, 1.14], opacity: [0.8, 1], duration: 1500, ease: "inOutSine", loop: true, alternate: true,
      }));
    }
    if (glowRef.current) {
      push(animate(glowRef.current, {
        scaleY: [1, 1.07], scaleX: [1, 0.98], rotate: [-1.5, 1.5], duration: 2400, ease: "inOutSine", loop: true, alternate: true,
      }));
      // Gentle vertical drift = subtle "living" movement.
      push(animate(glowRef.current, {
        translateY: [0, -0.8], duration: 2000, ease: "inOutQuad", loop: true, alternate: true,
      }));
    }
    if (haloRef.current) {
      push(animate(haloRef.current, {
        scale: [0.9, 1.18], opacity: [0.4, 0.85], duration: 1800, ease: "inOutSine", loop: true, alternate: true,
      }));
    }
    return () => created.forEach((a) => { try { a.pause?.(); a.revert?.(); } catch { /* ignore */ } });
  }, [anime, size]);

  return (
    <span
      className={`vera-flame${animated ? " vera-flame-animated" : ""}${anime ? " vera-flame-anime" : ""}${className ? ` ${className}` : ""}`}
      style={{ width: size, height: size }}
      role={title ? "img" : undefined}
      aria-label={title || undefined}
      aria-hidden={title ? undefined : true}
    >
      {anime && <span ref={haloRef} className="vera-flame-halo" aria-hidden="true" />}
      <svg width={size} height={size} viewBox="0 0 24 24" focusable="false">
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#1677ff" />
            <stop offset="55%" stopColor="#13c2c2" />
            <stop offset="100%" stopColor="#52c41a" />
          </linearGradient>
        </defs>
        {/* Outer flame (glows + flickers) */}
        <path
          ref={glowRef}
          className="vera-flame-glow"
          fill={`url(#${gid})`}
          style={anime ? { transformBox: "fill-box", transformOrigin: "50% 70%" } : undefined}
          d="M12 2c.6 3.2-1.4 4.9-2.9 6.6C7.7 10.2 6.5 11.7 6.5 14a5.5 5.5 0 0 0 11 0c0-1.8-.7-3.1-1.7-4.4-.3.9-.9 1.6-1.8 2 .6-2.2-.2-4.4-1.5-6.1C11.7 4.4 12 3 12 2Z"
        />
        {/* Inner core (breathes) */}
        <path
          ref={coreRef}
          className="vera-flame-core"
          fill="#ffffff"
          fillOpacity="0.9"
          style={anime ? { transformBox: "fill-box", transformOrigin: "50% 70%" } : undefined}
          d="M12.2 14.2c1.3 0 2.1.9 2.1 2 0 1.4-1.1 2.2-2.3 2.2-1.3 0-2.3-.8-2.3-2.1 0-.9.5-1.5 1-2 .1.7.6 1.1 1.2 1.1.7 0 1.1-.5 1.1-1.1 0-.05 0-.1 0-.1Z"
        />
      </svg>
    </span>
  );
}
