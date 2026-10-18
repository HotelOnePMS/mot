// ONE motel lobby, used for BOTH Rita's lobby (red) and Gus's Starlite (teal).
// Sharing the set is what makes the twist work: the frame-0 lobby everyone
// reads as the Starlite is Rita's, and the S02 Starlite through the binoculars
// is the same room in teal.
//
// Units: the set is drawn in S01 frame coordinates (HOOK_CROP is the identity,
// so set point (505, 935) is frame pixel (505, 935) on frame 0), oversize to
// x -560..1600, y -220..2200 so pull-backs (S19 to 0.92 with a +260 px pan,
// S02 at ~0.55 through the binoculars) never show an edge.
//
// Everything that moves is a prop; the set reads no frame of its own.
import React from 'react';
import {AbsoluteFill, random} from 'remotion';
import {FONT, LIGHT, NIGHT} from '../theme.ts';
import {layoutHand} from './hand.ts';
import {Glint, Ink, RitaSign, SHADE, Sedan, StarliteSign, Stars, TINT, alpha, clamp01, mix, useUid, type Tint} from './parts.tsx';

// ─── Geometry (set units = S01 frame px) ────────────────────────────────────

/** The full drawn extent of the set. */
export const LOBBY_SET = {x0: -560, y0: -220, x1: 1600, y1: 2200} as const;

/** Where things are, in set units (S01 frame px). Map to frame px with lobbyToFrame(). */
export const LOBBY = {
  counterY: 1110,
  phone: {x: 405, y: 690, w: 200, h: 410},
  /** The lit screen; the cradle lip covers it from y 1036. */
  screen: {x: 415, y: 724, w: 180, h: 340},
  screenCenter: {x: 505, y: 880},
  bell: {x: 250, y: 1042, w: 90, h: 68},
  register: {x: 646, y: 1050, w: 218, h: 58},
  clock: {x: 175, y: 718, w: 160, h: 64},
  keyRack: {x: 182, y: 812, w: 150, h: 168},
  door: {x: -90, y: 540, w: 240, h: 540},
  window: {x: 660, y: 620, w: 350, h: 340},
  /** The Starlite sign in the S01 window view. */
  windowSign: {x: 789, y: 652, w: 161, h: 174},
  /** Rita's sedan under the Starlite sign (S01 window view). Ring it in S19 with lobbyToFrame(). */
  sedan: {x: 790, y: 888, w: 141, h: 47, cx: 860, cy: 912},
  /** Where the binocular glint sits (the sedan's windshield). */
  glint: {x: 832, y: 902},
  chair: {x: 668, y: 934, w: 158, h: 142},
} as const;

/** Push anchor for S01 (the phone screen, from the board). */
export const HOOK_ORIGIN = {x: 505, y: 935} as const;

/**
 * Camera on the set. The set is scaled by `scale` about (ox, oy) (default
 * HOOK_ORIGIN), then moved by (x, y) frame px. A camera pan RIGHT is a negative x
 * (S19's "+260 px" pan right is x: -260).
 */
export type Crop = {scale: number; x: number; y: number; ox?: number; oy?: number};

/** S01 frame 0 and S18's first frame: the identity. Pass exactly this (and the same props) to pixel-match. */
export const HOOK_CROP: Crop = {scale: 1, x: 0, y: 0};

/** Set point → frame px under a crop. */
export const lobbyToFrame = (p: {x: number; y: number}, crop: Crop = HOOK_CROP) => {
  const ox = crop.ox ?? HOOK_ORIGIN.x;
  const oy = crop.oy ?? HOOK_ORIGIN.y;
  return {x: ox + (p.x - ox) * crop.scale + crop.x, y: oy + (p.y - oy) * crop.scale + crop.y};
};

/** SVG transform string for a crop. */
export const cropTransform = (crop: Crop = HOOK_CROP) => {
  const ox = crop.ox ?? HOOK_ORIGIN.x;
  const oy = crop.oy ?? HOOK_ORIGIN.y;
  return `translate(${ox + crop.x} ${oy + crop.y}) scale(${crop.scale}) translate(${-ox} ${-oy})`;
};

/** ±px horizontal phone buzz for a frame (30 Hz at 30 fps = one swing per frame). `env` 0..1. */
export const buzzOffset = (frame: number, env: number, px = 3) => (frame % 2 === 0 ? 1 : -1) * px * clamp01(env);

// ─── Props ──────────────────────────────────────────────────────────────────

export type PhoneState = 'ringing' | 'incoming' | 'dark' | 'missed';
export type WindowView = 'starlite' | 'ritas' | 'none';

export type LobbyProps = {
  /** 'red' = Rita's lobby, 'teal' = Gus's Starlite. */
  tint?: Tint;
  /** FRONT DESK label on the cradle: 'tape' (Rita, marker on masking tape) or 'printed' (Gus). Default by tint. */
  label?: 'tape' | 'printed';
  /** What the window shows: the Starlite across the road (Rita's lobby, default for red), Rita's across the road, or closed blinds with the far neon leaking through (default for teal). */
  windowView?: WindowView;
  /** 'ringing'/'incoming' = incoming-call UI; 'dark' = screen off; 'missed' = dim lock screen with a missed-call card. */
  phoneState?: PhoneState;
  /** Number on the incoming-call UI and the missed card. Default red '(928) 555-0147', teal '(928) 555-0163'. */
  screenNumber?: string;
  /** Missed-call card title. */
  missedLabel?: string;
  /** Lock-screen time in the missed state. */
  missedTime?: string;
  /** Missed-card timestamp. */
  missedAt?: string;
  /** 0..1 ring envelope: bloom +15%, ring halo on the handset glyph. */
  ringPulse?: number;
  /** Horizontal phone offset in set px (use buzzOffset()). */
  buzz?: number;
  /** 0..1 screen level multiplier (snap to black, the glow dying, a missed-call pulse). */
  screen?: number;
  /** The LED wall clock, e.g. '2:13'. Also the phone's status-bar time unless statusTime is set. */
  clock?: string;
  statusTime?: string;
  /** 0..1 neon level of the sign in the window (dips, flicker). */
  windowNeon?: number;
  /** 0..1 neon level of the sign behind the door glass. */
  doorNeon?: number;
  /** 0..1 cross glint on the sedan's windshield across the road. */
  glint?: number;
  /** Blur (set px) on the phone + cradle, for S19's soft-focus foreground. */
  phoneBlur?: number;
  /** Seconds for drifting dust motes (S03, S08). Omit for none. */
  dust?: number;
  /** Camera. HOOK_CROP (identity) by default. */
  crop?: Crop;
};

const DEFAULT_NUMBER = {red: '(928) 555-0147', teal: '(928) 555-0163'} as const;

// ─── Small pieces ───────────────────────────────────────────────────────────

/** Lucide-style handset glyph on a 24-unit grid. */
const HANDSET =
  'M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z';

const Handset: React.FC<{x: number; y: number; size: number; color: string; rotate?: number; width?: number; fill?: string}> = ({x, y, size, color, rotate = 0, width = 2, fill = 'none'}) => (
  <g transform={`translate(${x} ${y}) rotate(${rotate}) scale(${size / 24}) translate(-12 -12)`}>
    <path d={HANDSET} fill={fill} stroke={color} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" />
  </g>
);

// 7-segment digits (slanted), for the LED clock.
const SEGS: Record<string, string> = {'0': 'abcdef', '1': 'bc', '2': 'abged', '3': 'abgcd', '4': 'fgbc', '5': 'afgcd', '6': 'afgedc', '7': 'abc', '8': 'abcdefg', '9': 'abcfgd'};
const segPolys = (x: number, y: number, w: number, h: number, t: number) => {
  const sk = 0.12; // slant
  const P = (px: number, py: number) => `${(x + px + (h - py) * sk).toFixed(1)},${(y + py).toFixed(1)}`;
  const m = h / 2;
  const hz = (yy: number) => [P(t * 0.6, yy), P(t * 1.1, yy - t / 2), P(w - t * 1.1, yy - t / 2), P(w - t * 0.6, yy), P(w - t * 1.1, yy + t / 2), P(t * 1.1, yy + t / 2)].join(' ');
  const vt = (xx: number, y0: number, y1: number) => [P(xx, y0 + t * 0.6), P(xx + t / 2, y0 + t * 1.1), P(xx + t / 2, y1 - t * 1.1), P(xx, y1 - t * 0.6), P(xx - t / 2, y1 - t * 1.1), P(xx - t / 2, y0 + t * 1.1)].join(' ');
  return {a: hz(t / 2), g: hz(m), d: hz(h - t / 2), f: vt(t / 2, 0, m), b: vt(w - t / 2, 0, m), e: vt(t / 2, m, h), c: vt(w - t / 2, m, h)} as Record<string, string>;
};

const LedClock: React.FC<{text: string; color: string; core: string; glow: string; x: number; y: number}> = ({text, color, core, glow, x, y}) => {
  const w = 160;
  const h = 64;
  const chars = [...text];
  const dw = 27;
  const dh = 42;
  const gap = 8;
  const colonW = 12;
  const total = chars.reduce((a, c) => a + (c === ':' ? colonW : dw) + gap, -gap);
  let cx = x + (w - total) / 2;
  const lit: string[] = [];
  const unlit: string[] = [];
  const dots: Array<[number, number]> = [];
  for (const c of chars) {
    if (c === ':') {
      dots.push([cx + colonW / 2 + 2, y + h / 2 - 9], [cx + colonW / 2, y + h / 2 + 9]);
      cx += colonW + gap;
      continue;
    }
    const polys = segPolys(cx, y + (h - dh) / 2, dw, dh, 5.5);
    for (const s of 'abcdefg') (SEGS[c]?.includes(s) ? lit : unlit).push(polys[s]);
    cx += dw + gap;
  }
  return (
    <g>
      <rect x={x - 3} y={y - 3} width={w + 6} height={h + 6} rx={10} fill={mix(NIGHT.ink, NIGHT.wall, 0.8)} />
      <rect x={x} y={y} width={w} height={h} rx={7} fill={NIGHT.ink} />
      <rect x={x + 4} y={y + 4} width={w - 8} height={h - 8} rx={5} fill={mix(NIGHT.ink, color, 0.06)} />
      {unlit.map((p, i) => (
        <polygon key={`u${i}`} points={p} fill={alpha(color, 0.07)} />
      ))}
      <g filter={`url(#${glow})`} opacity={0.9}>
        {lit.map((p, i) => (
          <polygon key={`g${i}`} points={p} fill={color} />
        ))}
        {dots.map(([dx, dy], i) => (
          <circle key={`gd${i}`} cx={dx} cy={dy} r={3.2} fill={color} />
        ))}
      </g>
      {lit.map((p, i) => (
        <polygon key={`l${i}`} points={p} fill={core} />
      ))}
      {dots.map(([dx, dy], i) => (
        <circle key={`d${i}`} cx={dx} cy={dy} r={3} fill={core} />
      ))}
      <path d={`M${x + 6} ${y + 6} L${x + w - 30} ${y + 6}`} stroke={alpha(NIGHT.ivory, 0.08)} strokeWidth={2} strokeLinecap="round" />
    </g>
  );
};

// ─── The art ────────────────────────────────────────────────────────────────

/**
 * The lobby as an SVG <g> in set units, with no camera. Embed it anywhere
 * (Highway's S27 facade and the car's windshield view reuse it).
 */
export const LobbyArt: React.FC<Omit<LobbyProps, 'crop'>> = ({
  tint = 'red',
  label,
  windowView,
  phoneState = 'ringing',
  screenNumber,
  missedLabel = 'Missed call',
  missedTime = '2:14',
  missedAt = '2:13 AM',
  ringPulse = 0,
  buzz = 0,
  screen = 1,
  clock = '2:13',
  statusTime,
  windowNeon = 1,
  doorNeon = 1,
  glint = 0,
  phoneBlur = 0,
  dust,
}) => {
  const uid = useUid('lb');
  const T = TINT[tint];
  const K = T.key;
  const lbl = label ?? (tint === 'red' ? 'tape' : 'printed');
  const view: WindowView = windowView ?? (tint === 'red' ? 'starlite' : 'none');
  const number = screenNumber ?? DEFAULT_NUMBER[tint];
  const id = (s: string) => `${uid}${s}`;
  const url = (s: string) => `url(#${uid}${s})`;

  const lit = phoneState === 'dark' ? 0 : phoneState === 'missed' ? 0.42 * clamp01(screen) : clamp01(screen);
  const bloomK = lit * (1 + 0.15 * clamp01(ringPulse));
  const winNeon = clamp01(windowNeon);
  // the far sign's colour lights the window side of the room
  const farRed = view === 'ritas' || (view === 'none' && tint === 'teal');
  const farColor = farRed ? NIGHT.red : NIGHT.teal;
  const farSoft = farRed ? NIGHT.redSoft : NIGHT.tealSoft;
  const wood = mix(NIGHT.brass, NIGHT.ink, 0.8);
  const woodDark = mix(NIGHT.brass, NIGHT.ink, 0.88);
  const ledColor = tint === 'red' ? NIGHT.red : NIGHT.tealSoft;
  const ledCore = tint === 'red' ? mix(NIGHT.redSoft, NIGHT.ivory, 0.35) : mix(NIGHT.tealSoft, NIGHT.ivory, 0.45);
  const S = LOBBY.screen;
  const P = LOBBY.phone;
  const W = LOBBY.window;

  // wall panel grooves
  const grooves = Array.from({length: Math.ceil((LOBBY_SET.x1 - LOBBY_SET.x0) / 84)}, (_, i) => LOBBY_SET.x0 + 30 + i * 84);
  const slats = Array.from({length: Math.ceil((LOBBY_SET.x1 - LOBBY_SET.x0) / 62)}, (_, i) => LOBBY_SET.x0 + 20 + i * 62);

  const tape = layoutHand('FRONT DESK', {size: 13.5, x: 446, y: 1098, slant: 0.1, tracking: 0.1, jitter: 0.03, rotate: -2, seed: 'tape'});

  return (
    <g>
      <defs>
        <linearGradient id={id('wall')} x1="0" y1={LOBBY_SET.y0} x2="0" y2={1080} gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={mix(NIGHT.ink, NIGHT.wall, 0.4)} />
          <stop offset="0.14" stopColor={NIGHT.wall} />
          <stop offset="1" stopColor={NIGHT.wallLow} />
        </linearGradient>
        <radialGradient id={id('spill')} cx={20} cy={820} r={1180} gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={K} stopOpacity={0.52 * doorNeon} />
          <stop offset="0.16" stopColor={K} stopOpacity={0.32 * doorNeon} />
          <stop offset="0.38" stopColor={K} stopOpacity={0.12 * doorNeon} />
          <stop offset="0.65" stopColor={K} stopOpacity={0.03 * doorNeon} />
          <stop offset="1" stopColor={K} stopOpacity={0} />
        </radialGradient>
        <radialGradient id={id('led')} cx={255} cy={790} r={150} gradientTransform="translate(0 790) scale(1 0.45) translate(0 -790)" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={ledColor} stopOpacity={0.16} />
          <stop offset="1" stopColor={ledColor} stopOpacity={0} />
        </radialGradient>
        <linearGradient id={id('haze')} x1="0" y1={LOBBY_SET.y0} x2="0" y2={1080} gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={NIGHT.ink} stopOpacity={0.85} />
          <stop offset="0.3" stopColor={NIGHT.ink} stopOpacity={0.55} />
          <stop offset="0.55" stopColor={NIGHT.ink} stopOpacity={0.22} />
          <stop offset="0.78" stopColor={NIGHT.ink} stopOpacity={0} />
          <stop offset="1" stopColor={NIGHT.ink} stopOpacity={0} />
        </linearGradient>
        <linearGradient id={id('dimR')} x1="980" y1="0" x2={LOBBY_SET.x1} y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={NIGHT.ink} stopOpacity={0} />
          <stop offset="1" stopColor={NIGHT.ink} stopOpacity={0.55} />
        </linearGradient>
        <filter id={id('shadow')} x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation={12} />
        </filter>
        <filter id={id('bloom')} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation={26} />
        </filter>
        <clipPath id={id('ctop')}>
          <rect x={LOBBY_SET.x0} y={1076} width={LOBBY_SET.x1 - LOBBY_SET.x0} height={54} />
        </clipPath>
        <radialGradient id={id('halo')} cx={505} cy={880} r={380} gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={T.bloom} stopOpacity={0.3} />
          <stop offset="0.35" stopColor={T.bloom} stopOpacity={0.12} />
          <stop offset="1" stopColor={T.bloom} stopOpacity={0} />
        </radialGradient>
        <radialGradient id={id('pool')} cx={505} cy={1094} r={300} gradientTransform="translate(0 1094) scale(1 0.16) translate(0 -1094)" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={T.bloom} stopOpacity={0.95} />
          <stop offset="0.35" stopColor={T.bloom} stopOpacity={0.42} />
          <stop offset="1" stopColor={T.bloom} stopOpacity={0} />
        </radialGradient>
        <radialGradient id={id('winspill')} cx={835} cy={790} r={420} gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={farColor} stopOpacity={0.14 * winNeon} />
          <stop offset="1" stopColor={farColor} stopOpacity={0} />
        </radialGradient>
        <linearGradient id={id('top')} x1="0" y1="1076" x2="0" y2="1110" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={woodDark} />
          <stop offset="1" stopColor={wood} />
        </linearGradient>
        <linearGradient id={id('rim')} x1={LOBBY_SET.x0} y1="0" x2={LOBBY_SET.x1} y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={T.soft} stopOpacity={0.55} />
          <stop offset="0.22" stopColor={T.soft} stopOpacity={0.95} />
          <stop offset="0.4" stopColor={mix(T.soft, T.bloom, 0.6)} stopOpacity={0.6 + 0.4 * lit} />
          <stop offset="0.6" stopColor={T.soft} stopOpacity={0.45} />
          <stop offset="1" stopColor={T.soft} stopOpacity={0.2} />
        </linearGradient>
        <linearGradient id={id('face')} x1="0" y1="1130" x2="0" y2={LOBBY_SET.y1} gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={NIGHT.wall} />
          <stop offset="0.5" stopColor={mix(NIGHT.wall, NIGHT.ink, 0.6)} />
          <stop offset="1" stopColor={NIGHT.ink} />
        </linearGradient>
        <linearGradient id={id('under')} x1="0" y1="1128" x2="0" y2="1180" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={NIGHT.ink} stopOpacity={0.9} />
          <stop offset="1" stopColor={NIGHT.ink} stopOpacity={0} />
        </linearGradient>
        <linearGradient id={id('bezel')} x1="405" y1="0" x2="605" y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={mix(SHADE.bezel, K, 0.18)} />
          <stop offset="0.12" stopColor={SHADE.bezel} />
          <stop offset="0.85" stopColor={mix(SHADE.bezel, NIGHT.ink, 0.4)} />
          <stop offset="1" stopColor={mix(SHADE.bezel, T.bloom, 0.1)} />
        </linearGradient>
        <linearGradient id={id('dark')} x1="415" y1="724" x2="595" y2="1064" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={mix(NIGHT.ink, K, 0.12)} />
          <stop offset="0.35" stopColor={NIGHT.ink} />
          <stop offset="0.55" stopColor={mix(NIGHT.ink, NIGHT.wallLow, 0.8)} />
          <stop offset="0.6" stopColor={NIGHT.ink} />
          <stop offset="1" stopColor={NIGHT.ink} />
        </linearGradient>
        <linearGradient id={id('lock')} x1="0" y1="724" x2="0" y2="1064" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={mix(NIGHT.ink, T.deep, 0.9)} />
          <stop offset="1" stopColor={mix(NIGHT.ink, NIGHT.wallLow, 0.5)} />
        </linearGradient>
        <radialGradient id={id('brass')} cx={281} cy={1064} r={50} gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={NIGHT.brassLight} />
          <stop offset="0.45" stopColor={NIGHT.brass} />
          <stop offset="1" stopColor={mix(NIGHT.brass, NIGHT.ink, 0.62)} />
        </radialGradient>
        <linearGradient id={id('cradle')} x1="0" y1="1036" x2="0" y2="1108" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={mix(NIGHT.ink, NIGHT.wallLow, 0.9)} />
          <stop offset="1" stopColor={NIGHT.ink} />
        </linearGradient>
        <linearGradient id={id('chair')} x1="0" y1="934" x2="0" y2="1076" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={mix(NIGHT.ink, T.deep, 0.7)} />
          <stop offset="1" stopColor={NIGHT.ink} />
        </linearGradient>
        <linearGradient id={id('doorglass')} x1="0" y1="560" x2="0" y2="1080" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={mix(NIGHT.ink, T.deep, 0.75)} />
          <stop offset="0.45" stopColor={mix(NIGHT.ink, T.deep, 1)} />
          <stop offset="1" stopColor={mix(NIGHT.ink, T.deep, 0.5)} />
        </linearGradient>
        <linearGradient id={id('sky')} x1="0" y1="620" x2="0" y2="880" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={NIGHT.ink} />
          <stop offset="0.75" stopColor={mix(NIGHT.wall, farColor, 0.1)} />
          <stop offset="1" stopColor={mix(NIGHT.wall, farColor, 0.22)} />
        </linearGradient>
        <linearGradient id={id('streak')} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor={NIGHT.ivory} stopOpacity={0} />
          <stop offset="0.5" stopColor={NIGHT.ivory} stopOpacity={0.07} />
          <stop offset="1" stopColor={NIGHT.ivory} stopOpacity={0} />
        </linearGradient>
        <linearGradient id={id('page')} x1="650" y1="0" x2="860" y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={mix(mix(NIGHT.paper, K, 0.3), T.bloom, 0.25 * lit)} />
          <stop offset="0.45" stopColor={mix(NIGHT.paper, K, 0.26)} />
          <stop offset="0.5" stopColor={mix(mix(NIGHT.paper, K, 0.3), NIGHT.ink, 0.45)} />
          <stop offset="0.55" stopColor={mix(NIGHT.paper, K, 0.3)} />
          <stop offset="1" stopColor={mix(mix(NIGHT.paper, K, 0.35), NIGHT.ink, 0.35)} />
        </linearGradient>
        <filter id={id('blur6')} x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation={6} />
        </filter>
        <filter id={id('glow')} x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation={5} />
        </filter>
        {phoneBlur > 0.05 ? (
          <filter id={id('soft')} x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation={phoneBlur} />
          </filter>
        ) : null}
        <clipPath id={id('win')}>
          <rect x={W.x} y={W.y} width={W.w} height={W.h} />
        </clipPath>
        <clipPath id={id('door')}>
          <rect x={-70} y={560} width={200} height={520} />
        </clipPath>
        <clipPath id={id('scr')}>
          <rect x={S.x} y={S.y} width={S.w} height={S.h} rx={18} />
        </clipPath>
      </defs>

      {/* ── wall ───────────────────────────────────────────────── */}
      <rect x={LOBBY_SET.x0} y={LOBBY_SET.y0} width={LOBBY_SET.x1 - LOBBY_SET.x0} height={1080 - LOBBY_SET.y0} fill={url('wall')} />
      <rect x={LOBBY_SET.x0} y={LOBBY_SET.y0} width={LOBBY_SET.x1 - LOBBY_SET.x0} height={1080 - LOBBY_SET.y0} fill={T.deep} opacity={0.22} />
      {grooves.map((x) => {
        const near = Math.max(0, 1 - Math.abs(x - 20) / 900);
        return (
          <g key={x}>
            <rect x={x} y={134} width={3} height={946} fill={alpha(NIGHT.ink, 0.55)} />
            <rect x={x + 3} y={134} width={1.4} height={946} fill={alpha(T.soft, (0.035 + 0.16 * near * near) * doorNeon)} />
          </g>
        );
      })}
      {/* ceiling + crown */}
      <rect x={LOBBY_SET.x0} y={LOBBY_SET.y0} width={LOBBY_SET.x1 - LOBBY_SET.x0} height={118 - LOBBY_SET.y0} fill={mix(NIGHT.ink, NIGHT.wall, 0.35)} />
      <rect x={LOBBY_SET.x0} y={116} width={LOBBY_SET.x1 - LOBBY_SET.x0} height={18} fill={mix(NIGHT.wall, NIGHT.wallLow, 0.5)} />
      <rect x={LOBBY_SET.x0} y={132} width={LOBBY_SET.x1 - LOBBY_SET.x0} height={2} fill={alpha(K, 0.12)} />
      <rect x={LOBBY_SET.x0} y={134} width={LOBBY_SET.x1 - LOBBY_SET.x0} height={26} fill={alpha(NIGHT.ink, 0.35)} />
      <ellipse cx={505} cy={118} rx={74} ry={13} fill={mix(NIGHT.ink, NIGHT.grey, 0.12)} />
      <ellipse cx={505} cy={121} rx={60} ry={8} fill={mix(NIGHT.ink, NIGHT.grey, 0.2)} />

      {/* light on the wall: neon through the door, the phone, the far sign */}
      <rect x={LOBBY_SET.x0} y={LOBBY_SET.y0} width={LOBBY_SET.x1 - LOBBY_SET.x0} height={1080 - LOBBY_SET.y0} fill={url('spill')} />
      <circle cx={835} cy={790} r={420} fill={url('winspill')} />
      {lit > 0 ? <circle cx={505} cy={880} r={380} fill={url('halo')} opacity={bloomK} /> : null}

      {/* ── cast shadows on the wall (the door neon is the key light, from the left) ── */}
      <g filter={url('shadow')} fill={NIGHT.ink} opacity={0.55 * doorNeon}>
        <rect x={P.x + 44} y={P.y + 14} width={P.w} height={P.h - 40} rx={30} />
        <rect x={198} y={822} width={150} height={168} rx={6} />
        <rect x={189} y={728} width={160} height={64} rx={8} />
        <path d="M720 1078 C714 1012 716 968 733 950 C750 932 802 930 819 946 C836 962 840 1012 834 1078 Z" />
        <rect x={W.x - 2} y={W.y + W.h + 22} width={W.w + 60} height={30} />
      </g>
      <rect x={LOBBY_SET.x0} y={LOBBY_SET.y0} width={LOBBY_SET.x1 - LOBBY_SET.x0} height={1080 - LOBBY_SET.y0} fill={url('haze')} />
      <rect x={980} y={LOBBY_SET.y0} width={LOBBY_SET.x1 - 980} height={1080 - LOBBY_SET.y0} fill={url('dimR')} />

      {/* ── left of the door: a framed print and a brochure rack ─── */}
      <g>
        <rect x={-476} y={468} width={190} height={146} rx={4} fill={mix(NIGHT.ink, NIGHT.wall, 0.5)} />
        <rect x={-464} y={480} width={166} height={122} fill={mix(NIGHT.wall, T.deep, 0.5)} />
        <path d="M-464 580 L-430 548 L-404 556 L-380 532 L-356 534 L-338 520 L-298 552 L-298 602 L-464 602 Z" fill={mix(NIGHT.ink, T.deep, 0.4)} />
        <rect x={-292} y={468} width={4} height={146} fill={alpha(K, 0.35 * doorNeon)} />
        <g>
          <rect x={-430} y={790} width={160} height={226} rx={4} fill="none" stroke={mix(NIGHT.ink, NIGHT.grey, 0.25)} strokeWidth={3} />
          {[0, 1, 2].map((r) =>
            [0, 1, 2].map((c) => (
              <g key={`${r}${c}`}>
                <rect x={-422 + c * 51} y={800 + r * 72} width={44} height={60} rx={2} fill={mix(NIGHT.ink, [NIGHT.paper, NIGHT.brass, NIGHT.tealSoft][(r + c) % 3], 0.16)} />
                <rect x={-422 + c * 51 + 40} y={800 + r * 72} width={4} height={60} fill={alpha(K, 0.3 * doorNeon)} />
              </g>
            )),
          )}
          {[0, 1, 2].map((r) => (
            <rect key={r} x={-432} y={846 + r * 72} width={164} height={4} fill={mix(NIGHT.ink, NIGHT.grey, 0.3)} />
          ))}
        </g>
      </g>

      {/* ── glass door with the back of the neon sign ──────────── */}
      <g>
        <rect x={-92} y={538} width={244} height={545} fill={mix(NIGHT.ink, NIGHT.wall, 0.4)} />
        <rect x={-70} y={560} width={200} height={520} fill={url('doorglass')} />
        <g clipPath={url('door')}>
          <ellipse cx={30} cy={740} rx={170} ry={150} fill={K} opacity={0.22 * doorNeon} filter={url('blur6')} />
          {/* the sign hangs in the glass facing out: we read its back, mirror-reversed, out of focus */}
          <g transform="translate(60 0) scale(-1 1)" filter={url('blur6')} opacity={0.95}>
            <rect x={-82} y={658} width={164} height={130} rx={14} fill="none" stroke={K} strokeWidth={4} opacity={0.75 * doorNeon} />
            {tint === 'red' ? (
              <>
                <text x={0} y={722} textAnchor="middle" fontFamily={FONT.display} fontStyle="italic" fontWeight={700} fontSize={54} fill={mix(K, T.soft, 0.6)} opacity={doorNeon}>
                  Rita’s
                </text>
                <text x={0} y={764} textAnchor="middle" fontFamily={FONT.tight} fontWeight={800} fontSize={25} letterSpacing={2} fill={mix(K, T.soft, 0.5)} opacity={doorNeon}>
                  MOTOR INN
                </text>
              </>
            ) : (
              <>
                <text x={0} y={716} textAnchor="middle" fontFamily={FONT.tight} fontWeight={900} fontSize={38} fill={mix(K, T.soft, 0.6)} opacity={doorNeon}>
                  STARLITE
                </text>
                <text x={0} y={760} textAnchor="middle" fontFamily={FONT.tight} fontWeight={800} fontSize={20} letterSpacing={2.5} fill={mix(K, T.soft, 0.5)} opacity={doorNeon}>
                  MOTOR COURT
                </text>
              </>
            )}
          </g>
          {/* glass sheen + reflection of the phone */}
          <path d="M-70 980 L130 640 L130 700 L-70 1040 Z" fill={alpha(NIGHT.ivory, 0.035)} />
          <ellipse cx={110} cy={900} rx={30} ry={60} fill={T.bloom} opacity={0.06 * lit} />
        </g>
        {/* frame highlights */}
        <rect x={130} y={560} width={4} height={520} fill={alpha(T.soft, 0.55 * doorNeon)} />
        <rect x={-70} y={556} width={200} height={4} fill={alpha(T.soft, 0.25 * doorNeon)} />
        {/* push bar */}
        <rect x={-58} y={868} width={176} height={14} rx={7} fill={mix(NIGHT.ink, NIGHT.grey, 0.35)} />
        <rect x={-56} y={868} width={172} height={4} rx={2} fill={alpha(T.soft, 0.7 * doorNeon)} />
        <rect x={-60} y={862} width={10} height={26} rx={3} fill={mix(NIGHT.ink, NIGHT.grey, 0.3)} />
        <rect x={110} y={862} width={10} height={26} rx={3} fill={mix(NIGHT.ink, NIGHT.grey, 0.3)} />
        {/* small hours sticker (back side: blank) */}
        <rect x={86} y={930} width={34} height={44} rx={3} fill={alpha(NIGHT.paper, 0.12)} />
      </g>

      {/* ── LED clock + key rack ───────────────────────────────── */}
      <LedClock text={clock} color={ledColor} core={ledCore} glow={id('glow')} x={LOBBY.clock.x} y={LOBBY.clock.y} />
      <ellipse cx={255} cy={790} rx={150} ry={68} fill={url('led')} />
      <g>
        <rect x={182} y={812} width={150} height={168} rx={6} fill={woodDark} />
        <rect x={188} y={818} width={138} height={156} rx={4} fill={wood} />
        <rect x={182} y={812} width={150} height={3} fill={alpha(T.soft, 0.25)} />
        <rect x={182} y={812} width={3} height={168} fill={alpha(T.soft, 0.4 * doorNeon)} />
        {[0, 1].map((r) =>
          [0, 1, 2, 3].map((c) => {
            const kx = 208 + c * 33;
            const ky = 834 + r * 76;
            const sway = (random(`key${r}${c}`) - 0.5) * 6;
            return (
              <g key={`${r}${c}`} transform={`rotate(${sway} ${kx} ${ky})`}>
                <circle cx={kx} cy={ky} r={2.6} fill={mix(NIGHT.brass, NIGHT.ink, 0.4)} />
                <circle cx={kx} cy={ky + 8} r={5.5} fill="none" stroke={NIGHT.brass} strokeWidth={1.8} opacity={0.85} />
                <rect x={kx - 2} y={ky + 13} width={4} height={20} rx={1} fill={mix(NIGHT.brass, NIGHT.ink, 0.25)} />
                <path d={`M${kx + 2} ${ky + 25} h4 v3 h-2 v3 h2 v2 h-4 Z`} fill={mix(NIGHT.brass, NIGHT.ink, 0.25)} />
                <path d={`M${kx} ${ky + 35} l10 12 l-10 12 l-10 -12 Z`} fill={mix(NIGHT.ink, T.deep, 0.55)} stroke={alpha(T.soft, 0.2)} strokeWidth={1} />
                <circle cx={kx} cy={ky + 47} r={1.8} fill={NIGHT.brass} opacity={0.45} />
                <rect x={kx - 2} y={ky + 13} width={1.4} height={20} fill={alpha(NIGHT.brassLight, 0.8)} />
              </g>
            );
          }),
        )}
      </g>

      {/* ── window ─────────────────────────────────────────────── */}
      <g>
        <rect x={W.x - 16} y={W.y - 16} width={W.w + 32} height={W.h + 30} rx={4} fill={mix(NIGHT.ink, NIGHT.wall, 0.45)} />
        <g clipPath={url('win')}>
          <rect x={W.x} y={W.y} width={W.w} height={W.h} fill={url('sky')} />
          {view === 'none' ? (
            <g>
              {Array.from({length: 25}, (_, i) => (
                <g key={i}>
                  <rect x={W.x} y={W.y + i * 14} width={W.w} height={11} fill={mix(NIGHT.wall, farColor, 0.06 + 0.05 * winNeon * (1 - i / 30))} />
                  <rect x={W.x} y={W.y + i * 14 + 11} width={W.w} height={3} fill={alpha(farSoft, (0.18 + 0.12 * Math.sin(i * 1.7)) * winNeon)} />
                </g>
              ))}
              <ellipse cx={W.x + W.w * 0.6} cy={W.y + W.h * 0.45} rx={150} ry={120} fill={farColor} opacity={0.12 * winNeon} filter={url('blur6')} />
            </g>
          ) : (
            <WindowView view={view} neon={winNeon} uid={uid} glint={glint} />
          )}
          {/* glass reflections */}
          <path d={`M${W.x + 40} ${W.y + W.h} L${W.x + 200} ${W.y} L${W.x + 250} ${W.y} L${W.x + 90} ${W.y + W.h} Z`} fill={url('streak')} />
          <path d={`M${W.x + 230} ${W.y + W.h} L${W.x + 350} ${W.y + 60} L${W.x + 350} ${W.y + 110} L${W.x + 255} ${W.y + W.h} Z`} fill={url('streak')} />
          <rect x={W.x} y={W.y} width={W.w} height={W.h} fill={K} opacity={0.035} />
          {/* raised venetian blind */}
          <rect x={W.x} y={W.y} width={W.w} height={30} fill={mix(NIGHT.wall, NIGHT.wallLow, 0.6)} />
          {[0, 1, 2, 3, 4].map((i) => (
            <rect key={i} x={W.x} y={W.y + 4 + i * 6} width={W.w} height={1.4} fill={alpha(NIGHT.ink, 0.6)} />
          ))}
          <rect x={W.x} y={W.y + 30} width={W.w} height={4} fill={mix(NIGHT.wallLow, K, 0.15)} />
          <path d={`M${W.x + W.w - 22} ${W.y + 34} V${W.y + 250}`} stroke={alpha(NIGHT.grey, 0.4)} strokeWidth={1.2} />
          <rect x={W.x + W.w - 25} y={W.y + 248} width={6} height={14} rx={3} fill={alpha(NIGHT.grey, 0.45)} />
        </g>
        {/* frame + sill */}
        <rect x={W.x - 2} y={W.y - 2} width={W.w + 4} height={W.h + 4} fill="none" stroke={mix(NIGHT.ink, NIGHT.grey, 0.18)} strokeWidth={4} />
        <rect x={W.x - 16} y={W.y - 16} width={4} height={W.h + 30} fill={alpha(T.soft, 0.22 * doorNeon)} />
        <rect x={W.x - 26} y={W.y + W.h} width={W.w + 52} height={22} rx={3} fill={mix(NIGHT.wall, NIGHT.wallLow, 0.8)} />
        <rect x={W.x - 26} y={W.y + W.h} width={W.w + 52} height={3} fill={alpha(farSoft, 0.35 * winNeon)} />
        <rect x={W.x - 26} y={W.y + W.h + 22} width={W.w + 52} height={16} fill={alpha(NIGHT.ink, 0.45)} />
      </g>

      {/* ── right of the window: calendar, plant ───────────────── */}
      <g>
        <circle cx={1356} cy={630} r={3} fill={mix(NIGHT.ink, NIGHT.grey, 0.4)} />
        <rect x={1290} y={638} width={132} height={190} rx={2} fill={mix(NIGHT.ink, NIGHT.paper, 0.2)} />
        <rect x={1298} y={646} width={116} height={78} fill={mix(NIGHT.ink, T.deep, 0.7)} />
        <path d="M1298 724 L1326 692 L1342 702 L1366 674 L1394 708 L1414 694 L1414 724 Z" fill={alpha(NIGHT.ink, 0.6)} />
        {Array.from({length: 5}, (_, r) =>
          Array.from({length: 7}, (_, c) => <rect key={`${r}${c}`} x={1300 + c * 16} y={736 + r * 17} width={13} height={13} fill={alpha(NIGHT.ink, 0.35)} />),
        )}
        <ellipse cx={1374.5} cy={798.5} rx={10} ry={9} fill="none" stroke={K} strokeWidth={2} opacity={0.6} />
      </g>
      <g>
        {[
          [1150, 700, -6, 26],
          [1118, 760, -16, 22],
          [1186, 742, 10, 24],
          [1092, 830, -26, 20],
          [1214, 812, 22, 21],
          [1166, 870, 2, 18],
          [1238, 890, 30, 17],
        ].map(([tx, ty, lean, w], i) => {
          const bx = 1160 + (i - 3) * 9;
          const d = `M${bx - w / 2} 1080 Q${bx + lean * 0.4 - w * 0.6} ${(ty + 1080) / 2} ${tx + lean} ${ty} Q${bx + lean * 0.4 + w * 0.6} ${(ty + 1080) / 2} ${bx + w / 2} 1080 Z`;
          return (
            <g key={i}>
              <path d={d} fill={mix(NIGHT.ink, mix(NIGHT.wall, T.deep, 0.35), 0.5 + (i % 3) * 0.18)} />
              <path d={`M${bx - w / 2} 1080 Q${bx + lean * 0.4 - w * 0.6} ${(ty + 1080) / 2} ${tx + lean} ${ty}`} fill="none" stroke={alpha(farSoft, 0.28 * winNeon)} strokeWidth={1.5} />
            </g>
          );
        })}
      </g>

      {/* ── behind the counter: the empty chair ─────────────────── */}
      <g>
        <path d="M694 1078 C688 1012 690 968 707 950 C724 932 776 930 793 946 C810 962 814 1012 808 1078 Z" fill={url('chair')} />
        <path d="M706 1078 C702 1020 704 980 716 966 C730 952 772 950 786 964 C798 978 800 1020 796 1078" fill="none" stroke={alpha(NIGHT.ink, 0.6)} strokeWidth={2} />
        <path d="M707 950 C724 932 776 930 793 946" fill="none" stroke={alpha(farSoft, 0.7 * winNeon)} strokeWidth={2.4} strokeLinecap="round" />
        <path d="M694 1078 C688 1012 690 968 707 950" fill="none" stroke={alpha(T.soft, 0.45 * doorNeon)} strokeWidth={2} />
        <rect x={664} y={1050} width={40} height={11} rx={5} fill={mix(NIGHT.ink, NIGHT.wallLow, 0.6)} />
        <rect x={664} y={1050} width={40} height={2} rx={1} fill={alpha(T.soft, 0.4)} />
        <rect x={800} y={1054} width={38} height={11} rx={5} fill={mix(NIGHT.ink, NIGHT.wallLow, 0.5)} />
      </g>

      {/* ── counter top ────────────────────────────────────────── */}
      <rect x={LOBBY_SET.x0} y={1076} width={LOBBY_SET.x1 - LOBBY_SET.x0} height={34} fill={url('top')} />
      {[1083, 1091, 1100].map((y, i) => (
        <path key={y} d={`M${LOBBY_SET.x0} ${y} C 0 ${y - 2}, 600 ${y + 2}, ${LOBBY_SET.x1} ${y - 1}`} stroke={alpha(NIGHT.ink, 0.25 + i * 0.05)} strokeWidth={1} fill="none" />
      ))}
      <rect x={LOBBY_SET.x0} y={1076} width={LOBBY_SET.x1 - LOBBY_SET.x0} height={34} fill={url('spill')} opacity={0.9} />
      {lit > 0 ? (
        <g clipPath={url('ctop')}>
          <ellipse cx={505} cy={1096} rx={330} ry={60} fill={url('pool')} opacity={Math.min(1, bloomK)} />
        </g>
      ) : null}

      {/* ── on the counter: bell, register ─────────────────────── */}
      <g>
        <ellipse cx={295} cy={1106} rx={52} ry={6} fill={alpha(NIGHT.ink, 0.6)} />
        <rect x={250} y={1094} width={90} height={14} rx={7} fill={mix(NIGHT.ink, NIGHT.wallLow, 0.6)} />
        <rect x={252} y={1094} width={86} height={3} rx={1.5} fill={alpha(T.soft, 0.4)} />
        <path d="M257 1097 C257 1068 274 1055 295 1055 C316 1055 333 1068 333 1097 Z" fill={url('brass')} />
        <path d="M257 1097 C257 1068 274 1055 295 1055" fill="none" stroke={T.soft} strokeWidth={2.2} opacity={0.85 * doorNeon} />
        <path d="M315 1060 C327 1068 333 1080 333 1097" fill="none" stroke={T.bloom} strokeWidth={2.4} opacity={0.8 * lit} />
        <path d="M258 1092 H332" stroke={alpha(NIGHT.ink, 0.35)} strokeWidth={1.4} />
        <ellipse cx={281} cy={1066} rx={8} ry={4.5} fill={NIGHT.ivory} opacity={0.65} transform="rotate(-24 281 1066)" />
        <rect x={292} y={1043} width={6} height={13} fill={mix(NIGHT.brass, NIGHT.ink, 0.45)} />
        <ellipse cx={295} cy={1043} rx={8} ry={4} fill={NIGHT.brass} />
        <ellipse cx={293} cy={1042} rx={4} ry={1.6} fill={NIGHT.brassLight} />
      </g>
      <g>
        <path d="M646 1108 L864 1108 L848 1068 L662 1068 Z" fill={mix(T.deep, NIGHT.ink, 0.35)} />
        <path d="M652 1104 L752 1101 Q757 1086 755 1066 L668 1070 Z" fill={url('page')} />
        <path d="M759 1101 L859 1104 L843 1070 L756 1066 Q754 1086 759 1101 Z" fill={url('page')} />
        {[0.2, 0.38, 0.56, 0.74, 0.9].map((t) => {
          const yl = 1070 + (1102 - 1070) * t;
          const xl = 668 - 16 * t;
          const xr = 843 + 16 * t;
          return <path key={t} d={`M${xl + 6} ${yl} L${750} ${yl - 1} M${762} ${yl - 1} L${xr - 6} ${yl}`} stroke={alpha(NIGHT.ink, 0.22)} strokeWidth={0.8} />;
        })}
        {[
          [672, 1080, 50],
          [670, 1087, 38],
          [668, 1094, 56],
          [768, 1080, 44],
        ].map(([x, y, w], i) => (
          <path key={i} d={`M${x} ${y} q${w * 0.15} -4 ${w * 0.3} 0 t${w * 0.3} 0 t${w * 0.4} -1`} fill="none" stroke={alpha(NIGHT.ink, 0.5)} strokeWidth={1.2} />
        ))}
        <path d="M790 1100 L852 1082" stroke={NIGHT.ink} strokeWidth={4.5} strokeLinecap="round" />
        <path d="M790 1100 L800 1097" stroke={NIGHT.brass} strokeWidth={4.5} strokeLinecap="round" />
        <path d="M652 1104 L668 1070" stroke={alpha(NIGHT.ivory, 0.25 * lit)} strokeWidth={1.4} />
      </g>

      {/* ── the FRONT DESK phone in its cradle ─────────────────── */}
      <g filter={phoneBlur > 0.05 ? url('soft') : undefined}>
        <ellipse cx={505} cy={1104} rx={140} ry={7} fill={alpha(NIGHT.ink, 0.7)} />
        <g transform={`translate(${buzz} 0)`}>
          <path d="M432 1060 L452 700 L558 700 L578 1060 Z" fill={NIGHT.ink} opacity={0.6} />
          <rect x={P.x} y={P.y} width={P.w} height={P.h} rx={30} fill={url('bezel')} />
          <rect x={P.x + 0.5} y={P.y + 0.5} width={P.w - 1} height={P.h - 1} rx={29.5} fill="none" stroke={alpha(T.soft, 0.32)} strokeWidth={1.4} />
          <path d={`M${P.x + 30} ${P.y + 1.5} H${P.x + P.w - 30}`} stroke={alpha(NIGHT.ivory, 0.18)} strokeWidth={1.4} />
          <rect x={P.x - 3} y={790} width={3} height={34} rx={1.5} fill={mix(SHADE.bezel, T.soft, 0.25)} />
          <rect x={P.x - 3} y={836} width={3} height={34} rx={1.5} fill={mix(SHADE.bezel, T.soft, 0.25)} />
          <rect x={P.x + P.w} y={812} width={3} height={52} rx={1.5} fill={mix(SHADE.bezel, T.bloom, 0.2)} />
          <rect x={480} y={704} width={50} height={5} rx={2.5} fill={NIGHT.ink} />
          <circle cx={548} cy={706.5} r={3.6} fill={NIGHT.ink} />
          <circle cx={547.4} cy={705.8} r={1.2} fill={alpha(T.bloom, 0.5)} />
          {lit > 0 ? <rect x={S.x - 6} y={S.y - 6} width={S.w + 12} height={S.h - 10} rx={26} fill={T.bloom} opacity={Math.min(1, 0.55 * bloomK)} filter={url('bloom')} /> : null}
          <PhoneScreen state={phoneState} lit={lit} tint={tint} number={number} statusTime={statusTime ?? clock} missedLabel={missedLabel} missedTime={missedTime} missedAt={missedAt} ringPulse={ringPulse} id={id} />
        </g>
        {/* cradle */}
        <g transform={`translate(${buzz * 0.3} 0)`}>
          <path d="M382 1108 L392 1056 Q394 1048 402 1048 L608 1048 Q616 1048 618 1056 L628 1108 Z" fill={url('cradle')} />
          <path d="M398 1052 Q398 1036 412 1036 L598 1036 Q612 1036 612 1052 L612 1060 L398 1060 Z" fill={mix(NIGHT.ink, NIGHT.wallLow, 0.75)} />
          <path d="M412 1036.8 H598" stroke={mix(T.bloom, NIGHT.ivory, 0.3)} strokeWidth={1.6} opacity={0.35 + 0.55 * lit} />
          <path d="M392 1056 Q394 1048 402 1048" fill="none" stroke={alpha(T.soft, 0.55 * doorNeon)} strokeWidth={1.6} />
          <rect x={386} y={1104} width={238} height={4} fill={alpha(NIGHT.ink, 0.6)} />
          {lbl === 'tape' ? (
            <g>
              <path d="M436 1081 L578 1076 L580 1080 L578 1084 L581 1088 L579 1092 L581 1097 L580 1101 L438 1106 L436 1102 L438 1098 L435 1093 L437 1089 L435 1085 Z" fill={mix(NIGHT.tape, K, 0.16)} />
              <path d="M438 1084 L578 1079" stroke={alpha(NIGHT.ivory, 0.25)} strokeWidth={1} />
              <path d="M440 1100 L578 1095" stroke={alpha(NIGHT.ink, 0.12)} strokeWidth={1.4} />
              <Ink layout={tape} color={NIGHT.ink} width={2.3} opacity={0.92} />
            </g>
          ) : (
            <g>
              <rect x={452} y={1080} width={106} height={20} rx={2.5} fill={mix(NIGHT.ivory, K, 0.1)} />
              <rect x={452} y={1080} width={106} height={20} rx={2.5} fill="none" stroke={alpha(NIGHT.ink, 0.25)} strokeWidth={0.8} />
              <text x={505} y={1094.5} textAnchor="middle" fontFamily={FONT.ui} fontWeight={700} fontSize={11.5} letterSpacing={2.2} fill={LIGHT.foreground}>
                FRONT DESK
              </text>
            </g>
          )}
        </g>
      </g>

      {/* ── counter edge + front face ──────────────────────────── */}
      <rect x={LOBBY_SET.x0} y={1110} width={LOBBY_SET.x1 - LOBBY_SET.x0} height={20} fill={mix(wood, NIGHT.ink, 0.15)} />
      <rect x={LOBBY_SET.x0} y={1108.5} width={LOBBY_SET.x1 - LOBBY_SET.x0} height={3.5} fill={url('rim')} />
      <rect x={LOBBY_SET.x0} y={1112} width={LOBBY_SET.x1 - LOBBY_SET.x0} height={8} fill={url('rim')} opacity={0.18} />
      <rect x={LOBBY_SET.x0} y={1130} width={LOBBY_SET.x1 - LOBBY_SET.x0} height={LOBBY_SET.y1 - 1130} fill={url('face')} />
      {slats.map((x) => (
        <g key={x}>
          <rect x={x} y={1130} width={2.5} height={LOBBY_SET.y1 - 1130} fill={alpha(NIGHT.ink, 0.6)} />
          <rect x={x + 2.5} y={1130} width={1} height={LOBBY_SET.y1 - 1130} fill={alpha(K, 0.045)} />
        </g>
      ))}
      <rect x={LOBBY_SET.x0} y={1130} width={LOBBY_SET.x1 - LOBBY_SET.x0} height={760} fill={url('spill')} opacity={0.45} />
      {/* rails */}
      {[1196, 1590].map((y) => (
        <g key={y}>
          <rect x={LOBBY_SET.x0} y={y} width={LOBBY_SET.x1 - LOBBY_SET.x0} height={16} fill={mix(NIGHT.wall, NIGHT.wallLow, 0.7)} />
          <rect x={LOBBY_SET.x0} y={y} width={LOBBY_SET.x1 - LOBBY_SET.x0} height={1.5} fill={url('rim')} opacity={0.18} />
          <rect x={LOBBY_SET.x0} y={y + 16} width={LOBBY_SET.x1 - LOBBY_SET.x0} height={14} fill={alpha(NIGHT.ink, 0.5)} />
        </g>
      ))}
      {/* a paper sign taped to the front */}
      <g transform="rotate(1.6 742 1330)">
        <rect x={672} y={1282} width={150} height={98} rx={2} fill={mix(NIGHT.paper, K, 0.18)} opacity={0.42} />
        <rect x={672} y={1282} width={150} height={98} rx={2} fill={alpha(NIGHT.ink, 0.25)} />
        <rect x={727} y={1276} width={40} height={12} fill={alpha(NIGHT.tape, 0.35)} transform="rotate(-4 747 1282)" />
        <text x={747} y={1314} textAnchor="middle" fontFamily={FONT.mono} fontWeight={700} fontSize={12} letterSpacing={1.6} fill={alpha(NIGHT.ink, 0.85)}>
          OFFICE HOURS
        </text>
        <text x={747} y={1336} textAnchor="middle" fontFamily={FONT.mono} fontWeight={500} fontSize={12} fill={alpha(NIGHT.ink, 0.8)}>
          7 AM – 11 PM
        </text>
        <path d="M694 1348 H800" stroke={alpha(NIGHT.ink, 0.4)} strokeWidth={1} />
        <text x={747} y={1366} textAnchor="middle" fontFamily={FONT.mono} fontWeight={500} fontSize={10.5} fill={alpha(NIGHT.ink, 0.75)}>
          AFTER HOURS: RING BELL
        </text>
      </g>
      <rect x={LOBBY_SET.x0} y={1128} width={LOBBY_SET.x1 - LOBBY_SET.x0} height={52} fill={url('under')} />

      {/* ── dust in the light ──────────────────────────────────── */}
      {dust !== undefined ? <Dust t={dust} color={tint === 'red' ? NIGHT.redSoft : NIGHT.tealSoft} /> : null}
    </g>
  );
};

// ─── Phone screen ───────────────────────────────────────────────────────────

const PhoneScreen: React.FC<{
  state: PhoneState;
  lit: number;
  tint: Tint;
  number: string;
  statusTime: string;
  missedLabel: string;
  missedTime: string;
  missedAt: string;
  ringPulse: number;
  id: (s: string) => string;
}> = ({state, lit, tint, number, statusTime, missedLabel, missedTime, missedAt, ringPulse, id}) => {
  const T = TINT[tint];
  const S = LOBBY.screen;
  const ink = LIGHT.foreground;
  const clip = `url(#${id('scr')})`;
  if (state === 'dark' || lit <= 0.001) {
    return (
      <g clipPath={clip}>
        <rect x={S.x} y={S.y} width={S.w} height={S.h} fill={`url(#${id('dark')})`} />
        <ellipse cx={S.x + 20} cy={S.y + 120} rx={90} ry={160} fill={T.key} opacity={0.07} />
        <path d={`M${S.x} ${S.y + 210} L${S.x + S.w} ${S.y + 40} L${S.x + S.w} ${S.y + 78} L${S.x} ${S.y + 248} Z`} fill={alpha(NIGHT.ivory, 0.045)} />
        <path d={`M${S.x} ${S.y + 262} L${S.x + S.w} ${S.y + 92} L${S.x + S.w} ${S.y + 100} L${S.x} ${S.y + 270} Z`} fill={alpha(NIGHT.ivory, 0.03)} />
        <rect x={S.x} y={S.y} width={3} height={S.h} fill={alpha(T.key, 0.3)} />
      </g>
    );
  }
  if (state === 'missed') {
    const k = Math.min(1, lit / 0.42);
    return (
      <g clipPath={clip}>
        <rect x={S.x} y={S.y} width={S.w} height={S.h} fill={`url(#${id('dark')})`} />
        <g opacity={k}>
          <rect x={S.x} y={S.y} width={S.w} height={S.h} fill={`url(#${id('lock')})`} />
          <text x={505} y={812} textAnchor="middle" fontFamily={FONT.ui} fontWeight={500} fontSize={52} letterSpacing={-1} fill={NIGHT.ivory}>
            {missedTime}
          </text>
          <rect x={S.x + 10} y={850} width={S.w - 20} height={72} rx={14} fill={alpha(NIGHT.ivory, 0.92)} />
          <circle cx={S.x + 28} cy={872} r={9} fill={LIGHT.destructive} />
          <Handset x={S.x + 28} y={872} size={11} color={NIGHT.ivory} width={2.6} />
          <text x={S.x + 43} y={877} fontFamily={FONT.ui} fontWeight={600} fontSize={13} fill={ink}>
            {missedLabel}
          </text>
          <text x={S.x + S.w - 17} y={876} textAnchor="end" fontFamily={FONT.ui} fontWeight={400} fontSize={9.5} fill={LIGHT.mutedForeground}>
            {missedAt}
          </text>
          <text x={S.x + 20} y={907} fontFamily={FONT.ui} fontWeight={500} fontSize={15} fill={LIGHT.mutedForeground}>
            {number}
          </text>
          <rect x={485} y={S.y + S.h - 40} width={40} height={4} rx={2} fill={alpha(NIGHT.ivory, 0.5)} />
        </g>
      </g>
    );
  }
  // ringing / incoming
  const rp = Math.max(0, Math.min(1, ringPulse));
  return (
    <g clipPath={clip}>
      <rect x={S.x} y={S.y} width={S.w} height={S.h} fill={mix(NIGHT.ink, T.glow, lit)} />
      <g opacity={lit}>
        <text x={S.x + 16} y={S.y + 20} fontFamily={FONT.ui} fontWeight={600} fontSize={13} fill={ink}>
          {statusTime}
        </text>
        {[0, 1, 2, 3].map((i) => (
          <rect key={i} x={S.x + S.w - 50 + i * 5} y={S.y + 16 - i * 2.5} width={3} height={4 + i * 2.5} rx={0.8} fill={ink} />
        ))}
        <rect x={S.x + S.w - 27} y={S.y + 9} width={17} height={9} rx={2.2} fill="none" stroke={ink} strokeWidth={1.2} />
        <rect x={S.x + S.w - 25} y={S.y + 11} width={9} height={5} rx={1} fill={ink} />
        <rect x={S.x + S.w - 9.5} y={S.y + 12} width={1.6} height={3} rx={0.6} fill={ink} />
        {/* handset glyph with a ring halo */}
        <circle cx={505} cy={820} r={46 + rp * 14} fill="none" stroke={LIGHT.success} strokeWidth={3} opacity={0.5 * rp} />
        <circle cx={505} cy={820} r={44} fill={LIGHT.muted} />
        <Handset x={505} y={820} size={56} color={ink} width={1.7} rotate={rp * 8 * Math.sin(rp * Math.PI * 3)} />
        <text x={505} y={902} textAnchor="middle" fontFamily={FONT.ui} fontWeight={500} fontSize={22} fill={ink}>
          Incoming call
        </text>
        <text x={505} y={936} textAnchor="middle" fontFamily={FONT.ui} fontWeight={600} fontSize={23.5} letterSpacing={-0.3} fill={ink}>
          {number}
        </text>
        <circle cx={459} cy={1000} r={23} fill={LIGHT.destructive} />
        <Handset x={459} y={1001} size={24} color={NIGHT.ivory} width={2.4} rotate={135} />
        <circle cx={551} cy={1000} r={23} fill={LIGHT.success} />
        <Handset x={551} y={1000} size={24} color={NIGHT.ivory} width={2.4} />
      </g>
    </g>
  );
};

// ─── Window view ────────────────────────────────────────────────────────────

const WindowView: React.FC<{view: 'starlite' | 'ritas'; neon: number; uid: string; glint: number}> = ({view, neon, uid, glint}) => {
  const W = LOBBY.window;
  const starlite = view === 'starlite';
  const C = starlite ? NIGHT.teal : NIGHT.red;
  const soft = starlite ? NIGHT.tealSoft : NIGHT.redSoft;
  const s = 0.62;
  const signX = starlite ? LOBBY.windowSign.x : W.x + 30;
  const signY = LOBBY.windowSign.y;
  const poleX = signX + (starlite ? 130 : 115) * s;
  // ground plane: far lot, then the road on our side
  return (
    <g>
      <Stars x={W.x} y={W.y + 30} w={W.w} h={150} n={16} seed={`win${view}`} size={1.1} opacity={0.5} />
      {/* wires */}
      <path d={`M${W.x - 10} ${W.y + 70} Q${W.x + 170} ${W.y + 100} ${W.x + W.w + 10} ${W.y + 76}`} fill="none" stroke={alpha(NIGHT.ink, 0.9)} strokeWidth={1.4} />
      <path d={`M${W.x - 10} ${W.y + 86} Q${W.x + 170} ${W.y + 118} ${W.x + W.w + 10} ${W.y + 92}`} fill="none" stroke={alpha(NIGHT.ink, 0.9)} strokeWidth={1.2} />
      {/* far mesas */}
      <path
        d={starlite ? `M${W.x} 858 L${W.x} 836 L${W.x + 40} 834 L${W.x + 52} 826 L${W.x + 104} 826 L${W.x + 118} 840 L${W.x + 160} 842 L${W.x + 170} 858 Z` : `M${W.x + 180} 858 L${W.x + 192} 838 L${W.x + 240} 836 L${W.x + 254} 826 L${W.x + 300} 828 L${W.x + 312} 842 L${W.x + W.w} 842 L${W.x + W.w} 858 Z`}
        fill={mix(NIGHT.ink, NIGHT.wall, 0.7)}
      />
      {/* far telephone poles */}
      {[0, 1, 2].map((i) => {
        const px = starlite ? W.x + 30 + i * 46 : W.x + W.w - 40 - i * 46;
        const ph = 50 - i * 12;
        return (
          <g key={i} fill={alpha(NIGHT.ink, 0.95)}>
            <rect x={px} y={858 - ph} width={2} height={ph} />
            <rect x={px - 6} y={858 - ph + 4} width={14} height={1.6} />
          </g>
        );
      })}
      {/* the far motel: a low block with a canopy and its lit office */}
      <g>
        <path d={starlite ? `M${W.x + 150} 846 L${W.x + W.w + 10} 840 L${W.x + W.w + 10} 892 L${W.x + 150} 892 Z` : `M${W.x - 10} 840 L${W.x + 200} 846 L${W.x + 200} 892 L${W.x - 10} 892 Z`} fill={mix(NIGHT.ink, NIGHT.wall, 0.85)} />
        <rect x={starlite ? W.x + 150 : W.x - 10} y={852} width={starlite ? W.w - 140 : 210} height={5} fill={mix(NIGHT.wall, C, 0.25)} />
        {Array.from({length: 5}, (_, i) => {
          const dx = starlite ? W.x + 166 + i * 34 : W.x + 6 + i * 34;
          return (
            <g key={i}>
              <rect x={dx} y={864} width={12} height={26} fill={mix(NIGHT.ink, C, 0.12)} />
              <circle cx={dx + 18} cy={862} r={1.6} fill={NIGHT.brassLight} opacity={0.75} />
            </g>
          );
        })}
        <rect x={starlite ? W.x + 306 : W.x + 152} y={864} width={30} height={19} fill={mix(NIGHT.ink, C, 0.55 + 0.25 * neon)} />
        <rect x={starlite ? W.x + 306 : W.x + 152} y={864} width={30} height={7} fill={soft} opacity={0.25 * neon} />
        <rect x={starlite ? W.x + 320 : W.x + 166} y={864} width={2} height={19} fill={NIGHT.ink} opacity={0.7} />
      </g>
      {/* lot */}
      <rect x={W.x} y={890} width={W.w} height={50} fill={mix(NIGHT.ink, NIGHT.wall, 0.6)} />
      <ellipse cx={poleX} cy={905} rx={140} ry={22} fill={C} opacity={0.16 * neon} />
      {/* sign + pole */}
      <rect x={poleX - 2.5} y={signY + 300 * s} width={5} height={892 - (signY + 300 * s)} fill={mix(NIGHT.ink, NIGHT.wall, 0.4)} />
      <g transform={`translate(${signX} ${signY}) scale(${s})`}>{starlite ? <StarliteSign on={neon} halo={0.9} /> : <RitaSign on={neon} halo={0.9} />}</g>
      {/* Rita's sedan, parked under the Starlite sign */}
      {starlite ? (
        <g transform={`translate(${LOBBY.sedan.x} ${LOBBY.sedan.y}) scale(${LOBBY.sedan.w / 300})`}>
          <Sedan flip rim={NIGHT.teal} rimAmount={0.55 + 0.35 * neon} />
        </g>
      ) : null}
      {/* the road on our side */}
      <rect x={W.x} y={938} width={W.w} height={30} fill={mix(NIGHT.ink, NIGHT.wallLow, 0.7)} />
      <rect x={W.x} y={937} width={W.w} height={1.5} fill={alpha(soft, 0.15)} />
      {Array.from({length: 6}, (_, i) => (
        <rect key={i} x={W.x + 10 + i * 64} y={950} width={34} height={2.5} fill={alpha(NIGHT.grey, 0.22)} />
      ))}
      {starlite && glint > 0 ? (
        <g transform={`translate(${LOBBY.glint.x} ${LOBBY.glint.y})`}>
          <Glint size={40} amount={glint} />
        </g>
      ) : null}
      <rect x={W.x} y={W.y} width={W.w} height={W.h} fill={`url(#${uid}sky)`} opacity={0} />
    </g>
  );
};

// ─── Dust motes ─────────────────────────────────────────────────────────────

const Dust: React.FC<{t: number; color: string}> = ({t, color}) => (
  <g>
    {Array.from({length: 56}, (_, i) => {
      const r = (k: string) => random(`dust-${i}-${k}`);
      const bx = 260 + r('x') * 560;
      const by = 640 + r('y') * 440;
      const sp = 0.15 + r('s') * 0.35;
      const x = bx + Math.sin(t * sp * 2 + r('p') * 6.28) * 18 + t * 4 * (r('d') - 0.5);
      const y = by + Math.cos(t * sp * 1.6 + r('q') * 6.28) * 10 - t * 6 * sp;
      const near = Math.max(0, 1 - Math.hypot(x - 700, y - 860) / 520);
      return <circle key={i} cx={x} cy={y} r={1.4 + r('r') * 2.6} fill={color} opacity={(0.2 + 0.7 * near) * (0.45 + 0.55 * r('o'))} />;
    })}
  </g>
);

// ─── Full-frame component ───────────────────────────────────────────────────

/**
 * The lobby as a full 1080×1920 layer. Pass `crop` for camera moves. All props
 * are optional; defaults give the S01 frame-0 look for 'red' and the S02
 * Starlite for 'teal'.
 */
export const Lobby: React.FC<LobbyProps & {style?: React.CSSProperties}> = ({crop = HOOK_CROP, style, ...rest}) => (
  <AbsoluteFill style={{background: NIGHT.ink, ...style}}>
    <svg width={1080} height={1920} viewBox="0 0 1080 1920" style={{position: 'absolute', inset: 0}}>
      <g transform={cropTransform(crop)}>
        <LobbyArt {...rest} />
      </g>
    </svg>
  </AbsoluteFill>
);
