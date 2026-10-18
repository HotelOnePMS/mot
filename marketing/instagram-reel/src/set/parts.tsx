// Shared pieces for the sets (Lobby, Highway, CarInterior): colour helpers,
// the two neon signs, the sedan, the lens glint and pen ink. Everything is an
// SVG <g> in its own local units, so a set can place it at any scale.
import React, {useId} from 'react';
import {random} from 'remotion';
import {NIGHT, FONT, DARK} from '../theme.ts';
import {handPaths, type HandLayout} from './hand.ts';

// ─── Colour ─────────────────────────────────────────────────────────────────

const rgb = (h: string): [number, number, number] => {
  const n = parseInt(h.slice(1, 7), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const hex2 = (v: number) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0');
/** Linear mix of two theme colours (t = 0 → a, 1 → b). Used to derive shades, never new hues. */
export const mix = (a: string, b: string, t: number): string => {
  const A = rgb(a);
  const B = rgb(b);
  return `#${hex2(A[0] + (B[0] - A[0]) * t)}${hex2(A[1] + (B[1] - A[1]) * t)}${hex2(A[2] + (B[2] - A[2]) * t)}`;
};
/** rgba() string of a theme colour. */
export const alpha = (c: string, a: number): string => {
  const [r, g, b] = rgb(c);
  return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, a)).toFixed(3)})`;
};
export const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/** Unique, url()-safe id prefix per component instance (several sets can be on screen at once). */
export const useUid = (prefix: string) => `${prefix}${useId().replace(/[^a-zA-Z0-9]/g, '')}x`; // 'x' never occurs in React's base-32 ids, so suffixes can't collide

export type Tint = 'red' | 'teal';
/** The film's two worlds: red = Rita, teal = Gus. */
export const TINT = {
  red: {key: NIGHT.red, soft: NIGHT.redSoft, deep: NIGHT.redDeep, bright: NIGHT.red, glow: NIGHT.phoneGlow, bloom: NIGHT.phoneBloom},
  teal: {key: NIGHT.teal, soft: NIGHT.tealSoft, deep: NIGHT.tealDeep, bright: NIGHT.tealBright, glow: NIGHT.phoneGlowTeal, bloom: NIGHT.phoneGlowTeal},
} as const;

/** Board-specified shades with no theme token. */
export const SHADE = {
  /** Phone bezel (S01). */
  bezel: '#1b1f27',
} as const;

// ─── Neon ───────────────────────────────────────────────────────────────────

type TextProps = React.SVGProps<SVGTextElement>;

/**
 * A line of neon: a blurred glow copy plus a bright tube. `on` 0..1 (flicker,
 * dips, dawn switch-off); at 0 the tube is unlit dark glass.
 */
export const NeonText: React.FC<{text: string; color: string; core: string; glow: string; on?: number; tube?: number} & TextProps> = ({text, color, core, glow, on = 1, tube, ...rest}) => {
  const fs = Number(rest.fontSize ?? 20);
  const lit = clamp01(on);
  const dark = mix(NIGHT.ink, color, 0.32);
  return (
    <>
      {lit > 0.01 ? (
        <text {...rest} fill={color} stroke={color} strokeWidth={fs * 0.1} opacity={0.85 * lit} filter={`url(#${glow})`} paintOrder="stroke">
          {text}
        </text>
      ) : null}
      <text {...rest} fill={mix(dark, core, lit)} stroke={mix(dark, color, lit)} strokeWidth={tube ?? fs * 0.035} paintOrder="stroke">
        {text}
      </text>
    </>
  );
};

/** A neon tube along a path (glow + bright core). */
export const NeonPath: React.FC<{d: string; color: string; core: string; glow: string; on?: number; width?: number; fill?: string}> = ({d, color, core, glow, on = 1, width = 3, fill = 'none'}) => {
  const lit = clamp01(on);
  const dark = mix(NIGHT.ink, color, 0.32);
  return (
    <>
      {fill !== 'none' ? <path d={d} fill={fill} /> : null}
      {lit > 0.01 ? <path d={d} fill="none" stroke={color} strokeWidth={width * 2.6} opacity={0.75 * lit} filter={`url(#${glow})`} strokeLinecap="round" strokeLinejoin="round" /> : null}
      <path d={d} fill="none" stroke={mix(dark, color, lit)} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" />
      <path d={d} fill="none" stroke={mix(dark, core, lit)} strokeWidth={width * 0.42} strokeLinecap="round" strokeLinejoin="round" opacity={lit} />
    </>
  );
};

const GlowDefs: React.FC<{id: string; blur: number; haloId?: string; color?: string}> = ({id, blur, haloId, color}) => (
  <defs>
    <filter id={id} x="-60%" y="-60%" width="220%" height="220%">
      <feGaussianBlur stdDeviation={blur} />
    </filter>
    {haloId && color ? (
      <radialGradient id={haloId}>
        <stop offset="0" stopColor={color} stopOpacity={0.42} />
        <stop offset="0.45" stopColor={color} stopOpacity={0.14} />
        <stop offset="1" stopColor={color} stopOpacity={0} />
      </radialGradient>
    ) : null}
  </defs>
);

/** Native box of the signs, in their local units (top-left origin). */
export const SIGN_BOX = {w: 260, h: 320} as const;

/**
 * "RITA'S / MOTOR INN / VACANCY": a tall Googie board with a bent neon arrow
 * pointing right (across the road, at the Starlite). Local box 260×320, the
 * pole attaches at (115, 316). `mirror` reverses it (seen from behind or in a mirror).
 */
export const RitaSign: React.FC<{on?: number; halo?: number; pole?: number; mirror?: boolean}> = ({on = 1, halo = 1, pole = 0, mirror = false}) => {
  const uid = useUid('rs');
  const g = `${uid}g`;
  const C = NIGHT.red;
  const core = mix(NIGHT.redSoft, NIGHT.ivory, 0.55);
  const lit = clamp01(on);
  const arrow = 'M115 196 L115 246 Q115 256 125 256 L212 256';
  const head = 'M206 238 L240 256 L206 274 Z';
  const bulbs = Array.from({length: 7}, (_, i) => [131 + i * 12, 256] as const);
  return (
    <g transform={mirror ? 'translate(260 0) scale(-1 1)' : undefined}>
      <GlowDefs id={g} blur={5} haloId={`${uid}h`} color={C} />
      <defs>
        <linearGradient id={`${uid}b`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={mix(NIGHT.ink, NIGHT.redDeep, 0.9)} />
          <stop offset="1" stopColor={NIGHT.ink} />
        </linearGradient>
      </defs>
      {halo > 0 ? <ellipse cx={125} cy={150} rx={230} ry={250} fill={`url(#${uid}h)`} opacity={halo * (0.25 + 0.75 * lit)} /> : null}
      {pole > 0 ? (
        <>
          <rect x={107} y={300} width={16} height={pole} fill={mix(NIGHT.ink, NIGHT.wall, 0.6)} />
          <rect x={107} y={300} width={3} height={pole} fill={alpha(C, 0.35 * lit)} />
        </>
      ) : null}
      {/* board */}
      <rect x={22} y={6} width={186} height={192} rx={22} fill={`url(#${uid}b)`} stroke={mix(NIGHT.ink, C, 0.35)} strokeWidth={3} />
      <rect x={24} y={9} width={3} height={186} rx={1.5} fill={alpha(C, 0.4 * lit)} />
      <NeonPath d="M46 18 H184 Q196 18 196 30 V174 Q196 186 184 186 H46 Q34 186 34 174 V30 Q34 18 46 18 Z" color={C} core={core} glow={g} on={on} width={3} />
      <NeonText text="Rita’s" x={115} y={94} textAnchor="middle" fontFamily={FONT.display} fontStyle="italic" fontWeight={700} fontSize={64} color={C} core={core} glow={g} on={on} />
      <NeonPath d="M54 114 H176" color={C} core={core} glow={g} on={on} width={2.4} />
      <NeonText text="MOTOR INN" x={115} y={154} textAnchor="middle" fontFamily={FONT.tight} fontWeight={800} fontSize={25} letterSpacing={2.5} color={C} core={core} glow={g} on={on} />
      {/* arrow */}
      <NeonPath d={arrow} color={C} core={core} glow={g} on={on} width={7} />
      <NeonPath d={head} color={C} core={core} glow={g} on={on} width={3.5} fill={mix(NIGHT.ink, C, 0.25 + 0.5 * lit)} />
      {bulbs.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={2.6} fill={mix(mix(NIGHT.ink, NIGHT.brass, 0.3), NIGHT.brassLight, lit * (i % 2 ? 1 : 0.7))} />
      ))}
      {/* VACANCY cabinet */}
      <rect x={30} y={278} width={150} height={36} rx={6} fill={NIGHT.ink} stroke={mix(NIGHT.ink, C, 0.3)} strokeWidth={2} />
      <NeonText text="VACANCY" x={105} y={303} textAnchor="middle" fontFamily={FONT.tight} fontWeight={800} fontSize={19} letterSpacing={3} color={NIGHT.redSoft} core={NIGHT.ivory} glow={g} on={on} />
    </g>
  );
};

const starPath = (cx: number, cy: number, radii: number[], rot = -Math.PI / 2) => {
  const n = radii.length;
  return (
    radii
      .map((r, i) => {
        const a = rot + (i / n) * Math.PI * 2;
        return `${i ? 'L' : 'M'}${(cx + Math.cos(a) * r).toFixed(2)} ${(cy + Math.sin(a) * r).toFixed(2)}`;
      })
      .join('') + 'Z'
  );
};

/**
 * "STARLITE ★ / MOTOR COURT / VACANCY": a starburst over a board. Local box
 * 260×320, the pole attaches at (130, 316).
 */
export const StarliteSign: React.FC<{on?: number; halo?: number; pole?: number; mirror?: boolean}> = ({on = 1, halo = 1, pole = 0, mirror = false}) => {
  const uid = useUid('ss');
  const g = `${uid}g`;
  const C = NIGHT.teal;
  const B = NIGHT.tealBright;
  const core = mix(NIGHT.tealSoft, NIGHT.ivory, 0.5);
  const lit = clamp01(on);
  const burst = starPath(130, 54, [52, 12, 30, 12, 52, 12, 30, 12, 52, 12, 30, 12, 52, 12, 30, 12]);
  return (
    <g transform={mirror ? 'translate(260 0) scale(-1 1)' : undefined}>
      <GlowDefs id={g} blur={5} haloId={`${uid}h`} color={C} />
      <defs>
        <linearGradient id={`${uid}b`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={mix(NIGHT.ink, NIGHT.tealDeep, 0.95)} />
          <stop offset="1" stopColor={NIGHT.ink} />
        </linearGradient>
      </defs>
      {halo > 0 ? <ellipse cx={130} cy={150} rx={230} ry={250} fill={`url(#${uid}h)`} opacity={halo * (0.25 + 0.75 * lit)} /> : null}
      {pole > 0 ? (
        <>
          <rect x={122} y={300} width={16} height={pole} fill={mix(NIGHT.ink, NIGHT.wall, 0.6)} />
          <rect x={135} y={300} width={3} height={pole} fill={alpha(C, 0.35 * lit)} />
        </>
      ) : null}
      <rect x={126} y={98} width={8} height={16} fill={mix(NIGHT.ink, NIGHT.wall, 0.7)} />
      <NeonPath d={burst} color={B} core={core} glow={g} on={on} width={3} fill={mix(NIGHT.ink, NIGHT.tealDeep, 0.6 + 0.4 * lit)} />
      <NeonPath d={starPath(52, 34, [14, 3, 14, 3, 14, 3, 14, 3])} color={B} core={core} glow={g} on={on} width={2} />
      <NeonPath d={starPath(212, 76, [10, 2.5, 10, 2.5, 10, 2.5, 10, 2.5])} color={B} core={core} glow={g} on={on} width={1.8} />
      <rect x={10} y={112} width={240} height={114} rx={20} fill={`url(#${uid}b)`} stroke={mix(NIGHT.ink, C, 0.35)} strokeWidth={3} />
      <NeonPath d="M34 122 H226 Q238 122 238 134 V204 Q238 216 226 216 H34 Q22 216 22 204 V134 Q22 122 34 122 Z" color={C} core={core} glow={g} on={on} width={2.6} />
      <g>
        <NeonText text="STARLITE" x={130} y={174} textAnchor="middle" fontFamily={FONT.tight} fontWeight={900} fontSize={40} letterSpacing={1.5} color={B} core={core} glow={g} on={on} />
        <NeonText text="MOTOR COURT" x={130} y={205} textAnchor="middle" fontFamily={FONT.tight} fontWeight={800} fontSize={18} letterSpacing={3.6} color={C} core={core} glow={g} on={on} />
      </g>
      <rect x={58} y={240} width={144} height={36} rx={6} fill={NIGHT.ink} stroke={mix(NIGHT.ink, C, 0.3)} strokeWidth={2} />
      <g>
        <NeonText text="VACANCY" x={130} y={265} textAnchor="middle" fontFamily={FONT.tight} fontWeight={800} fontSize={19} letterSpacing={3} color={B} core={NIGHT.ivory} glow={g} on={on} />
      </g>
    </g>
  );
};

// ─── Sedan ──────────────────────────────────────────────────────────────────

/** Native box of the sedan side view (pointing right; ground at y 100). */
export const SEDAN_BOX = {w: 300, h: 100} as const;

/**
 * Rita's boxy dark sedan, side view pointing right, local box 300×100 (ground
 * y 100). `rim` lights its top edges, `glass` tints the windows' reflection.
 * `flip` points it left. `glint` (0..1) is a cross glint on the windshield.
 */
export const Sedan: React.FC<{rim?: string; rimAmount?: number; glass?: string; flip?: boolean; shadow?: number}> = ({rim = NIGHT.teal, rimAmount = 0.7, glass, flip = false, shadow = 0.7}) => {
  const uid = useUid('sd');
  const body =
    'M6 70 L6 54 Q8 45 20 44 L84 41 L108 16 Q112 11 121 11 L189 11 Q198 11 202 16 L228 41 L286 45 Q296 46 297 56 L297 72 L290 77 L257 77 A21 21 0 0 0 215 77 L85 77 A21 21 0 0 0 43 77 L12 77 Q6 76 6 70 Z';
  const top = 'M6 54 Q8 45 20 44 L84 41 L108 16 Q112 11 121 11 L189 11 Q198 11 202 16 L228 41 L286 45 Q296 46 297 56';
  const gl = glass ?? rim;
  return (
    <g transform={flip ? 'translate(300 0) scale(-1 1)' : undefined}>
      <defs>
        <linearGradient id={`${uid}b`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={mix(NIGHT.wall, rim, 0.18)} />
          <stop offset="0.45" stopColor={mix(NIGHT.ink, NIGHT.wallLow, 0.6)} />
          <stop offset="1" stopColor={NIGHT.ink} />
        </linearGradient>
        <linearGradient id={`${uid}g`} x1="0" y1="0" x2="0.3" y2="1">
          <stop offset="0" stopColor={mix(NIGHT.ink, gl, 0.55)} />
          <stop offset="0.5" stopColor={mix(NIGHT.ink, gl, 0.16)} />
          <stop offset="1" stopColor={NIGHT.ink} />
        </linearGradient>
      </defs>
      <ellipse cx={150} cy={98} rx={156} ry={7} fill={alpha(NIGHT.ink, shadow)} />
      <path d={body} fill={`url(#${uid}b)`} />
      {/* greenhouse */}
      <path d="M90 41 L111 19 Q114 16 120 16 L150 16 L150 41 Z" fill={`url(#${uid}g)`} />
      <path d="M156 41 L156 16 L188 16 Q194 16 197 19 L221 41 Z" fill={`url(#${uid}g)`} />
      <path d="M118 22 L128 22 L112 39 L102 39 Z" fill={alpha(NIGHT.ivory, 0.08)} />
      <path d="M176 20 L184 20 L170 39 L162 39 Z" fill={alpha(NIGHT.ivory, 0.06)} />
      {/* trim */}
      <path d="M18 50 L290 52" stroke={alpha(rim, 0.22 * rimAmount + 0.05)} strokeWidth={1.2} />
      <path d="M100 44 V75 M153 42 V75 M214 43 V75" stroke={alpha(NIGHT.ink, 0.9)} strokeWidth={1.4} />
      <rect x={128} y={53} width={12} height={2.4} rx={1} fill={alpha(rim, 0.35)} />
      <rect x={190} y={53} width={12} height={2.4} rx={1} fill={alpha(rim, 0.35)} />
      <rect x={3} y={60} width={12} height={9} rx={2} fill={mix(NIGHT.ink, NIGHT.grey, 0.25)} />
      <rect x={287} y={61} width={12} height={9} rx={2} fill={mix(NIGHT.ink, NIGHT.grey, 0.25)} />
      <rect x={6} y={48} width={6} height={10} rx={1.5} fill={mix(NIGHT.ink, NIGHT.red, 0.45)} />
      <rect x={291} y={49} width={6} height={7} rx={1.5} fill={mix(NIGHT.ink, NIGHT.ivory, 0.25)} />
      {/* rim light along the top silhouette */}
      <path d={top} fill="none" stroke={rim} strokeWidth={2} opacity={rimAmount} strokeLinejoin="round" />
      {/* wheels */}
      {[64, 236].map((x) => (
        <g key={x}>
          <circle cx={x} cy={82} r={17} fill={NIGHT.ink} />
          <circle cx={x} cy={82} r={9.5} fill={mix(NIGHT.ink, NIGHT.grey, 0.32)} />
          <circle cx={x} cy={82} r={4} fill={mix(NIGHT.ink, NIGHT.grey, 0.15)} />
          <path d={`M${x - 8} ${78} A9 9 0 0 1 ${x + 5} ${73.5}`} fill="none" stroke={alpha(rim, 0.6 * rimAmount)} strokeWidth={1.6} />
        </g>
      ))}
    </g>
  );
};

/** A white cross glint (a lens catching light), centred on 0,0; `size` is the arm length. */
export const Glint: React.FC<{size?: number; amount?: number; color?: string}> = ({size = 40, amount = 1, color = NIGHT.ivory}) => {
  const uid = useUid('gl');
  if (amount <= 0.001) return null;
  const s = size * (0.75 + 0.25 * amount);
  return (
    <g opacity={clamp01(amount)}>
      <defs>
        <radialGradient id={uid}>
          <stop offset="0" stopColor={color} stopOpacity={0.9} />
          <stop offset="0.3" stopColor={color} stopOpacity={0.25} />
          <stop offset="1" stopColor={color} stopOpacity={0} />
        </radialGradient>
      </defs>
      <circle r={s * 0.7} fill={`url(#${uid})`} />
      <path d={`M${-s} 0 L0 ${-s * 0.045} L${s} 0 L0 ${s * 0.045} Z`} fill={color} />
      <path d={`M0 ${-s} L${s * 0.045} 0 L0 ${s} L${-s * 0.045} 0 Z`} fill={color} />
      <path d={`M${-s * 0.4} ${-s * 0.4} L${s * 0.4} ${s * 0.4} M${s * 0.4} ${-s * 0.4} L${-s * 0.4} ${s * 0.4}`} stroke={color} strokeWidth={s * 0.02} opacity={0.6} />
      <circle r={s * 0.09} fill={DARK.foreground} />
    </g>
  );
};

/** Pen or marker ink: the part of a handwriting layout drawn by `progress`. */
export const Ink: React.FC<{layout: HandLayout; progress?: number; color: string; width: number; opacity?: number}> = ({layout, progress = 1, color, width, opacity = 1}) => (
  <g fill="none" stroke={color} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" opacity={opacity}>
    {handPaths(layout, progress).map((d, i) => (
      <path key={i} d={d} />
    ))}
  </g>
);

/** Seeded star field inside a rect (static). */
export const Stars: React.FC<{x: number; y: number; w: number; h: number; n: number; seed: string; color?: string; size?: number; opacity?: number}> = ({x, y, w, h, n, seed, color = NIGHT.ivory, size = 1.6, opacity = 0.7}) => {
  return (
    <g fill={color}>
      {Array.from({length: n}, (_, i) => {
        const r = random(`${seed}-r${i}`);
        return <circle key={i} cx={x + random(`${seed}-x${i}`) * w} cy={y + random(`${seed}-y${i}`) * h} r={size * (0.45 + r * r * 1.1)} opacity={opacity * (0.3 + 0.7 * random(`${seed}-o${i}`))} />;
      })}
    </g>
  );
};
