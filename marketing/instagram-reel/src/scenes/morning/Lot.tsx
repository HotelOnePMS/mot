// The Starlite lot in morning light, seen from Gus's office window (S22 background, S23).
// Drawn in "lot units" = S23 frame px at rest. Everything a backlit ivory morning: pale sky with a low sun
// at the right, faint mesas, Rita's Motor Inn across the highway with its sign dead, the Starlite pole sign
// dead above the lot, and Rita's sedan parked nose-in to the office with Rita asleep behind the windshield.
import React from 'react';
import {LIGHT, NIGHT} from '../../theme.ts';
import {RitaSign, StarliteSign, alpha, mix, useUid} from '../../set/parts.tsx';

/** Key positions in lot units. */
export const LOT = {
  horizon: 1000,
  road: {top: 1004, bottom: 1062},
  sedan: {x: 214, y: 1372, scale: 1},
  starlite: {x: 96, y: 452, scale: 1, ground: 1066},
  ritas: {x: 352, y: 870, scale: 0.34},
  sun: {x: 1010, y: 880},
} as const;

const SKY_TOP = LIGHT.background;
const SKY_LOW = mix(LIGHT.highlightSoft, LIGHT.highlight, 0.12);
const HAZE = mix(LIGHT.background, LIGHT.highlightSoft, 0.6);
const MESA_FAR = mix(mix(LIGHT.border, LIGHT.primarySoft, 0.55), LIGHT.borderStrong, 0.12);
const MESA_NEAR = mix(LIGHT.border, LIGHT.borderStrong, 0.42);
const ASPHALT_FAR = mix(LIGHT.borderStrong, LIGHT.border, 0.5);
const ASPHALT_NEAR = mix(LIGHT.borderStrong, LIGHT.foreground, 0.28);

/** Rita asleep in the driver's seat, seen through the windshield from the front (local: her neck base at 0,0). */
const SleepingRita: React.FC<{t: number}> = ({t}) => {
  const SKIN = mix(NIGHT.tape, NIGHT.redSoft, 0.3);
  const face = mix(SKIN, NIGHT.ink, 0.38);
  const hair = mix(NIGHT.grey, LIGHT.background, 0.25);
  const hairDeep = mix(NIGHT.grey, NIGHT.ink, 0.45);
  const knit = mix(NIGHT.redDeep, NIGHT.red, 0.35);
  const b = Math.sin(t * 0.2 * Math.PI * 2) * 1.2;
  return (
    <g>
      {/* headrest behind her head */}
      <rect x={-34} y={-104} width={60} height={46} rx={16} fill={mix(NIGHT.ink, NIGHT.wallLow, 0.6)} />
      {/* shoulders in the red cardigan, the binoculars on her chest */}
      <path d={`M-70 40 Q-62 ${4 + b} -24 ${-2 + b} L22 ${-2 + b} Q60 ${4 + b} 70 40 Z`} fill={knit} />
      <path d={`M-12 ${0 + b} L0 ${22 + b} L12 ${0 + b}`} fill="none" stroke={mix(NIGHT.paper, NIGHT.ink, 0.25)} strokeWidth={4} />
      <rect x={-17} y={22 + b} width={34} height={14} rx={4} fill={NIGHT.ink} />
      <circle cx={-9} cy={29 + b} r={4} fill={mix(NIGHT.ink, NIGHT.teal, 0.3)} />
      <circle cx={9} cy={29 + b} r={4} fill={mix(NIGHT.ink, NIGHT.teal, 0.3)} />
      {/* head tilted back and to her right, on the headrest */}
      <g transform={`translate(0 ${-8 + b * 0.6}) rotate(-17)`}>
        <rect x={-9} y={-16} width={18} height={18} fill={mix(face, NIGHT.ink, 0.2)} />
        <path d="M-30 -52 Q-32 -92 0 -96 Q32 -92 30 -52 Q30 -30 22 -18 L-22 -18 Q-30 -30 -30 -52 Z" fill={hairDeep} />
        <ellipse cx={0} cy={-46} rx={19} ry={25} fill={face} />
        {/* bob fringe and sides */}
        <path d="M-27 -48 Q-28 -84 0 -86 Q28 -84 27 -48 Q20 -66 2 -68 Q-16 -66 -27 -48 Z" fill={hair} />
        <path d="M-27 -50 Q-30 -30 -22 -18 L-17 -22 Q-22 -34 -19 -50 Z" fill={hair} />
        <path d="M27 -50 Q30 -30 22 -18 L17 -22 Q22 -34 19 -50 Z" fill={hair} />
        <path d="M-16 -78 Q0 -86 16 -78" fill="none" stroke={alpha(LIGHT.surface, 0.7)} strokeWidth={2} strokeLinecap="round" />
        {/* shut eyes behind the glasses, a little open mouth */}
        <circle cx={-8} cy={-46} r={6.5} fill="none" stroke={NIGHT.ink} strokeWidth={1.6} />
        <circle cx={8} cy={-46} r={6.5} fill="none" stroke={NIGHT.ink} strokeWidth={1.6} />
        <path d="M-12 -45 Q-8 -42 -4 -45 M4 -45 Q8 -42 12 -45" fill="none" stroke={mix(face, NIGHT.ink, 0.7)} strokeWidth={1.2} />
        <ellipse cx={0} cy={-29} rx={3} ry={2.2} fill={mix(NIGHT.redDeep, NIGHT.ink, 0.3)} />
      </g>
    </g>
  );
};

/** Rita's boxy sedan from the front (nose-in to the office), local origin at the ground centre, ~440 wide. */
export const SedanFront: React.FC<{t: number}> = ({t}) => {
  const uid = useUid('mf');
  const body = mix(NIGHT.wallLow, LIGHT.borderStrong, 0.22);
  const bodyHi = mix(body, LIGHT.background, 0.42);
  const bodyDeep = mix(NIGHT.ink, body, 0.55);
  const chrome = mix(LIGHT.border, LIGHT.surface, 0.5);
  const glassIn = mix(NIGHT.ink, NIGHT.wallLow, 0.5);
  return (
    <g>
      <defs>
        <linearGradient id={`${uid}g`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={mix(glassIn, LIGHT.background, 0.5)} />
          <stop offset="0.35" stopColor={mix(glassIn, LIGHT.background, 0.14)} />
          <stop offset="1" stopColor={glassIn} />
        </linearGradient>
        <linearGradient id={`${uid}h`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={bodyHi} />
          <stop offset="1" stopColor={body} />
        </linearGradient>
        <linearGradient id={`${uid}f`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={body} />
          <stop offset="1" stopColor={bodyDeep} />
        </linearGradient>
        <clipPath id={`${uid}c`}>
          <path d="M-172 -152 L-142 -238 Q-138 -246 -128 -246 L128 -246 Q138 -246 142 -238 L172 -152 Z" />
        </clipPath>
      </defs>
      {/* contact shadow */}
      <ellipse cx={0} cy={-2} rx={252} ry={16} fill={alpha(NIGHT.ink, 0.32)} />
      {/* tyres */}
      <rect x={-214} y={-48} width={58} height={48} rx={10} fill={NIGHT.ink} />
      <rect x={156} y={-48} width={58} height={48} rx={10} fill={NIGHT.ink} />
      {/* roof + pillars */}
      <path d="M-182 -150 L-150 -244 Q-146 -256 -132 -256 L132 -256 Q146 -256 150 -244 L182 -150 Z" fill={bodyDeep} />
      <path d="M-134 -254 L134 -254" stroke={alpha(LIGHT.surface, 0.55)} strokeWidth={3} strokeLinecap="round" />
      {/* windshield with Rita inside */}
      <path d="M-172 -152 L-142 -238 Q-138 -246 -128 -246 L128 -246 Q138 -246 142 -238 L172 -152 Z" fill={`url(#${uid}g)`} />
      <g clipPath={`url(#${uid}c)`}>
        {/* passenger headrest (our left) */}
        <rect x={-104} y={-226} width={56} height={44} rx={15} fill={mix(NIGHT.ink, NIGHT.wallLow, 0.6)} />
        <path d="M-136 -150 Q-120 -184 -76 -186 Q-36 -184 -24 -150 Z" fill={mix(NIGHT.ink, NIGHT.wallLow, 0.4)} />
        <g transform="translate(78 -176)">
          <SleepingRita t={t} />
        </g>
        {/* steering wheel rim in front of her */}
        <path d="M30 -150 Q78 -176 126 -150" fill="none" stroke={NIGHT.ink} strokeWidth={7} />
        {/* the dash */}
        <rect x={-180} y={-166} width={360} height={18} fill={mix(NIGHT.ink, NIGHT.wallLow, 0.5)} />
        {/* sky reflections on the glass */}
        <path d="M-60 -250 L-10 -250 L-120 -150 L-170 -150 Z" fill={alpha(LIGHT.surface, 0.22)} />
        <path d="M10 -250 L30 -250 L-80 -150 L-100 -150 Z" fill={alpha(LIGHT.surface, 0.14)} />
        <path d="M96 -250 L150 -250 L60 -150 L6 -150 Z" fill={alpha(LIGHT.surface, 0.1)} />
        <rect x={-180} y={-252} width={360} height={30} fill={alpha(LIGHT.background, 0.3)} />
      </g>
      {/* wipers */}
      <path d="M-120 -156 L-30 -170 M40 -156 L130 -168" stroke={NIGHT.ink} strokeWidth={3} strokeLinecap="round" />
      {/* side mirrors */}
      <path d="M-196 -170 L-226 -168 Q-234 -166 -232 -152 L-212 -150 Z" fill={bodyDeep} />
      <path d="M196 -170 L226 -168 Q234 -166 232 -152 L212 -150 Z" fill={bodyDeep} />
      {/* hood (top face catches the sky) */}
      <path d="M-188 -150 L188 -150 L214 -122 L-214 -122 Z" fill={`url(#${uid}h)`} />
      <path d="M-40 -150 L-46 -122 M40 -150 L46 -122" stroke={alpha(NIGHT.ink, 0.25)} strokeWidth={2} />
      {/* front face */}
      <path d="M-218 -122 L218 -122 L222 -66 L-222 -66 Z" fill={`url(#${uid}f)`} />
      <path d="M-216 -121 L216 -121" stroke={alpha(LIGHT.surface, 0.6)} strokeWidth={2} />
      {/* grille */}
      <rect x={-104} y={-114} width={208} height={42} rx={4} fill={NIGHT.ink} />
      {[0, 1, 2, 3].map((i) => (
        <rect key={i} x={-100} y={-109 + i * 10} width={200} height={3} fill={alpha(chrome, 0.5)} />
      ))}
      <rect x={-104} y={-114} width={208} height={42} rx={4} fill="none" stroke={chrome} strokeWidth={2.5} />
      {/* twin round headlights, off */}
      {[-178, -136, 136, 178].map((x) => (
        <g key={x}>
          <circle cx={x} cy={-94} r={17} fill={chrome} />
          <circle cx={x} cy={-94} r={13} fill={mix(LIGHT.border, NIGHT.wallLow, 0.35)} />
          <circle cx={x - 4} cy={-98} r={4} fill={alpha(LIGHT.surface, 0.85)} />
        </g>
      ))}
      {/* bumper */}
      <rect x={-232} y={-66} width={464} height={22} rx={10} fill={chrome} />
      <rect x={-232} y={-66} width={464} height={7} rx={3.5} fill={alpha(LIGHT.surface, 0.9)} />
      <rect x={-232} y={-50} width={464} height={6} rx={3} fill={alpha(NIGHT.ink, 0.22)} />
      {/* plate */}
      <rect x={-34} y={-62} width={68} height={16} rx={2} fill={LIGHT.surface} stroke={alpha(NIGHT.ink, 0.4)} strokeWidth={1} />
      <rect x={-26} y={-57} width={52} height={5} rx={1} fill={alpha(NIGHT.red, 0.65)} />
      <rect x={-200} y={-44} width={400} height={10} fill={bodyDeep} />
    </g>
  );
};

/** Rita's Motor Inn across the highway: a long low block, office at the left, her sign dead. Local origin at its ground left. */
const RitasFar: React.FC = () => {
  const wall = mix(LIGHT.border, NIGHT.redSoft, 0.2);
  const roof = mix(LIGHT.borderStrong, NIGHT.redDeep, 0.25);
  return (
    <g>
      <rect x={0} y={-92} width={520} height={92} fill={wall} />
      <rect x={-10} y={-104} width={540} height={14} fill={roof} />
      <rect x={20} y={-70} width={110} height={52} fill={mix(LIGHT.borderStrong, NIGHT.redDeep, 0.15)} />
      {[160, 214, 268, 322, 376, 430, 484].map((x) => (
        <rect key={x} x={x} y={-64} width={22} height={64} fill={mix(wall, LIGHT.borderStrong, 0.45)} />
      ))}
      <g transform="translate(-130 -330) scale(0.9)">
        <RitaSign on={0} halo={0} pole={300} />
      </g>
    </g>
  );
};

/** The whole lot view as an SVG <g> (lot units). `t` seconds (breathing), `signOn` 0 = dead (it is). */
export const MorningLot: React.FC<{t: number; signOn?: number}> = ({t, signOn = 0}) => {
  const uid = useUid('ml');
  const s = LOT.sun;
  // perspective stall lines converge on a point above the horizon, a little right of centre
  const vp = {x: 560, y: 930};
  const stall = [-1580, -1240, -900, -560, -220, 120, 460, 800, 1140, 1480, 1820];
  return (
    <g>
      <defs>
        <linearGradient id={`${uid}s`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={SKY_TOP} />
          <stop offset="0.55" stopColor={mix(SKY_TOP, SKY_LOW, 0.45)} />
          <stop offset="1" stopColor={SKY_LOW} />
        </linearGradient>
        <radialGradient id={`${uid}sun`} cx={s.x} cy={s.y} r={620} gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={LIGHT.surface} stopOpacity={1} />
          <stop offset="0.12" stopColor={LIGHT.surface} stopOpacity={0.85} />
          <stop offset="0.45" stopColor={LIGHT.highlightSoft} stopOpacity={0.45} />
          <stop offset="1" stopColor={LIGHT.highlightSoft} stopOpacity={0} />
        </radialGradient>
        <linearGradient id={`${uid}a`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={ASPHALT_FAR} />
          <stop offset="1" stopColor={ASPHALT_NEAR} />
        </linearGradient>
        <radialGradient id={`${uid}sheen`} cx={s.x - 160} cy={1120} r={520} gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={LIGHT.highlightSoft} stopOpacity={0.55} />
          <stop offset="1" stopColor={LIGHT.highlightSoft} stopOpacity={0} />
        </radialGradient>
      </defs>
      {/* sky and the low sun */}
      <rect x={-1400} y={-300} width={3200} height={1310} fill={`url(#${uid}s)`} />
      <rect x={-1400} y={-300} width={3200} height={1310} fill={`url(#${uid}sun)`} />
      {[{x: -120, y: 560, w: 520, o: 0.55}, {x: 360, y: 640, w: 420, o: 0.4}, {x: 640, y: 470, w: 600, o: 0.35}].map((c, i) => (
        <rect key={i} x={c.x} y={c.y} width={c.w} height={9} rx={4.5} fill={LIGHT.surface} opacity={c.o} />
      ))}
      {/* mesas */}
      <path d="M-1400 958 L-900 950 L-840 904 L-640 900 L-600 956 L-500 960 L-300 952 L-250 900 L-60 896 L-20 944 L180 950 L230 918 L420 914 L470 950 L900 956 L960 910 L1140 906 L1190 950 L1600 958 L1600 1010 L-1400 1010 Z" fill={MESA_FAR} />
      <path d="M-1400 992 L-500 990 L-120 984 L-60 962 L120 960 L170 982 L620 988 L1600 986 L1600 1010 L-1400 1010 Z" fill={MESA_NEAR} opacity={0.7} />
      {/* Rita's across the road, hazed by distance */}
      <g transform={`translate(${LOT.ritas.x} ${LOT.horizon + 4}) scale(${LOT.ritas.scale})`}>
        <RitasFar />
      </g>
      <rect x={-1400} y={820} width={3000} height={190} fill={HAZE} opacity={0.32} />
      {/* the highway */}
      <rect x={-1400} y={LOT.road.top} width={3000} height={LOT.road.bottom - LOT.road.top} fill={mix(LIGHT.borderStrong, LIGHT.background, 0.4)} />
      <rect x={-1400} y={LOT.road.top + 2} width={3000} height={2} fill={alpha(LIGHT.surface, 0.8)} />
      {Array.from({length: 26}, (_, i) => (
        <rect key={i} x={-1400 + i * 120} y={(LOT.road.top + LOT.road.bottom) / 2 - 1.5} width={56} height={3} fill={alpha(LIGHT.highlight, 0.75)} />
      ))}
      <rect x={-1400} y={LOT.road.bottom - 4} width={3000} height={2} fill={alpha(LIGHT.surface, 0.7)} />
      {/* the Starlite lot */}
      <rect x={-1400} y={LOT.road.bottom} width={3000} height={900} fill={`url(#${uid}a)`} />
      <rect x={-1400} y={LOT.road.bottom} width={3000} height={900} fill={`url(#${uid}sheen)`} />
      {stall.map((x, i) => {
        const y0 = LOT.road.bottom + 40;
        const k0 = (y0 - vp.y) / (1960 - vp.y);
        return <path key={i} d={`M${vp.x + (x - vp.x) * k0} ${y0} L${x} 1960`} stroke={alpha(LIGHT.surface, 0.72)} strokeWidth={6} />;
      })}
      <path d={`M-1400 ${LOT.road.bottom + 40} L1600 ${LOT.road.bottom + 40}`} stroke={alpha(LIGHT.surface, 0.55)} strokeWidth={4} />
      {/* last night's rain drying in the low spots, holding the sky */}
      <ellipse cx={720} cy={1210} rx={150} ry={12} fill={alpha(LIGHT.background, 0.5)} />
      <ellipse cx={-60} cy={1290} rx={120} ry={10} fill={alpha(LIGHT.background, 0.4)} />
      {/* the dead Starlite sign over the lot */}
      <g transform={`translate(${LOT.starlite.x} ${LOT.starlite.y}) scale(${LOT.starlite.scale})`}>
        <StarliteSign on={signOn} halo={0} pole={(LOT.starlite.ground - LOT.starlite.y) / LOT.starlite.scale - 300} />
      </g>
      <rect x={LOT.starlite.x + 80} y={LOT.starlite.ground - 6} width={100} height={8} rx={4} fill={alpha(NIGHT.ink, 0.25)} />
      {/* Rita's sedan, nose-in to the office */}
      <g transform={`translate(${LOT.sedan.x} ${LOT.sedan.y}) scale(${LOT.sedan.scale})`}>
        <SedanFront t={t} />
      </g>
    </g>
  );
};
