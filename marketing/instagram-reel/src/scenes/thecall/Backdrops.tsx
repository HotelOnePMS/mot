// Backdrops for TheCall, in frame px (SVG <g>s; the scene owns the <svg>).
//   S06Backdrop: what sits behind Rita's phone in the macro: the lower rim of
//     the steering wheel and the windshield's teal neon bokeh above, her
//     cardigan lap falling into the dark below, the screen's own halo.
//   ProfileCabBack / ProfileCabFront: S07's bottom half, the car from the
//     passenger seat: her door window behind her (red: her own motel across
//     the road), the A-pillar, the windshield on the right with Gus's office
//     glowing teal (his ringing phone a pin of #e0f7ff), the headrest, the dash
//     with its green clock light, and the wheel with the binoculars resting on it.
// All shades derive from theme tokens with mix()/alpha().
import React from 'react';
import {BinocularsArt} from '../../char/Rita.tsx';
import {mix, useUid} from '../../set/parts.tsx';
import {DARK, NIGHT} from '../../theme.ts';

const GREEN = DARK.successSoftForeground;

/** A soft bokeh disc (flat core, feathered edge) using a shared objectBoundingBox gradient id. */
const Disc: React.FC<{x: number; y: number; r: number; fill: string; o: number}> = ({x, y, r, fill, o}) => <circle cx={x} cy={y} r={r} fill={`url(#${fill})`} opacity={o} />;

/** Gradient defs for bokeh discs and soft glows in the given colours. */
const BokehDefs: React.FC<{id: string; colors: Record<string, string>}> = ({id, colors}) => (
  <>
    {Object.entries(colors).map(([k, c]) => (
      <React.Fragment key={k}>
        <radialGradient id={`${id}-disc-${k}`} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor={c} stopOpacity={0.85} />
          <stop offset="0.72" stopColor={c} stopOpacity={0.75} />
          <stop offset="0.9" stopColor={c} stopOpacity={0.3} />
          <stop offset="1" stopColor={c} stopOpacity={0} />
        </radialGradient>
        <radialGradient id={`${id}-glow-${k}`} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor={c} stopOpacity={1} />
          <stop offset="0.35" stopColor={c} stopOpacity={0.45} />
          <stop offset="1" stopColor={c} stopOpacity={0} />
        </radialGradient>
      </React.Fragment>
    ))}
  </>
);

/** A thick soft stroke (cheap defocus: stacked widths). */
const SoftStroke: React.FC<{d: string; color: string; width: number; o?: number; soft?: number}> = ({d, color, width, o = 1, soft = 40}) => (
  <g fill="none" stroke={color} strokeLinecap="round">
    <path d={d} strokeWidth={width + soft} opacity={0.18 * o} />
    <path d={d} strokeWidth={width + soft * 0.5} opacity={0.35 * o} />
    <path d={d} strokeWidth={width} opacity={0.9 * o} />
  </g>
);

// ─── S06 ────────────────────────────────────────────────────────────────────

/** Behind the phone macro. `halo` 0..1 is the screen's light on her lap; `center` is the phone centre. */
export const S06Backdrop: React.FC<{halo?: number; center?: {x: number; y: number}}> = ({halo = 1, center = {x: 510, y: 1080}}) => {
  const id = useUid('s6');
  return (
    <g>
      <defs>
        <linearGradient id={`${id}-bg`} x1="0" y1="0" x2="0" y2="1920" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={mix(NIGHT.ink, NIGHT.tealDeep, 0.75)} />
          <stop offset="0.3" stopColor={mix(NIGHT.ink, NIGHT.tealDeep, 0.3)} />
          <stop offset="0.62" stopColor={NIGHT.ink} />
          <stop offset="1" stopColor={mix(NIGHT.ink, NIGHT.redDeep, 0.55)} />
        </linearGradient>
        <linearGradient id={`${id}-lap`} x1="0" y1="1380" x2="0" y2="1920" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={mix(NIGHT.ink, NIGHT.redDeep, 0.8)} stopOpacity={0} />
          <stop offset="0.4" stopColor={mix(NIGHT.ink, NIGHT.redDeep, 0.8)} stopOpacity={0.8} />
          <stop offset="1" stopColor={mix(NIGHT.ink, NIGHT.redDeep, 0.55)} />
        </linearGradient>
        <BokehDefs id={id} colors={{t: NIGHT.teal, tb: NIGHT.tealBright, w: NIGHT.phoneGlowTeal, r: NIGHT.red, g: GREEN, s: NIGHT.phoneBloom}} />
      </defs>
      <rect x={-200} y={-300} width={1480} height={2520} fill={`url(#${id}-bg)`} />
      {/* the windshield beyond: the Starlite's neon, out of focus */}
      <circle cx={760} cy={250} r={520} fill={`url(#${id}-glow-t)`} opacity={0.32} />
      <Disc x={880} y={340} r={92} fill={`${id}-disc-t`} o={0.26} />
      <Disc x={1010} y={500} r={58} fill={`${id}-disc-tb`} o={0.18} />
      <Disc x={830} y={190} r={40} fill={`${id}-disc-tb`} o={0.32} />
      <Disc x={960} y={250} r={22} fill={`${id}-disc-w`} o={0.5} />
      <Disc x={130} y={310} r={70} fill={`${id}-disc-t`} o={0.2} />
      <Disc x={220} y={170} r={40} fill={`${id}-disc-tb`} o={0.26} />
      <Disc x={60} y={520} r={46} fill={`${id}-disc-t`} o={0.14} />
      <Disc x={168} y={436} r={16} fill={`${id}-disc-w`} o={0.4} />
      {/* her own red sign, far behind, caught in the glass */}
      <Disc x={70} y={800} r={74} fill={`${id}-disc-r`} o={0.11} />
      <Disc x={1020} y={900} r={52} fill={`${id}-disc-r`} o={0.09} />
      {/* the wheel's lower rim, soft, with the windshield's teal on its top edge */}
      <SoftStroke d="M-140 520 Q540 250 1220 500" color={mix(NIGHT.ink, NIGHT.wall, 0.4)} width={86} soft={50} />
      <SoftStroke d="M-140 474 Q540 204 1220 454" color={NIGHT.tealSoft} width={4} o={0.4} soft={14} />
      {/* the dash clock's green, low right */}
      <circle cx={1000} cy={1480} r={320} fill={`url(#${id}-glow-g)`} opacity={0.1} />
      {/* her lap: the cardigan, out of focus */}
      <path d="M-200 1520 Q260 1400 560 1450 Q900 1500 1280 1420 L1280 2200 L-200 2200 Z" fill={`url(#${id}-lap)`} />
      {/* the screen's own light falling on her */}
      <ellipse cx={center.x} cy={center.y + 120} rx={640} ry={820} fill={`url(#${id}-glow-s)`} opacity={0.12 * halo} />
    </g>
  );
};

// ─── S07 bottom half: the car from the passenger seat ──────────────────────

/** Geometry of the profile cab (frame px). */
export const CAB = {
  top: 965,
  pillarTop: [640, 694] as const,
  pillarBottom: [742, 802] as const,
  pillarY: [1040, 1566] as const,
  /** Gus's office window seen through the windshield, and his phone in it. */
  office: {x: 912, y: 1316, rx: 118, ry: 84},
  gusPhone: {x: 884, y: 1338},
  wheel: {cx: 806, cy: 1702, rx: 48, ry: 238, rot: -16},
} as const;

export type ProfileCabProps = {
  /** 0..1 Gus's phone pin through the windshield (rings with the chimes; 0 when it snaps dark). */
  gusPhone?: number;
  /** 0..1 ring envelope (halo on that pin). */
  ring?: number;
  /** Seconds, for the slow neon breathing. */
  t?: number;
};

/** Everything behind Rita. */
export const ProfileCabBack: React.FC<ProfileCabProps> = ({gusPhone = 1, ring = 0, t = 0}) => {
  const id = useUid('cab');
  const [ptl, ptr] = CAB.pillarTop;
  const [pbl, pbr] = CAB.pillarBottom;
  const [py0, py1] = CAB.pillarY;
  const breathe = 0.94 + 0.06 * Math.sin(t * 2.1);
  const windowPath = `M44 1092 Q300 1052 ${ptl} ${py0} L${pbl} ${py1} L44 1586 Z`;
  const screenPath = `M${ptr} ${py0 - 4} L1120 ${py0 - 46} L1120 1500 L${pbr} ${py1 - 10} Z`;
  return (
    <g>
      <defs>
        <BokehDefs id={id} colors={{t: NIGHT.teal, tb: NIGHT.tealBright, w: NIGHT.phoneGlowTeal, r: NIGHT.red, g: GREEN}} />
        <linearGradient id={`${id}-head`} x1="0" y1={CAB.top} x2="0" y2="1100" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={NIGHT.ink} />
          <stop offset="1" stopColor={mix(NIGHT.ink, NIGHT.wallLow, 0.7)} />
        </linearGradient>
        <linearGradient id={`${id}-side`} x1="44" y1="0" x2={pbl} y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={mix(NIGHT.ink, NIGHT.redDeep, 0.35)} />
          <stop offset="0.5" stopColor={mix(NIGHT.ink, NIGHT.wall, 0.8)} />
          <stop offset="1" stopColor={mix(NIGHT.ink, NIGHT.tealDeep, 0.55)} />
        </linearGradient>
        <linearGradient id={`${id}-ws`} x1="0" y1="1000" x2="0" y2="1540" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={mix(NIGHT.ink, NIGHT.tealDeep, 0.95)} />
          <stop offset="0.6" stopColor={mix(NIGHT.ink, NIGHT.tealDeep, 0.75)} />
          <stop offset="1" stopColor={mix(NIGHT.ink, NIGHT.tealDeep, 0.4)} />
        </linearGradient>
        <linearGradient id={`${id}-seat`} x1="200" y1="0" x2="360" y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={NIGHT.ink} />
          <stop offset="1" stopColor={mix(NIGHT.ink, NIGHT.wallLow, 0.9)} />
        </linearGradient>
        <linearGradient id={`${id}-dash`} x1="0" y1="1490" x2="0" y2="1760" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={mix(NIGHT.ink, NIGHT.wallLow, 0.9)} />
          <stop offset="1" stopColor={NIGHT.ink} />
        </linearGradient>
        <clipPath id={`${id}-wclip`}>
          <path d={windowPath} />
        </clipPath>
        <clipPath id={`${id}-sclip`}>
          <path d={screenPath} />
        </clipPath>
      </defs>
      {/* cabin */}
      <rect x={-60} y={CAB.top - 20} width={1200} height={1000} fill={NIGHT.ink} />
      <rect x={-60} y={CAB.top - 20} width={1200} height={160} fill={`url(#${id}-head)`} />
      {/* her door window: the dark lot, her own red neon far behind */}
      <path d={windowPath} fill={`url(#${id}-side)`} />
      <g clipPath={`url(#${id}-wclip)`}>
        <circle cx={120} cy={1230} r={260} fill={`url(#${id}-glow-r)`} opacity={0.2 * breathe} />
        <Disc x={150} y={1196} r={64} fill={`${id}-disc-r`} o={0.2 * breathe} />
        <Disc x={92} y={1300} r={34} fill={`${id}-disc-r`} o={0.16} />
        <Disc x={236} y={1150} r={22} fill={`${id}-disc-r`} o={0.22} />
        <Disc x={560} y={1146} r={30} fill={`${id}-disc-t`} o={0.08} />
        {/* glass sheen */}
        <path d="M120 1586 L420 1060 L470 1060 L170 1586 Z" fill={NIGHT.ivory} opacity={0.025} />
        <path d="M200 1586 L500 1060 L516 1060 L216 1586 Z" fill={NIGHT.ivory} opacity={0.03} />
      </g>
      <path d="M44 1092 Q300 1052 640 1040" fill="none" stroke={mix(NIGHT.ink, NIGHT.wallLow, 0.6)} strokeWidth={16} />
      <path d="M44 1100 Q300 1060 640 1048" fill="none" stroke={NIGHT.tealSoft} strokeWidth={1.6} opacity={0.18} />
      {/* B-pillar */}
      <path d="M-40 1060 L48 1080 L48 1960 L-40 1960 Z" fill={mix(NIGHT.ink, NIGHT.wallLow, 0.4)} />
      {/* windshield: Gus's office across the lot, out of focus */}
      <path d={screenPath} fill={`url(#${id}-ws)`} />
      <g clipPath={`url(#${id}-sclip)`}>
        <circle cx={930} cy={1110} r={300} fill={`url(#${id}-glow-t)`} opacity={0.42 * breathe} />
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <Disc key={i} x={812 + i * 34} y={1098 - Math.sin(i * 0.7) * 10} r={17} fill={`${id}-disc-tb`} o={0.42 * breathe} />
        ))}
        <Disc x={1010} y={1062} r={26} fill={`${id}-disc-w`} o={0.3} />
        <ellipse cx={CAB.office.x} cy={CAB.office.y} rx={CAB.office.rx} ry={CAB.office.ry} fill={`url(#${id}-glow-t)`} opacity={0.5} />
        <rect x={CAB.office.x - 92} y={CAB.office.y - 58} width={184} height={118} rx={18} fill={NIGHT.teal} opacity={0.16} />
        {/* Gus's phone, ringing on the desk */}
        <circle cx={CAB.gusPhone.x} cy={CAB.gusPhone.y} r={56} fill={`url(#${id}-glow-w)`} opacity={(0.18 + 0.32 * ring) * gusPhone} />
        <Disc x={CAB.gusPhone.x} y={CAB.gusPhone.y} r={11} fill={`${id}-disc-w`} o={0.95 * gusPhone} />
        {/* the hood edge and the lot */}
        <path d="M780 1480 Q940 1450 1120 1440 L1120 1560 L780 1560 Z" fill={NIGHT.ink} opacity={0.9} />
        <path d="M790 1478 Q940 1448 1120 1438" fill="none" stroke={NIGHT.tealSoft} strokeWidth={2} opacity={0.25} />
        <path d="M720 1000 L1120 1300" stroke={NIGHT.ivory} strokeWidth={40} opacity={0.025} />
      </g>
      {/* A-pillar */}
      <path d={`M${ptl} ${py0} L${ptr} ${py0 - 4} L${pbr} ${py1 - 10} L${pbl} ${py1} Z`} fill={mix(NIGHT.ink, NIGHT.wallLow, 0.45)} />
      <path d={`M${ptr} ${py0 - 4} L${pbr} ${py1 - 10}`} stroke={NIGHT.tealSoft} strokeWidth={2.4} opacity={0.45} />
      {/* headrest + seat back behind her */}
      <rect x={206} y={1262} width={138} height={176} rx={44} fill={`url(#${id}-seat)`} />
      <path d="M250 1264 Q300 1258 336 1290" fill="none" stroke={NIGHT.tealSoft} strokeWidth={2} opacity={0.3} strokeLinecap="round" />
      <path d="M248 1436 L248 1478 M304 1436 L304 1478" stroke={mix(NIGHT.ink, NIGHT.grey, 0.3)} strokeWidth={6} />
      <path d="M150 1470 Q290 1452 440 1470 L470 1960 L120 1960 Z" fill={`url(#${id}-seat)`} />
      {/* the dash, its clock light */}
      <path d={`M${pbl} ${py1} L1120 1486 L1120 1960 L700 1960 Z`} fill={`url(#${id}-dash)`} />
      <path d={`M${pbl} ${py1} L1120 1486`} stroke={NIGHT.tealSoft} strokeWidth={2.2} opacity={0.35} />
      <circle cx={850} cy={1610} r={190} fill={`url(#${id}-glow-g)`} opacity={0.32} />
    </g>
  );
};

/** Wheel + binoculars resting on it, in front of Rita. */
export const ProfileCabFront: React.FC = () => {
  const id = useUid('cabf');
  const w = CAB.wheel;
  // a partial highlight on the wheel rim's upper-left (windshield side)
  const arc = (a0: number, a1: number, dr = 0) => {
    const pts: string[] = [];
    const n = 24;
    const rr = (w.rot * Math.PI) / 180;
    for (let i = 0; i <= n; i++) {
      const a = ((a0 + ((a1 - a0) * i) / n) * Math.PI) / 180;
      const x = (w.rx + dr) * Math.cos(a);
      const y = (w.ry + dr) * Math.sin(a);
      pts.push(`${(w.cx + x * Math.cos(rr) - y * Math.sin(rr)).toFixed(1)} ${(w.cy + x * Math.sin(rr) + y * Math.cos(rr)).toFixed(1)}`);
    }
    return `M${pts.join(' L')}`;
  };
  return (
    <g>
      {/* column into the dash */}
      <path d={`M${w.cx - 20} ${w.cy - 10} L${w.cx + 160} ${w.cy + 40} L${w.cx + 170} ${w.cy + 110} L${w.cx - 10} ${w.cy + 60} Z`} fill={mix(NIGHT.ink, NIGHT.wallLow, 0.5)} />
      <g transform={`rotate(${w.rot} ${w.cx} ${w.cy})`}>
        <ellipse cx={w.cx} cy={w.cy} rx={w.rx} ry={w.ry} fill="none" stroke={mix(NIGHT.ink, NIGHT.wallLow, 0.75)} strokeWidth={30} />
        <ellipse cx={w.cx} cy={w.cy} rx={w.rx - 10} ry={w.ry - 8} fill="none" stroke={NIGHT.ink} strokeWidth={8} opacity={0.6} />
      </g>
      <path d={arc(200, 300, 14)} fill="none" stroke={NIGHT.tealSoft} strokeWidth={3} opacity={0.6} strokeLinecap="round" />
      <path d={arc(110, 170, 14)} fill="none" stroke={GREEN} strokeWidth={2.4} opacity={0.35} strokeLinecap="round" />
      {/* the binoculars, resting on the top of the rim, pointing at the Starlite */}
      <g transform="translate(646 1452) rotate(-5) scale(0.74)">
        <BinocularsArt rim={NIGHT.tealSoft} under={GREEN} rimAmount={0.9} underAmount={0.45} lens={NIGHT.teal} />
      </g>
      <defs>
        <radialGradient id={`${id}-v`} cx="0.5" cy="0.4" r="0.75">
          <stop offset="0.6" stopColor={NIGHT.ink} stopOpacity={0} />
          <stop offset="1" stopColor={NIGHT.ink} stopOpacity={0.55} />
        </radialGradient>
      </defs>
      <rect x={-60} y={CAB.top - 20} width={1200} height={1000} fill={`url(#${id}-v)`} />
    </g>
  );
};

/** Cheap lighting passes over the whole cab (screen-blended in the scene): windshield teal and dash green. */
export const CabLight: React.FC = () => {
  const id = useUid('cabl');
  return (
    <g style={{mixBlendMode: 'screen'}}>
      <defs>
        <radialGradient id={`${id}-t`} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor={NIGHT.tealBright} stopOpacity={0.18} />
          <stop offset="1" stopColor={NIGHT.tealBright} stopOpacity={0} />
        </radialGradient>
        <radialGradient id={`${id}-g`} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor={GREEN} stopOpacity={0.16} />
          <stop offset="1" stopColor={GREEN} stopOpacity={0} />
        </radialGradient>
      </defs>
      <circle cx={1000} cy={1260} r={560} fill={`url(#${id}-t)`} />
      <circle cx={760} cy={1640} r={300} fill={`url(#${id}-g)`} />
    </g>
  );
};
