// fx/Binoculars: the binocular POV. A black frame with one or two feathered
// circular apertures, a 1 px chromatic fringe on the union's rim, lens fall-off
// toward the edge, and a handheld Perlin drift on the mask and (a little more)
// on the image. Used by S02/S03 (Rita, red/cyan fringe), S07 top half and S27
// (Gus, teal fringe, calmer 1 px drift).
//
// Cheap per frame: the aperture is a CSS mask of two radial gradients (layers
// union by default), the fringe is four stroked SVG circles. No filters.
import React from 'react';
import {AbsoluteFill, useCurrentFrame} from 'remotion';
import {NIGHT} from '../theme.ts';
import {handheld} from './noise.ts';
import {HEIGHT, WIDTH} from '../timeline.ts';

export type Pt = {x: number; y: number};
export type Rim = 'redCyan' | 'teal' | 'none';

/** Board presets (frame px). */
export const BINO = {
  /** S02: r 410, centres (330, 900) and (690, 900). */
  S02: {r: 410, centers: [{x: 330, y: 900}, {x: 690, y: 900}]},
  /** S03: r 440, centres (300, 880) and (720, 880) — where S04's objective lenses sit. */
  S03: {r: 440, centers: [{x: 300, y: 880}, {x: 720, y: 880}]},
  /** S07 top half: r 330, centres (360, 600) and (650, 600). */
  S07: {r: 330, centers: [{x: 360, y: 600}, {x: 650, y: 600}]},
} as const;

export type BinocularsProps = {
  /** What the lenses see (full-frame content). */
  children: React.ReactNode;
  /** One or two aperture centres in frame px. Default BINO.S02. */
  centers?: readonly Pt[];
  /** Aperture radius px. */
  r?: number;
  /** Edge feather px (board: 18). */
  feather?: number;
  /** Fringe colours: Rita's red/cyan or Gus's teal. */
  rim?: Rim;
  /** Handheld drift amplitude px (2–3 Rita, 1 Gus). 0 = locked off. */
  drift?: number;
  /** Drift frequency (board: 0.6 Hz). */
  driftHz?: number;
  /** Noise seed so different shots don't share the same shake. */
  seed?: string;
  /** Image drift relative to the mask drift (the picture swims a bit more than the eyecups). */
  imageDrift?: number;
  /** Lens fall-off toward the rim, 0..1 (0 = flat). */
  falloff?: number;
  /** Outside colour (black). */
  outside?: string;
  /** Override the frame used for drift (defaults to useCurrentFrame()). */
  frame?: number;
  /** Optional diagonal glass reflection streaks over the image, opacity 0..1 (S02: 0.12 teal). */
  streaks?: number;
  streakColor?: string;
  /** Overlay drawn in frame space ABOVE the black (series bug, counter…), not masked. */
  overlay?: React.ReactNode;
  style?: React.CSSProperties;
};

const maskFor = (centers: readonly Pt[], r: number, feather: number, falloff: number, dx: number, dy: number) =>
  centers
    .map((c) => {
      const x = c.x + dx;
      const y = c.y + dy;
      const inner = Math.max(0, r - feather);
      const mid = r * 0.66;
      const edgeA = 1 - 0.32 * falloff; // alpha just inside the feather
      return `radial-gradient(circle ${r}px at ${x.toFixed(2)}px ${y.toFixed(2)}px, #000 0px, #000 ${mid.toFixed(1)}px, rgba(0,0,0,${(1 - 0.08 * falloff).toFixed(3)}) ${(r * 0.84).toFixed(1)}px, rgba(0,0,0,${edgeA.toFixed(3)}) ${inner.toFixed(1)}px, rgba(0,0,0,0) ${r}px)`;
    })
    .join(', ');

/** Path of the frame minus a circle (evenodd), to clip a ring to outside the other aperture. */
const outsideCircle = (c: Pt, r: number) =>
  `M-200 -200H${WIDTH + 200}V${HEIGHT + 200}H-200Z M${c.x - r} ${c.y}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`;

const RIM_COLORS: Record<Exclude<Rim, 'none'>, {a: string; b: string; glow: string}> = {
  // Rita's binoculars: a warm red fringe on one side, cyan on the other.
  redCyan: {a: NIGHT.red, b: NIGHT.tealSoft, glow: NIGHT.redSoft},
  // Gus's: a cooler, single-hue teal fringe.
  teal: {a: NIGHT.teal, b: NIGHT.tealSoft, glow: NIGHT.tealSoft},
};

/** The fringe + a hairline rim glint around the union of the apertures. */
const Fringe: React.FC<{centers: readonly Pt[]; r: number; rim: Rim; dx: number; dy: number; feather: number; id: string}> = ({centers, r, rim, dx, dy, feather, id}) => {
  if (rim === 'none') return null;
  const col = RIM_COLORS[rim];
  const cs = centers.map((c) => ({x: c.x + dx, y: c.y + dy}));
  // The visible rim sits where the mask alpha is ~0.5: r - feather/2.
  const rr = r - feather * 0.45;
  return (
    <svg width={WIDTH} height={HEIGHT} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} style={{position: 'absolute', inset: 0, pointerEvents: 'none', mixBlendMode: 'screen'}}>
      <defs>
        {cs.map((c, i) => {
          const others = cs.filter((_, j) => j !== i);
          return (
            <clipPath key={i} id={`${id}-clip${i}`} clipPathUnits="userSpaceOnUse">
              {others.length ? <path d={outsideCircle(others[0], rr + 0.5)} clipRule="evenodd" /> : <rect x={-200} y={-200} width={WIDTH + 400} height={HEIGHT + 400} />}
            </clipPath>
          );
        })}
        {/* fringe is strongest at the outer sides of the pair, fading at top/bottom */}
        <linearGradient id={`${id}-lr`} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#fff" stopOpacity="1" />
          <stop offset="0.5" stopColor="#fff" stopOpacity="0.35" />
          <stop offset="1" stopColor="#fff" stopOpacity="1" />
        </linearGradient>
        <mask id={`${id}-m`} maskUnits="userSpaceOnUse" x={0} y={0} width={WIDTH} height={HEIGHT}>
          <rect x={0} y={0} width={WIDTH} height={HEIGHT} fill={`url(#${id}-lr)`} />
        </mask>
      </defs>
      <g mask={`url(#${id}-m)`}>
        {cs.map((c, i) => (
          <g key={i} clipPath={`url(#${id}-clip${i})`}>
            {/* soft halo just inside the rim: light scattering in the eyepiece */}
            <circle cx={c.x} cy={c.y} r={rr - 3} fill="none" stroke={col.glow} strokeOpacity={0.07} strokeWidth={10} />
            {/* chromatic fringe: the two primaries pulled 1 px apart */}
            <circle cx={c.x - 1} cy={c.y - 0.5} r={rr} fill="none" stroke={col.a} strokeOpacity={0.55} strokeWidth={1.4} />
            <circle cx={c.x + 1} cy={c.y + 0.5} r={rr + 0.6} fill="none" stroke={col.b} strokeOpacity={0.5} strokeWidth={1.2} />
          </g>
        ))}
      </g>
    </svg>
  );
};

export const Binoculars: React.FC<BinocularsProps> = ({
  children,
  centers = BINO.S02.centers,
  r = BINO.S02.r,
  feather = 18,
  rim = 'redCyan',
  drift = 2.5,
  driftHz = 0.6,
  seed = 'bino',
  imageDrift = 1.6,
  falloff = 1,
  outside = '#000',
  frame,
  streaks = 0,
  streakColor = NIGHT.teal,
  overlay,
  style,
}) => {
  const cur = useCurrentFrame();
  const fr = frame ?? cur;
  const id = `bino${React.useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const m = handheld(fr, drift, driftHz, seed);
  const im = handheld(fr, drift * imageDrift, driftHz, `${seed}-img`);
  const mask = maskFor(centers, r, feather, falloff, m.x, m.y);
  return (
    <AbsoluteFill style={{background: outside, overflow: 'hidden', ...style}}>
      <AbsoluteFill style={{WebkitMaskImage: mask, maskImage: mask, WebkitMaskRepeat: 'no-repeat', maskRepeat: 'no-repeat'}}>
        <AbsoluteFill style={{transform: `translate(${(m.x + im.x).toFixed(2)}px, ${(m.y + im.y).toFixed(2)}px) rotate(${im.rot.toFixed(3)}deg)`}}>{children}</AbsoluteFill>
        {streaks > 0 ? <GlassStreaks opacity={streaks} color={streakColor} dx={im.x * 0.5} /> : null}
      </AbsoluteFill>
      <Fringe centers={centers} r={r} rim={rim} dx={m.x} dy={m.y} feather={feather} id={id} />
      {overlay}
    </AbsoluteFill>
  );
};

/** Two diagonal reflection streaks on plate glass (S02: teal at 12%). */
export const GlassStreaks: React.FC<{opacity?: number; color?: string; dx?: number; angle?: number}> = ({opacity = 0.12, color = NIGHT.teal, dx = 0, angle = -28}) => (
  <AbsoluteFill style={{opacity, mixBlendMode: 'screen', pointerEvents: 'none'}}>
    <div
      style={{
        position: 'absolute',
        left: -400,
        top: -400,
        width: WIDTH + 800,
        height: HEIGHT + 800,
        transform: `translateX(${dx}px) rotate(${angle}deg)`,
        background: `linear-gradient(90deg, transparent 38%, ${color} 40.5%, transparent 44%, transparent 47%, ${color}aa 47.8%, transparent 49.2%)`,
      }}
    />
  </AbsoluteFill>
);
