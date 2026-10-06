// Small animated illustration for a field observation (Observation Panel,
// Waterbody Profile). Pure SVG + CSS keyframes: transform/opacity only, so the
// browser runs them on the compositor, and they stop under reduced motion.
// Which scene is shown comes from classifyObservation() (utils/observationMeta).

import { memo, useId } from 'react';
import './ObservationScene.css';

// One wave period is 36 units wide; the path is drawn over 144 units and the
// layer slides left by exactly one period, so the loop is seamless.
const wavePath = (y, amp) => {
  let d = `M0 ${y}`;
  for (let x = 0; x < 144; x += 18) d += ` Q ${x + 9} ${x % 36 === 0 ? y - amp : y + amp} ${x + 18} ${y}`;
  return `${d} V54 H0 Z`;
};

const Water = ({ level = 34, tone = 'water' }) => (
  <g className={`obs-water obs-water-${tone}`}>
    <rect x="0" y={level + 2} width="72" height={54 - level} className="obs-water-body" />
    <path d={wavePath(level, 2.2)} className="obs-wave obs-wave-back" />
    <path d={wavePath(level + 2, 1.6)} className="obs-wave obs-wave-front" />
  </g>
);

const Cloud = ({ x, y, delay = 0 }) => (
  <g className="obs-cloud" style={{ animationDelay: `${delay}s` }}>
    <ellipse cx={x} cy={y} rx="7" ry="3.2" />
    <ellipse cx={x + 5} cy={y - 2} rx="5" ry="3.4" />
    <ellipse cx={x - 5} cy={y - 1} rx="4" ry="2.6" />
  </g>
);

const SCENES = {
  waste: () => (
    <>
      <Cloud x={52} y={11} />
      <Water />
      <g className="obs-bob" style={{ animationDelay: '0s' }}>
        <rect x="8" y="28" width="13" height="5.5" rx="2" className="obs-debris-bottle" transform="rotate(-14 14 31)" />
        <rect x="20" y="29.2" width="2.6" height="3" rx="0.6" className="obs-debris-cap" transform="rotate(-14 14 31)" />
      </g>
      <g className="obs-bob" style={{ animationDelay: '-0.8s' }}>
        <path d="M28 34 q6 -10 12 0 q-6 3 -12 0z" className="obs-debris-bag" />
      </g>
      <g className="obs-bob" style={{ animationDelay: '-1.5s' }}>
        <rect x="48" y="27" width="7" height="8" rx="1.2" className="obs-debris-can" />
        <rect x="48" y="29.5" width="7" height="1.4" className="obs-debris-cap" />
      </g>
    </>
  ),

  pollution: (id) => (
    <>
      <defs>
        <linearGradient id={`${id}-sheen`} x1="0" x2="1">
          <stop offset="0" stopColor="#a855f7" stopOpacity="0.75" />
          <stop offset="0.25" stopColor="#3b82f6" stopOpacity="0.75" />
          <stop offset="0.5" stopColor="#22c55e" stopOpacity="0.75" />
          <stop offset="0.75" stopColor="#eab308" stopOpacity="0.75" />
          <stop offset="1" stopColor="#ef4444" stopOpacity="0.75" />
        </linearGradient>
        <clipPath id={`${id}-slick`}><ellipse cx="34" cy="38" rx="20" ry="4" /></clipPath>
      </defs>
      <Water tone="dark" />
      <g clipPath={`url(#${id}-slick)`}>
        <rect x="-20" y="33" width="112" height="10" fill={`url(#${id}-sheen)`} className="obs-sheen" />
      </g>
      {[16, 30, 46, 56].map((x, i) => (
        <circle key={x} cx={x} cy="48" r={1.2 + (i % 2) * 0.6} className="obs-bubble" style={{ animationDelay: `${i * -0.55}s` }} />
      ))}
      <g className="obs-alert">
        <path d="M60 6 L67 18 H53 Z" />
        <rect x="59.3" y="9.5" width="1.4" height="4.5" className="obs-alert-mark" />
        <circle cx="60" cy="15.6" r="0.8" className="obs-alert-mark" />
      </g>
    </>
  ),

  discharge: () => (
    <>
      <path d="M0 14 H22 V22 H0 Z" className="obs-land" />
      <rect x="14" y="15" width="12" height="5" rx="1" className="obs-pipe" />
      <path d="M26 18 C 32 18 34 26 35 34" className="obs-flow" />
      <Water level={34} />
      {[0, 1].map((i) => (
        <ellipse key={i} cx="35" cy="36" rx="3" ry="1" className="obs-ripple" style={{ animationDelay: `${i * -0.9}s` }} />
      ))}
    </>
  ),

  turbid: () => (
    <>
      <Cloud x={20} y={10} />
      <Water tone="brown" />
      <g className="obs-swirl" style={{ transformOrigin: '22px 44px' }}>
        <path d="M22 44 m-5 0 a5 3 0 1 0 10 0 a3.5 2 0 1 0 -7 0" className="obs-swirl-line" />
      </g>
      <g className="obs-swirl obs-swirl-rev" style={{ transformOrigin: '50px 46px' }}>
        <path d="M50 46 m-4 0 a4 2.4 0 1 0 8 0 a2.6 1.6 0 1 0 -5.2 0" className="obs-swirl-line" />
      </g>
      {[10, 34, 60].map((x, i) => <circle key={x} cx={x} cy={42 + i * 2} r="0.9" className="obs-silt" style={{ animationDelay: `${i * -0.7}s` }} />)}
    </>
  ),

  construction: () => (
    <>
      <path d="M0 26 H30 L38 36 H0 Z" className="obs-land" />
      <Water level={36} />
      <rect x="6" y="19" width="14" height="7" rx="1.5" className="obs-machine" />
      <rect x="5" y="25" width="16" height="2.4" rx="1.2" className="obs-track" />
      <g className="obs-arm" style={{ transformOrigin: '18px 20px' }}>
        <path d="M18 20 L30 13 L37 24" className="obs-arm-line" />
        <path d="M35 23 l5 1 l-1 4 l-5 -1z" className="obs-machine" />
      </g>
      <circle cx="50" cy="12" r="1.2" className="obs-dust" />
      <circle cx="46" cy="16" r="0.9" className="obs-dust" style={{ animationDelay: '-0.6s' }} />
    </>
  ),

  vegetation: () => (
    <>
      <Cloud x={54} y={10} delay={-3} />
      <Water />
      {[12, 30, 48].map((x, i) => (
        <g key={x} className="obs-sway" style={{ transformOrigin: `${x}px 35px`, animationDelay: `${i * -0.7}s` }}>
          <ellipse cx={x - 3} cy="32" rx="4" ry="2.2" className="obs-leaf" transform={`rotate(-25 ${x - 3} 32)`} />
          <ellipse cx={x + 3} cy="32" rx="4" ry="2.2" className="obs-leaf" transform={`rotate(25 ${x + 3} 32)`} />
          <ellipse cx={x} cy="29" rx="2.4" ry="4" className="obs-leaf obs-leaf-light" />
          {i === 1 && <circle cx={x} cy="25" r="2" className="obs-flower" />}
        </g>
      ))}
    </>
  ),

  tide: () => (
    <>
      <g className="obs-tide-rise"><Water level={27} /></g>
      <g className="obs-arrow obs-arrow-up">
        <path d="M60 22 V8 M55 13 L60 8 L65 13" className="obs-arrow-line" />
      </g>
      <path d="M6 20 H14 M6 26 H11 M6 32 H14" className="obs-gauge" />
    </>
  ),

  'tide-low': () => (
    <>
      <path d="M0 34 H24 L34 44 H0 Z" className="obs-sand" />
      <g className="obs-tide-fall"><Water level={41} /></g>
      <g className="obs-arrow obs-arrow-down">
        <path d="M60 8 V22 M55 17 L60 22 L65 17" className="obs-arrow-line" />
      </g>
    </>
  ),

  boats: () => (
    <>
      <Cloud x={14} y={10} delay={-2} />
      <Water />
      <g className="obs-boat" style={{ transformOrigin: '36px 34px' }}>
        <path d="M22 31 H50 L45 37 H27 Z" className="obs-hull" />
        <rect x="30" y="25" width="10" height="6" rx="1" className="obs-cabin" />
        <path d="M34 25 V15 L42 23 Z" className="obs-sail" />
        <path d="M34 15 V25" className="obs-mast" />
      </g>
      <path d="M50 36 q4 1 8 0 M14 36 q4 1 8 0" className="obs-wake" />
    </>
  ),

  bathing: () => (
    <>
      <g className="obs-sun-rays" style={{ transformOrigin: '60px 11px' }}>
        {[0, 45, 90, 135].map((a) => <path key={a} d="M60 3 V6 M60 16 V19" className="obs-ray" transform={`rotate(${a} 60 11)`} />)}
      </g>
      <circle cx="60" cy="11" r="4" className="obs-sun" />
      <Water />
      <g className="obs-swimmer" style={{ transformOrigin: '30px 33px' }}>
        <circle cx="30" cy="31" r="2.6" className="obs-head" />
        <path d="M33 32 q4 -6 8 -1" className="obs-arm-stroke" />
      </g>
      <ellipse cx="30" cy="35" rx="5" ry="1.2" className="obs-ripple" />
    </>
  ),

  calm: () => (
    <>
      <g className="obs-sun-rays" style={{ transformOrigin: '14px 12px' }}>
        {[0, 45, 90, 135].map((a) => <path key={a} d="M14 3 V6 M14 18 V21" className="obs-ray" transform={`rotate(${a} 14 12)`} />)}
      </g>
      <circle cx="14" cy="12" r="4.5" className="obs-sun" />
      <Water />
      <g className="obs-fish">
        <path d="M0 0 q5 -3 9 0 q-4 3 -9 0z M9 0 l3 -2.4 v4.8z" className="obs-fish-body" />
      </g>
      {[[52, 22], [62, 30], [44, 28]].map(([x, y], i) => (
        <path key={x} d={`M${x} ${y - 2} V${y + 2} M${x - 2} ${y} H${x + 2}`} className="obs-sparkle" style={{ animationDelay: `${i * -0.6}s` }} />
      ))}
    </>
  ),

  observed: () => (
    <>
      <Cloud x={20} y={11} />
      <Cloud x={52} y={16} delay={-4} />
      <Water />
      {[0, 1, 2].map((i) => (
        <ellipse key={i} cx="36" cy="40" rx="4" ry="1.4" className="obs-ripple" style={{ animationDelay: `${i * -0.8}s` }} />
      ))}
    </>
  ),
};

const ObservationScene = ({ scene = 'observed', status = 'observed', label = '', size = 'md' }) => {
  const id = useId().replace(/:/g, '');
  const render = SCENES[scene] || SCENES.observed;
  return (
    <span className={`obs-scene obs-scene-${size} status-${status}`} role="img" aria-label={label ? `${label} illustration` : 'Observation illustration'}>
      <svg viewBox="0 0 72 54" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <defs>
          <linearGradient id={`${id}-sky`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" className="obs-sky-top" />
            <stop offset="1" className="obs-sky-bottom" />
          </linearGradient>
        </defs>
        <rect width="72" height="54" fill={`url(#${id}-sky)`} />
        {render(id)}
      </svg>
    </span>
  );
};

export default memo(ObservationScene);
