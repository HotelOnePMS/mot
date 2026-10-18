// S06 hands: Rita's left hand cradling her phone (thumb over the left edge,
// fingertips peeking past the right edge) and her right thumb (cardigan cuff)
// hovering over / tapping the green Call button. Flat noir: near-black skin in
// shadow, a teal rim from the windshield, cool screen-light on the edges that
// face the glass. Everything is SVG in frame px; no frame reads in here.
import React from 'react';
import {DARK, NIGHT} from '../../theme.ts';
import {alpha, mix, useUid} from '../../set/parts.tsx';
import {place, shape, type C, type P} from '../../char/rig.ts';

// Rita's skin and knit, derived exactly as src/char/Rita.tsx does (tape + soft red, then into the night).
const SKIN = mix(NIGHT.tape, NIGHT.redSoft, 0.3);
export const HAND = {
  skin: mix(NIGHT.ink, SKIN, 0.2),
  skinLit: mix(NIGHT.ink, SKIN, 0.4),
  skinDeep: mix(NIGHT.ink, SKIN, 0.08),
  knit: mix(NIGHT.ink, NIGHT.redDeep, 0.95),
  knitDeep: mix(NIGHT.ink, NIGHT.redDeep, 0.5),
  knitHi: mix(NIGHT.redDeep, NIGHT.red, 0.35),
  rim: NIGHT.tealSoft,
  screen: NIGHT.phoneBloom,
  green: DARK.successSoftForeground,
} as const;

// ─── Right hand (thumb pointing up-left; local: tip at 0,0, +y toward the wrist) ─────

/** Thumb + the back of the hand with the curled index knuckle on the +x (upper-right) side. */
const RIGHT_HAND: C[] = [
  [0, -2],
  [24, 3],
  [44, 22],
  [53, 58],
  [55, 104],
  [60, 146],
  [57, 196],
  [62, 252],
  [80, 306],
  [116, 346],
  [164, 348],
  [212, 368],
  [246, 418],
  [258, 500],
  [266, 640],
  [282, 800],
  [300, 1100, 1],
  [-280, 1100, 1],
  [-206, 800],
  [-136, 620],
  [-88, 476],
  [-66, 364],
  [-58, 274],
  [-57, 204],
  [-62, 146],
  [-56, 100],
  [-52, 58],
  [-43, 22],
  [-24, 3],
];
/** The +x edge from the tip to the index knuckle (teal rim). */
const RIGHT_RIM: C[] = [
  [26, 3],
  [45, 22],
  [54, 58],
  [56, 104],
  [61, 146],
  [58, 196],
  [63, 252],
];
const INDEX_RIM: C[] = [
  [150, 350],
  [212, 368],
  [246, 418],
  [258, 500],
];
/** Thumbnail, centred on the axis just behind the tip. */
const NAIL = 'M-30 30 Q-32 10 -16 6 Q0 2 16 6 Q32 10 30 30 L28 84 Q27 96 14 98 Q0 100 -14 98 Q-27 96 -28 84 Z';

export type RightHandProps = {
  /** Thumb tip in frame px. */
  tip: P;
  /** Rotation (deg) of the thumb axis; -35 points it up-left. */
  deg?: number;
  /** Scale (z): >1 is nearer the camera (hovering), <1 pressed onto the glass. */
  scale?: number;
  /** 0..1 cool light from the screen on the edges facing it. */
  glow?: number;
};

/** Rita's right hand: thumb, curled index knuckle, cardigan cuff and sleeve running off the bottom-right. */
export const RightHand: React.FC<RightHandProps> = ({tip, deg = -35, scale = 1, glow = 1}) => {
  const uid = useUid('rh');
  return (
    <g transform={place(tip, deg, scale)}>
      <defs>
        <linearGradient id={`${uid}s`} x1="-70" y1="0" x2="70" y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={HAND.skinDeep} />
          <stop offset="0.55" stopColor={HAND.skin} />
          <stop offset="1" stopColor={mix(HAND.skinLit, NIGHT.tealSoft, 0.12)} />
        </linearGradient>
        <linearGradient id={`${uid}d`} x1="0" y1="200" x2="0" y2="900" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={NIGHT.ink} stopOpacity={0} />
          <stop offset="1" stopColor={NIGHT.ink} stopOpacity={0.85} />
        </linearGradient>
        <linearGradient id={`${uid}g`} x1="0" y1="0" x2="0" y2="420" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={HAND.screen} stopOpacity={0.75 * glow} />
          <stop offset="0.45" stopColor={HAND.screen} stopOpacity={0.22 * glow} />
          <stop offset="1" stopColor={HAND.screen} stopOpacity={0} />
        </linearGradient>
        <linearGradient id={`${uid}n`} x1="0" y1="4" x2="0" y2="100" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={mix(HAND.skinLit, NIGHT.ivory, 0.18)} />
          <stop offset="1" stopColor={mix(HAND.skin, HAND.skinLit, 0.4)} />
        </linearGradient>
        <linearGradient id={`${uid}k`} x1="-300" y1="0" x2="320" y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={HAND.knitDeep} />
          <stop offset="0.7" stopColor={HAND.knit} />
          <stop offset="1" stopColor={mix(HAND.knit, HAND.knitHi, 0.6)} />
        </linearGradient>
      </defs>
      <path d={shape(RIGHT_HAND)} fill={`url(#${uid}s)`} />
      <path d={shape(RIGHT_HAND)} fill={`url(#${uid}d)`} />
      {/* screen light wrapping the edges near the tip */}
      <path d={shape(RIGHT_HAND)} fill="none" stroke={`url(#${uid}g)`} strokeWidth={3} />
      {/* thumb / index separation and the knuckle crease */}
      <path d="M92 318 Q126 364 148 448" fill="none" stroke={NIGHT.ink} strokeWidth={5} opacity={0.55} strokeLinecap="round" />
      <path d="M-30 146 Q0 158 30 146 M-22 162 Q0 170 22 162" fill="none" stroke={NIGHT.ink} strokeWidth={2.4} opacity={0.4} strokeLinecap="round" />
      {/* nail with its free edge catching the screen */}
      <path d={NAIL} fill={`url(#${uid}n)`} />
      <path d="M-24 14 Q0 2 24 14" fill="none" stroke={NIGHT.ivory} strokeWidth={2.4} opacity={0.35 + 0.3 * glow} strokeLinecap="round" />
      <path d="M18 24 Q24 50 22 80" fill="none" stroke={NIGHT.tealSoft} strokeWidth={3} opacity={0.35} strokeLinecap="round" />
      <path d="M-26 86 Q0 100 26 86" fill="none" stroke={HAND.skinDeep} strokeWidth={2.4} opacity={0.7} strokeLinecap="round" />
      {/* the teal rim from the windshield */}
      <path d={shape(RIGHT_RIM, false)} fill="none" stroke={HAND.rim} strokeWidth={3.2} opacity={0.85} strokeLinecap="round" />
      <path d={shape(INDEX_RIM, false)} fill="none" stroke={HAND.rim} strokeWidth={2.6} opacity={0.55} strokeLinecap="round" />
      {/* cardigan cuff (ribbed) and sleeve */}
      <path d="M-262 760 Q30 730 300 772 L330 1300 L-330 1300 Z" fill={`url(#${uid}k)`} />
      <path d="M-262 760 Q30 730 300 772" fill="none" stroke={HAND.knitHi} strokeWidth={4} opacity={0.75} strokeLinecap="round" />
      {Array.from({length: 13}, (_, i) => {
        const x = -230 + i * 42;
        return <path key={i} d={`M${x} ${752 + Math.abs(x) * 0.02} L${x + 6} 880`} stroke={NIGHT.ink} strokeWidth={5} opacity={0.35} />;
      })}
      <path d="M-300 880 Q20 860 318 896" fill="none" stroke={NIGHT.ink} strokeWidth={8} opacity={0.5} />
      <path d="M300 772 L318 900" stroke={HAND.rim} strokeWidth={3} opacity={0.5} strokeLinecap="round" />
    </g>
  );
};

// ─── Left hand (phone-local px: the phone body is 526 x 1079 with its top-left at 0,0) ───

/** The left thumb lying over the phone's left edge, merging into the palm heel under the phone. Local: tip at 0,0, +y toward the wrist. */
const LEFT_THUMB: C[] = [
  [0, -2],
  [22, 3],
  [40, 22],
  [48, 58],
  [50, 104],
  [53, 146],
  [50, 200],
  [50, 262],
  [66, 330],
  [120, 404],
  [210, 468],
  [340, 516],
  [490, 552],
  [580, 612],
  [620, 1000, 1],
  [-340, 1000, 1],
  [-220, 600],
  [-124, 424],
  [-72, 304],
  [-56, 220],
  [-56, 146],
  [-50, 100],
  [-46, 58],
  [-38, 22],
  [-20, 3],
];
const LEFT_THUMB_RIM: C[] = [
  [22, 3],
  [40, 22],
  [48, 58],
  [50, 104],
  [53, 146],
  [50, 200],
  [50, 262],
  [64, 326],
];
/** Where the left thumb sits on the phone (phone-local) and its tilt. */
export const LEFT_THUMB_AT = {tip: [40, 640] as P, deg: 12};

/** The left thumb, palm heel, cuff and sleeve (drawn OVER the phone). Coordinates are phone-local. */
export const LeftHandFront: React.FC<{glow?: number}> = ({glow = 1}) => {
  const uid = useUid('lh');
  return (
    <g transform={place(LEFT_THUMB_AT.tip, LEFT_THUMB_AT.deg)}>
      <defs>
        <linearGradient id={`${uid}s`} x1="-60" y1="0" x2="60" y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={HAND.skinDeep} />
          <stop offset="0.6" stopColor={HAND.skin} />
          <stop offset="1" stopColor={mix(HAND.skin, HAND.screen, 0.1)} />
        </linearGradient>
        <linearGradient id={`${uid}d`} x1="0" y1="260" x2="0" y2="760" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={NIGHT.ink} stopOpacity={0} />
          <stop offset="1" stopColor={NIGHT.ink} stopOpacity={0.9} />
        </linearGradient>
        <linearGradient id={`${uid}n`} x1="0" y1="4" x2="0" y2="100" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={mix(HAND.skinLit, NIGHT.ivory, 0.12)} />
          <stop offset="1" stopColor={HAND.skin} />
        </linearGradient>
        <linearGradient id={`${uid}k`} x1="-340" y1="0" x2="620" y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={HAND.knitDeep} />
          <stop offset="0.6" stopColor={HAND.knit} />
          <stop offset="1" stopColor={mix(HAND.knit, HAND.knitHi, 0.45)} />
        </linearGradient>
      </defs>
      <path d={shape(LEFT_THUMB)} fill={`url(#${uid}s)`} />
      <path d={shape(LEFT_THUMB)} fill={`url(#${uid}d)`} />
      <g transform="scale(0.92 0.95) translate(0 2)">
        <path d={NAIL} fill={`url(#${uid}n)`} />
        <path d="M-24 14 Q0 2 24 14" fill="none" stroke={NIGHT.ivory} strokeWidth={2.2} opacity={0.3 + 0.25 * glow} strokeLinecap="round" />
      </g>
      <path d="M-28 150 Q0 160 28 150" fill="none" stroke={NIGHT.ink} strokeWidth={2.4} opacity={0.4} strokeLinecap="round" />
      {/* the edge facing the screen picks up its light */}
      <path d={shape(LEFT_THUMB_RIM, false)} fill="none" stroke={HAND.screen} strokeWidth={3} opacity={0.55 * glow} strokeLinecap="round" />
      <path d="M-20 3 Q-40 18 -46 58 Q-52 120 -56 220" fill="none" stroke={HAND.rim} strokeWidth={2} opacity={0.3} strokeLinecap="round" />
      {/* cuff + sleeve, off the bottom-left */}
      <path d="M-300 700 Q120 760 600 740 L640 1400 L-420 1400 Z" fill={`url(#${uid}k)`} />
      <path d="M-300 700 Q120 760 600 740" fill="none" stroke={HAND.knitHi} strokeWidth={4} opacity={0.6} />
      {Array.from({length: 18}, (_, i) => {
        const x = -270 + i * 50;
        return <path key={i} d={`M${x} ${712 + i * 1.6} L${x + 4} 840`} stroke={NIGHT.ink} strokeWidth={5} opacity={0.32} />;
      })}
    </g>
  );
};

/** Four fingertips of the left hand curling round the phone's right edge (drawn BEHIND the phone). Phone-local. */
export const LeftFingertips: React.FC = () => {
  const tips: Array<{x: number; y: number; s: number; r: number}> = [
    {x: 524, y: 548, s: 1, r: -10},
    {x: 530, y: 646, s: 1.02, r: -4},
    {x: 526, y: 744, s: 0.98, r: 2},
    {x: 514, y: 834, s: 0.88, r: 10},
  ];
  return (
    <g>
      {tips.map((t, i) => (
        <g key={i} transform={place([t.x, t.y], t.r, t.s)}>
          <path d="M-40 -46 Q30 -52 44 -6 Q48 30 22 46 Q-4 56 -40 50 Z" fill={HAND.skin} />
          <path d="M-40 -46 Q30 -52 44 -6 Q48 30 22 46 Q-4 56 -40 50 Z" fill={alpha(NIGHT.ink, 0.35)} />
          <path d="M8 -46 Q40 -36 44 -6 Q48 26 26 44" fill="none" stroke={HAND.rim} strokeWidth={2.6} opacity={0.6} strokeLinecap="round" />
          <path d="M-36 50 Q-2 54 20 46" fill="none" stroke={NIGHT.ink} strokeWidth={6} opacity={0.6} strokeLinecap="round" />
        </g>
      ))}
    </g>
  );
};
