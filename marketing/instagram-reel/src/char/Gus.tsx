// Gus (60s, owner of the Starlite Motor Court): broad, unhurried, salt-and-
// pepper hair thinning on the crown, grey stubble and a grey moustache, a Lagoon
// cardigan with the sleeves shoved up over his forearms, a chambray collar,
// reading glasses on a cord. Teal is his world.
//
//   GusDesk        the S22 desk rig, over his right shoulder: he is turned away
//                  from us toward the window (lost profile: ear, cheek, glasses,
//                  moustache), his phone up in his right hand with the screen
//                  toward him and us, so the camera can push into it; a mug in
//                  his left hand. Drawn in S22 frame px (Gus at x 40–620,
//                  y 640–1500; the phone rect is GUS_PHONE, inside the board's
//                  x 520–760, y 820–1300). Layers: 'back' (Gus, the phone body
//                  and a dark screen; draw the HotelOne screen over
//                  GUS_DESK.screen after it) and 'front' (the thumb and the
//                  fingertips that overlap the phone's edges). 'all' draws both,
//                  with `screen` (SVG in frame px) in between.
//   GusSilhouette  S23 (dawn): a dark backlit silhouette at his office window,
//                  raising the mug toward Rita's car. 'night' (Rita's red neon
//                  across the road) and hold 'binoculars' are there for S27.
//
// Light: 'dawn' = the window ahead of him, so he is backlit: a warm rim round
// his outline, the ear glowing, his back in soft room shade. 'night' = teal.
// Every moving part is a number so scenes can interpolate() it.
import React from 'react';
import {AbsoluteFill} from 'remotion';
import {LIGHT, NIGHT} from '../theme.ts';
import {alpha, mix, useUid} from '../set/parts.tsx';
import type {Crop} from '../set/Lobby.tsx';
import {add, angle, arc, breath, clamp01, ik, lerp, lerpP, norm, perp, place, rot, scaleP, shape, smoothstep, sub, tube, type C, type P} from './rig.ts';

// ─── Palette ────────────────────────────────────────────────────────────────

const SKIN = mix(mix(NIGHT.tape, NIGHT.redSoft, 0.32), LIGHT.highlightSoftForeground, 0.14);

type Pal = ReturnType<typeof palette>;
const palette = (dawn: number) => {
  const d = clamp01(dawn);
  const n = 1 - d;
  const m = (night: string, day: string) => mix(night, day, d);
  return {
    d,
    n,
    skin: m(mix(NIGHT.ink, SKIN, 0.3), mix(SKIN, LIGHT.highlightSoftForeground, 0.12)),
    skinDeep: m(mix(NIGHT.ink, SKIN, 0.16), mix(SKIN, LIGHT.highlightSoftForeground, 0.45)),
    skinLine: m(mix(NIGHT.ink, SKIN, 0.06), mix(SKIN, NIGHT.redDeep, 0.62)),
    /** the ear and the rim of skin with the window behind it (light through skin) */
    skinGlow: m(mix(NIGHT.tealSoft, SKIN, 0.4), mix(SKIN, NIGHT.red, 0.28)),
    hair: m(mix(NIGHT.ink, NIGHT.grey, 0.42), mix(NIGHT.grey, NIGHT.ivory, 0.2)),
    hairDeep: m(mix(NIGHT.ink, NIGHT.grey, 0.18), mix(NIGHT.grey, NIGHT.ink, 0.5)),
    hairHi: m(mix(NIGHT.grey, NIGHT.tealSoft, 0.4), NIGHT.ivory),
    knit: m(mix(NIGHT.ink, LIGHT.primary, 0.42), mix(LIGHT.primary, NIGHT.ink, 0.2)),
    knitDeep: m(mix(NIGHT.ink, LIGHT.primary, 0.2), mix(LIGHT.primary, NIGHT.ink, 0.55)),
    knitHi: m(mix(LIGHT.primary, NIGHT.tealSoft, 0.3), mix(LIGHT.primary, LIGHT.primarySoft, 0.4)),
    shirt: m(mix(NIGHT.ink, LIGHT.primarySoft, 0.38), mix(LIGHT.primarySoft, LIGHT.primarySoftForeground, 0.2)),
    shirtDeep: m(mix(NIGHT.ink, LIGHT.primarySoft, 0.2), mix(LIGHT.primarySoft, LIGHT.primarySoftForeground, 0.5)),
    frame: m(mix(NIGHT.ink, LIGHT.highlightSoftForeground, 0.5), mix(LIGHT.highlightSoftForeground, NIGHT.ink, 0.25)),
    cord: m(mix(NIGHT.ink, NIGHT.brass, 0.5), mix(NIGHT.brass, LIGHT.highlightSoftForeground, 0.45)),
    mug: m(mix(NIGHT.ink, NIGHT.ivory, 0.45), NIGHT.ivory),
    mugDeep: m(mix(NIGHT.ink, NIGHT.ivory, 0.22), mix(NIGHT.ivory, NIGHT.grey, 0.6)),
    mugBand: m(mix(NIGHT.ink, LIGHT.primary, 0.7), LIGHT.primary),
    phone: mix(NIGHT.ink, NIGHT.wallLow, 0.7),
    /** the window light ahead of him */
    rim: m(NIGHT.tealSoft, LIGHT.highlightSoft),
    rimHot: m(NIGHT.phoneGlowTeal, NIGHT.ivory),
    rimAmt: 0.95,
    /** the room behind us: soft shade on his back */
    shade: m(NIGHT.ink, mix(LIGHT.highlightSoftForeground, NIGHT.ink, 0.35)),
    shadeAmt: lerp(0.5, 0.3, d),
  };
};

// ─── Helpers ────────────────────────────────────────────────────────────────

const f1 = (p: P) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`;

/** A tapered capsule from a (width wa) to b (width wb), round both ends. */
const capsule = (a: P, b: P, wa: number, wb: number) => {
  const n = perp(norm(sub(b, a)));
  const ra = wa / 2;
  const rb = wb / 2;
  return `M${f1(add(a, scaleP(n, ra)))} L${f1(add(b, scaleP(n, rb)))} A${rb} ${rb} 0 0 0 ${f1(add(b, scaleP(n, -rb)))} L${f1(add(a, scaleP(n, -ra)))} A${ra} ${ra} 0 0 0 ${f1(add(a, scaleP(n, ra)))} Z`;
};
/** The side normal of a→b facing the window (up and to the right). */
const litNormal = (a: P, b: P): P => {
  const n = perp(norm(sub(b, a)));
  return n[0] - n[1] < 0 ? [-n[0], -n[1]] : n;
};
const litEdge = (a: P, b: P, wa: number, wb: number, inset = 0.44) => {
  const n = litNormal(a, b);
  return `M${f1(add(a, scaleP(n, wa * inset)))} L${f1(add(b, scaleP(n, wb * inset)))}`;
};
const strand = (pts: readonly P[], w: number) => shape(tube(pts, pts.map((_, i) => (i === 0 || i === pts.length - 1 ? 0.6 : w)), false));

/** A limb segment with cylindrical shading across it (lit edge → mid → dark edge). */
const Segment: React.FC<{a: P; b: P; wa: number; wb: number; lit: string; mid: string; dark: string; id: string}> = ({a, b, wa, wb, lit, mid, dark, id}) => {
  const n = litNormal(a, b);
  const m = lerpP(a, b, 0.5);
  const w = (wa + wb) / 4;
  const g1 = add(m, scaleP(n, w));
  const g2 = add(m, scaleP(n, -w));
  return (
    <>
      <defs>
        <linearGradient id={id} x1={g1[0]} y1={g1[1]} x2={g2[0]} y2={g2[1]} gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={lit} />
          <stop offset="0.3" stopColor={mid} />
          <stop offset="1" stopColor={dark} />
        </linearGradient>
      </defs>
      <path d={capsule(a, b, wa, wb)} fill={`url(#${id})`} />
    </>
  );
};

// ─── Geometry (head-local: origin at the neck pivot; turned away, toward the right) ──

const SKULL: C[] = [
  [-92, -40],
  [-118, -96],
  [-134, -160],
  [-126, -222],
  [-96, -270],
  [-46, -300],
  [14, -310],
  [72, -298],
  [116, -266],
  [140, -226], // forehead
  [150, -196], // brow ridge
  [146, -178],
  [151, -160], // cheekbone
  [160, -142], // nose tip, just past the cheek
  [151, -130],
  [148, -114], // cheek (lifts with the smile)
  [152, -100], // moustache
  [146, -86],
  [138, -62], // jaw
  [114, -38],
  [80, -24],
  [36, -18],
  [-20, -22],
  [-62, -28],
];
/** Indices of SKULL that bulge and lift when he smiles (the cheek and moustache). */
const SMILE_PTS = [14, 15, 16, 17];
const HAIR: C[] = [
  [-94, -44],
  [-121, -98],
  [-137, -160],
  [-129, -224],
  [-99, -270],
  [-52, -293],
  [0, -299],
  [42, -293],
  [84, -277],
  [112, -253],
  [126, -224], // temple hairline
  [118, -198],
  [114, -172],
  [124, -146], // sideburn front edge
  [124, -116],
  [106, -112, 1],
  [94, -136],
  [80, -100],
  [58, -68],
  [20, -52], // nape hairline
  [-36, -48],
];
const EAR: C[] = [[90, -184], [108, -194], [124, -186], [131, -162], [129, -134], [119, -114], [104, -110], [95, -126], [90, -156]];
const NECK: C[] = [[-98, -50], [98, -42], [108, 10], [104, 60], [-108, 60], [-104, 10]];
const HAIR_STRANDS: Array<{pts: P[]; w: number; hi?: boolean}> = [
  {pts: [[-120, -110], [-128, -170], [-116, -230], [-84, -272]], w: 4},
  {pts: [[-96, -70], [-110, -140], [-104, -210], [-70, -262]], w: 4},
  {pts: [[-60, -56], [-80, -130], [-76, -200], [-44, -258]], w: 3.5},
  {pts: [[-20, -54], [-36, -130], [-30, -200], [-6, -250]], w: 3.5},
  {pts: [[30, -60], [12, -130], [20, -196], [44, -246]], w: 3.5},
  {pts: [[70, -86], [62, -150], [80, -210], [104, -244]], w: 3.5},
  {pts: [[-108, -90], [-122, -160], [-110, -228]], w: 2.5, hi: true},
  {pts: [[-40, -60], [-58, -140], [-50, -214]], w: 2.5, hi: true},
  {pts: [[48, -80], [36, -150], [52, -214]], w: 2.5, hi: true},
  {pts: [[96, -150], [104, -200], [118, -232]], w: 2.5, hi: true},
];

// Body-local (origin at the neck pivot, untilted).
const TORSO: C[] = [
  [-80, 14],
  [-170, 36],
  [-238, 84],
  [-266, 156],
  [-274, 290],
  [-284, 1000, 1],
  [296, 1000, 1],
  [286, 290],
  [262, 170],
  [224, 100],
  [160, 46],
  [86, 14],
];

/** S22 rest placement and the phone's rect (frame px). Draw the HotelOne screen inside `screen`. */
export const GUS_DESK = {
  neck: [300, 960] as P,
  phone: {x: 536, y: 846, w: 212, h: 424, r: 32},
  screen: {x: 546, y: 856, w: 192, h: 404, r: 24},
} as const;
export const GUS_PHONE = GUS_DESK.phone;

// ─── Pose ───────────────────────────────────────────────────────────────────

export type GusPose = {
  /** 0..1 the mug in his left hand from the desk up to his mouth (at the top it is in front of his face, so mostly hidden by his head). */
  mugRaise?: number;
  /** 0..1 a smile: the cheek rounds and lifts, the eye crinkles, the moustache corner rises. */
  smile?: number;
  /** 'dawn' (morning window light, default) or 'night'. `dawn` 0..1 overrides. */
  light?: 'dawn' | 'night';
  dawn?: number;
  /** Head pitch toward the phone, degrees (default 6). */
  lookDown?: number;
  /** Seconds, for breathing (0.2 Hz). */
  t?: number;
  /** 0..1 his thumb presses toward the screen (a tap). */
  thumb?: number;
};
const dflt = (p: GusPose) => ({
  mugRaise: clamp01(p.mugRaise ?? 0),
  smile: clamp01(p.smile ?? 0),
  dawn: clamp01(p.dawn ?? (p.light === 'night' ? 0 : 1)),
  lookDown: p.lookDown ?? 6,
  t: p.t ?? 0,
  thumb: clamp01(p.thumb ?? 0),
});
type Pose = ReturnType<typeof dflt>;

// ─── Parts ──────────────────────────────────────────────────────────────────

/** A diner mug, local: base centre at 0,0, handle on the left. */
const Mug: React.FC<{pal: Pal; rim?: string}> = ({pal, rim}) => (
  <g>
    <path d="M-30 -2 L-33 -80 Q-33 -86 -27 -86 L27 -86 Q33 -86 33 -80 L30 -2 Q30 4 24 4 L-24 4 Q-30 4 -30 -2 Z" fill={pal.mug} />
    <path d="M8 -86 L27 -86 Q33 -86 33 -80 L30 -2 Q30 4 24 4 L6 4 Z" fill={pal.mugDeep} opacity={0.45} />
    <rect x={-32.5} y={-64} width={65} height={11} fill={pal.mugBand} />
    <path d="M-32 -64 L32 -64" stroke={alpha(NIGHT.ink, 0.2)} strokeWidth={1.5} />
    <path d="M-32 -46 Q-60 -48 -58 -26 Q-56 -8 -30 -12" fill="none" stroke={pal.mug} strokeWidth={9} strokeLinecap="round" />
    <ellipse cx={0} cy={-86} rx={31} ry={6} fill={pal.mugDeep} />
    <ellipse cx={0} cy={-85} rx={26} ry={4} fill={mix(LIGHT.highlightSoftForeground, NIGHT.ink, 0.5)} />
    <path d="M30 -80 L27 -6" stroke={rim ?? pal.rimHot} strokeWidth={2.6} opacity={0.85} strokeLinecap="round" />
  </g>
);

/** His left hand round the mug (mug-local): four fingers through and round the handle side, the thumb on top. */
const MugHand: React.FC<{pal: Pal; uid: string}> = ({pal, uid}) => {
  const fingers: Array<[P, P, number]> = [
    [[-60, -50], [-30, -54], 15],
    [[-62, -36], [-30, -38], 16],
    [[-60, -22], [-30, -22], 15],
  ];
  return (
    <g>
      <path d={shape([[-86, -66], [-62, -66], [-48, -56], [-50, -14], [-64, -6], [-88, -12], [-96, -40]])} fill={pal.skin} />
      <path d={shape([[-86, -66], [-62, -66], [-48, -56], [-50, -14], [-64, -6], [-88, -12], [-96, -40]])} fill={`url(#${uid}hsh)`} />
      {fingers.map(([a, b, w], i) => (
        <path key={i} d={capsule(a, b, w, w * 0.9)} fill={mix(pal.skin, pal.skinDeep, 0.15 + i * 0.1)} stroke={pal.skinLine} strokeWidth={1.2} />
      ))}
      <path d={capsule([-70, -64], [-36, -76], 16, 13)} fill={pal.skin} stroke={pal.skinLine} strokeWidth={1.2} />
      <path d="M-84 -68 Q-60 -72 -36 -82" fill="none" stroke={pal.rim} strokeWidth={2.2} opacity={pal.rimAmt * 0.7} strokeLinecap="round" />
    </g>
  );
};

const Head: React.FC<{q: Pose; pal: Pal; uid: string}> = ({q, pal, uid}) => {
  const sm = q.smile;
  const skull = SKULL.map((p, i) => (SMILE_PTS.includes(i) ? ([p[0] + sm * (i === 16 ? 5 : 4), p[1] - sm * 5] as C) : p));
  return (
    <g>
      <defs>
        <linearGradient id={`${uid}skin`} x1="-130" y1="0" x2="160" y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={mix(pal.skinDeep, pal.shade, pal.shadeAmt)} />
          <stop offset="0.65" stopColor={pal.skin} />
          <stop offset="1" stopColor={mix(pal.skin, pal.rim, 0.3)} />
        </linearGradient>
        <radialGradient id={`${uid}crown`}>
          <stop offset="0" stopColor={mix(pal.skin, pal.rim, 0.25)} />
          <stop offset="0.6" stopColor={pal.skin} stopOpacity={0.85} />
          <stop offset="1" stopColor={pal.skin} stopOpacity={0} />
        </radialGradient>
        <linearGradient id={`${uid}hair`} x1="-130" y1="-280" x2="120" y2="-60" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={mix(pal.hair, pal.shade, pal.shadeAmt * 0.6)} />
          <stop offset="0.6" stopColor={pal.hair} />
          <stop offset="1" stopColor={mix(pal.hair, pal.hairHi, 0.3)} />
        </linearGradient>
        <linearGradient id={`${uid}nape`} x1="0" y1="-120" x2="0" y2="-40" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={pal.hairDeep} stopOpacity={0} />
          <stop offset="1" stopColor={pal.hairDeep} stopOpacity={0.55} />
        </linearGradient>
        <linearGradient id={`${uid}stub`} x1="100" y1="-120" x2="150" y2="-30" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={pal.hair} stopOpacity={0.15} />
          <stop offset="1" stopColor={pal.hairDeep} stopOpacity={0.5} />
        </linearGradient>
        <clipPath id={`${uid}sk`}>
          <path d={shape(skull)} />
        </clipPath>
      </defs>
      {/* the light wrapping round his head from the window ahead */}
      <path d={shape(skull)} fill="none" stroke={pal.rim} strokeWidth={14} opacity={0.12 * pal.rimAmt} />
      <path d={shape(skull)} fill={`url(#${uid}skin)`} />
      <g clipPath={`url(#${uid}sk)`}>
        {/* grey stubble along the jaw and cheek */}
        <path d={shape([[112, -120], [150, -116], [156, -98], [148, -82], [140, -58], [116, -34], [80, -20], [70, -44], [98, -76], [108, -100]])} fill={`url(#${uid}stub)`} />
        {/* the cheek's roundness catching the window, more as he smiles */}
        <ellipse cx={138 + sm * 3} cy={-118 - sm * 4} rx={16} ry={22} fill={pal.rim} opacity={0.12 + 0.16 * sm} />
        {/* the shadow of the brow over the socket's edge */}
        <path d="M128 -196 Q148 -192 150 -178 Q140 -176 128 -182 Z" fill={pal.skinLine} opacity={0.35} />
      </g>
      {/* moustache corner */}
      <path d={`M140 ${-104 - sm * 4} Q154 ${-108 - sm * 6} ${160 + sm * 2} ${-98 - sm * 6} Q154 ${-92 - sm * 4} 142 ${-94 - sm * 3} Z`} fill={mix(pal.hair, pal.hairHi, 0.15)} />
      <path d={`M146 ${-106 - sm * 5} Q156 ${-106 - sm * 6} ${160 + sm * 2} ${-99 - sm * 6}`} fill="none" stroke={pal.rimHot} strokeWidth={1.6} opacity={0.6 * pal.rimAmt} strokeLinecap="round" />
      {/* hair: salt and pepper, close at the back and sides */}
      <path d={shape(HAIR)} fill={`url(#${uid}hair)`} />
      <path d={shape(HAIR)} fill={`url(#${uid}nape)`} />
      {HAIR_STRANDS.map((s, i) => (
        <path key={i} d={strand(s.pts, s.w)} fill={s.hi ? pal.hairHi : pal.hairDeep} opacity={s.hi ? 0.4 : 0.45} />
      ))}
      {/* the thinning crown: scalp through sparse hair */}
      <ellipse cx={8} cy={-284} rx={64} ry={28} fill={`url(#${uid}crown)`} />
      <path d="M-30 -296 Q8 -286 46 -298 M-16 -284 Q18 -276 40 -288 M-40 -280 Q-6 -270 22 -276" fill="none" stroke={pal.hair} strokeWidth={2} opacity={0.55} strokeLinecap="round" />
      {/* nape: the skin fold and the hairline */}
      <path d="M-70 -40 Q0 -28 70 -44" fill="none" stroke={pal.skinLine} strokeWidth={2.4} opacity={0.4} strokeLinecap="round" />
      {/* the far brow's tail and the eye's crinkle as he smiles */}
      <path d={`M134 -204 Q146 ${-210 - sm * 2} 154 -202`} fill="none" stroke={pal.hairDeep} strokeWidth={5} strokeLinecap="round" />
      {sm > 0.02 ? <path d={`M140 -176 l-12 -5 M141 -169 l-13 1 M142 -162 l-11 6`} stroke={pal.skinLine} strokeWidth={1.8} opacity={sm} strokeLinecap="round" /> : null}
      {sm > 0.02 ? <path d={`M146 -122 Q140 -108 ${134 - sm * 2} -96`} fill="none" stroke={pal.skinLine} strokeWidth={1.8} opacity={sm * 0.7} strokeLinecap="round" /> : null}
      {/* ear, from behind: lit through by the window */}
      <path d={shape(EAR)} fill={pal.skin} />
      <path d={shape(EAR)} fill={pal.skinGlow} opacity={0.45} />
      <path d="M96 -176 Q112 -186 122 -174 Q128 -150 120 -124" fill="none" stroke={pal.skinLine} strokeWidth={2.4} opacity={0.5} strokeLinecap="round" />
      <path d="M108 -194 Q126 -186 131 -162 Q131 -134 119 -114" fill="none" stroke={pal.rimHot} strokeWidth={2.6} opacity={0.7 * pal.rimAmt} strokeLinecap="round" />
      {/* reading glasses: temple over the ear, the lens edge past his brow; the cord from behind the ear down round his neck */}
      <path d="M94 -186 Q120 -192 156 -190" fill="none" stroke={pal.frame} strokeWidth={5} strokeLinecap="round" />
      <path d="M94 -186 Q88 -176 92 -164" fill="none" stroke={pal.frame} strokeWidth={4.5} strokeLinecap="round" />
      <path d="M154 -206 Q166 -190 160 -170" fill="none" stroke={pal.frame} strokeWidth={6} strokeLinecap="round" />
      <path d="M156 -205 Q168 -190 162 -172" fill="none" stroke={pal.rimHot} strokeWidth={1.8} opacity={0.85 * pal.rimAmt} />
      <path d="M92 -164 C84 -120 86 -70 74 -36 C56 -14 -40 -10 -70 -24" fill="none" stroke={pal.cord} strokeWidth={2.4} strokeLinecap="round" />
      {/* the window light along the crown, the forehead, the brow, the nose tip, the cheek */}
      <path d="M-96 -270 Q-46 -302 14 -312 Q74 -300 118 -267 Q142 -228 151 -196 Q148 -178 152 -160 Q162 -142 152 -130 Q149 -114 153 -100" fill="none" stroke={pal.rim} strokeWidth={3.6} opacity={pal.rimAmt} strokeLinecap="round" strokeLinejoin="round" />
      <path d="M-128 -224 Q-138 -170 -120 -100" fill="none" stroke={pal.rim} strokeWidth={2} opacity={0.3 * pal.rimAmt} strokeLinecap="round" />
    </g>
  );
};

// ─── Desk rig ───────────────────────────────────────────────────────────────

export type GusLayer = 'all' | 'back' | 'front';

/** The desk rig as an SVG <g> in S22 frame px. With layer 'all' the phone screen is dark unless `screen` (SVG, in frame px) is given. */
export const GusDeskArt: React.FC<GusPose & {layer?: GusLayer; screen?: React.ReactNode}> = ({layer = 'all', screen, ...pose}) => {
  const uid = useUid('gd');
  const q = dflt(pose);
  const pal = palette(q.dawn);
  const NP = GUS_DESK.neck;
  const PH = GUS_DESK.phone;
  const SC = GUS_DESK.screen;
  const b = breath(q.t, 0.2, 2);
  const by = -b;
  const raise = smoothstep(q.mugRaise);
  const headDeg = q.lookDown - 4 * raise;
  const back = layer !== 'front';
  const front = layer !== 'back';
  const NPl = (p: P): P => sub(p, NP); // frame → body-local

  // right arm (frame right): the upper arm down his side, the forearm forward and up to the phone (foreshortened)
  const shR: P = [226, 118 + by];
  const wrR: P = NPl([PH.x + PH.w * 0.42, PH.y + PH.h + 34]);
  const elR: P = [276, 470];
  // left arm (frame left): the mug from the desk up to his mouth (in front of his face, so behind his head)
  const shL: P = [-226, 112 + by];
  const mugRest: P = [-200, 372];
  const mugUp: P = [150, -40];
  const hand = arc(mugRest, mugUp, -110, raise);
  const [elL, wrL] = ik(shL, add(hand, [-62, -30]), 210, 170, -1);
  const mugDeg = lerp(0, -32, raise);

  const knitLit = mix(pal.knit, pal.knitHi, 0.5);
  const knitDark = mix(pal.knitDeep, pal.shade, pal.shadeAmt);
  const skinDark = mix(pal.skinDeep, pal.shade, pal.shadeAmt * 0.6);
  const forearm = (a: P, c: P, wa: number, wc: number, id: string) => (
    <>
      <Segment a={a} b={c} wa={wa} wb={wc} lit={mix(pal.skin, pal.rim, 0.3)} mid={pal.skin} dark={skinDark} id={id} />
      <path d={litEdge(a, c, wa, wc)} stroke={pal.rim} strokeWidth={2.6} opacity={0.75 * pal.rimAmt} strokeLinecap="round" />
      {/* the shoved-up sleeve, bunched at the elbow */}
      <g transform={place(a, angle(sub(c, a)))}>
        <path d={`M-14 ${-wa / 2 - 10} Q8 ${-wa / 2 - 16} 26 ${-wa / 2 - 4} L26 ${wa / 2 + 4} Q8 ${wa / 2 + 16} -14 ${wa / 2 + 10} Z`} fill={pal.knit} />
        <path d={`M-2 ${-wa / 2 - 12} Q2 0 -2 ${wa / 2 + 12} M12 ${-wa / 2 - 10} Q16 0 12 ${wa / 2 + 10}`} fill="none" stroke={knitDark} strokeWidth={2.4} opacity={0.7} />
        <path d={`M-12 ${-wa / 2 - 10} Q8 ${-wa / 2 - 16} 26 ${-wa / 2 - 4}`} fill="none" stroke={pal.rim} strokeWidth={2.2} opacity={0.6 * pal.rimAmt} />
      </g>
    </>
  );
  // the phone (frame px) and his right hand round it: palm and heel below it, fingertips at its left edge, thumb over its right edge
  const phoneBody = (
    <g>
      <rect x={PH.x - 3} y={PH.y - 3} width={PH.w + 6} height={PH.h + 6} rx={PH.r + 3} fill={mix(pal.phone, pal.rim, 0.35)} />
      <rect x={PH.x} y={PH.y} width={PH.w} height={PH.h} rx={PH.r} fill={pal.phone} />
      <rect x={SC.x} y={SC.y} width={SC.w} height={SC.h} rx={SC.r} fill={NIGHT.ink} />
      <rect x={PH.x + PH.w / 2 - 26} y={PH.y + 14} width={52} height={14} rx={7} fill={NIGHT.ink} />
    </g>
  );
  const tx = PH.x + PH.w;
  const ty = PH.y + PH.h * 0.7;
  const press = q.thumb;
  const thumbTip: P = [tx - 30 - press * 26, ty - 34 + press * 8];
  const thumbRoot: P = [tx + 18, ty + 84];
  const thumbMid: P = [tx + 8, ty + 8];
  const thumb = (
    <g>
      <path d={capsule(thumbRoot, thumbMid, 44, 34)} fill={pal.skin} />
      <path d={capsule(thumbMid, thumbTip, 34, 26)} fill={pal.skin} />
      <path d={capsule(thumbMid, thumbTip, 34, 26)} fill={skinDark} opacity={0.35} />
      {/* thumbnail */}
      <path d={`M${thumbTip[0] - 6} ${thumbTip[1] - 2} Q${thumbTip[0] + 2} ${thumbTip[1] - 12} ${thumbTip[0] + 12} ${thumbTip[1] - 6} L${thumbTip[0] + 8} ${thumbTip[1] + 4} Z`} fill={mix(pal.skin, NIGHT.ivory, 0.35)} opacity={0.8} />
      <path d={`M${tx + 40} ${ty + 70} Q${tx + 28} ${ty} ${thumbTip[0] + 8} ${thumbTip[1] - 12}`} fill="none" stroke={pal.rim} strokeWidth={2.6} opacity={0.8 * pal.rimAmt} strokeLinecap="round" />
      {/* fingertips round the left edge */}
      {[0, 1, 2].map((i) => {
        const y = PH.y + PH.h * 0.5 + i * 38;
        return (
          <g key={i}>
            <path d={capsule([PH.x + 10, y], [PH.x - 8, y + 6], 28, 24)} fill={mix(pal.skin, pal.skinDeep, 0.2 + i * 0.12)} stroke={pal.skinLine} strokeWidth={1.2} />
            <path d={`M${PH.x - 16} ${y + 2} q2 -9 12 -11`} fill="none" stroke={pal.rim} strokeWidth={1.8} opacity={0.5 * pal.rimAmt} strokeLinecap="round" />
          </g>
        );
      })}
    </g>
  );
  const palm = (
    <g>
      <path d={shape([[tx - 50, ty + 10], [tx + 22, ty + 14], [tx + 40, ty + 80], [tx + 26, PH.y + PH.h + 40], [tx - 40, PH.y + PH.h + 56], [tx - 130, PH.y + PH.h + 40], [tx - 150, PH.y + PH.h - 10], [tx - 110, ty + 40]])} fill={skinDark} />
      <path d={`M${tx + 22} ${ty + 14} Q${tx + 42} ${ty + 46} ${tx + 40} ${ty + 80}`} fill="none" stroke={pal.rim} strokeWidth={2.4} opacity={0.6 * pal.rimAmt} strokeLinecap="round" />
    </g>
  );

  return (
    <g>
      <defs>
        <linearGradient id={`${uid}knit`} x1="-290" y1="0" x2="300" y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={knitDark} />
          <stop offset="0.55" stopColor={pal.knit} />
          <stop offset="0.92" stopColor={mix(pal.knit, pal.knitHi, 0.3)} />
          <stop offset="1" stopColor={mix(pal.knit, pal.rim, 0.25)} />
        </linearGradient>
        <linearGradient id={`${uid}fall`} x1="0" y1="200" x2="0" y2="640" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={NIGHT.ink} stopOpacity={0} />
          <stop offset="1" stopColor={NIGHT.ink} stopOpacity={0.3 + 0.45 * pal.n} />
        </linearGradient>
        <linearGradient id={`${uid}hsh`} x1="0" y1="-70" x2="0" y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={pal.rim} stopOpacity={0.2} />
          <stop offset="1" stopColor={pal.shade} stopOpacity={0.35} />
        </linearGradient>
      </defs>
      {back ? (
        <g>
          <g transform={`translate(${NP[0]} ${NP[1]})`}>
            {/* left arm and mug: behind his back (the forearm reaches forward to the desk, up to his mouth) */}
            <Segment a={shL} b={elL} wa={110} wb={88} lit={knitLit} mid={pal.knit} dark={knitDark} id={`${uid}lu`} />
            {forearm(elL, wrL, 70, 56, `${uid}lf`)}
            <g transform={place(hand, mugDeg)}>
              <Mug pal={pal} />
              <MugHand pal={pal} uid={uid} />
            </g>
            {/* right upper arm down his side */}
            <Segment a={shR} b={elR} wa={112} wb={90} lit={knitLit} mid={pal.knit} dark={knitDark} id={`${uid}ru`} />
            {/* back of the cardigan */}
            <g transform={`translate(0 ${by})`}>
              <path d={shape(TORSO)} fill={`url(#${uid}knit)`} />
              <path d={shape(TORSO)} fill={`url(#${uid}fall)`} />
              {/* shoulder blades, the centre seam, folds pulled toward the raised right arm */}
              <path d="M-170 120 Q-120 210 -150 340 M170 130 Q140 220 168 350" fill="none" stroke={knitDark} strokeWidth={4} opacity={0.5} strokeLinecap="round" />
              <path d="M0 60 Q-6 300 4 700" fill="none" stroke={knitDark} strokeWidth={3} opacity={0.4} strokeLinecap="round" />
              <path d="M60 160 Q150 170 230 140 M40 240 Q140 250 240 210" fill="none" stroke={knitDark} strokeWidth={3} opacity={0.35} strokeLinecap="round" />
              <path d="M-200 520 Q-60 540 120 520" fill="none" stroke={knitDark} strokeWidth={3} opacity={0.25} strokeLinecap="round" />
              {/* rim along the shoulders (the window ahead) */}
              <path d="M86 14 Q160 46 224 100 Q262 170 286 290" fill="none" stroke={pal.rim} strokeWidth={3.6} opacity={pal.rimAmt} strokeLinecap="round" />
              <path d="M-80 14 Q-170 36 -238 84 Q-266 156 -274 290" fill="none" stroke={pal.rim} strokeWidth={2.4} opacity={0.5 * pal.rimAmt} strokeLinecap="round" />
              {/* neck, chambray collar, the cardigan's ribbed shawl collar */}
              <path d={shape(NECK)} fill={mix(pal.skinDeep, pal.shade, pal.shadeAmt * 0.5)} />
              <path d="M-70 -30 Q0 -20 76 -36" fill="none" stroke={pal.skinLine} strokeWidth={2} opacity={0.35} />
              <path d="M-92 4 Q0 -12 96 0 L102 30 Q0 16 -98 34 Z" fill={pal.shirt} />
              <path d="M96 0 L120 36 L94 32 Z" fill={pal.shirt} />
              <path d="M-92 4 Q0 -12 96 0 L120 36" fill="none" stroke={pal.rim} strokeWidth={2} opacity={0.7 * pal.rimAmt} />
              <path d="M-124 44 Q0 6 132 38 Q150 46 160 56 Q0 30 -136 70 Q-140 54 -124 44 Z" fill={pal.knitHi} />
              <path d="M-112 50 Q0 18 140 46" fill="none" stroke={knitDark} strokeWidth={2} opacity={0.4} />
              <path d="M-100 58 Q0 30 150 54" fill="none" stroke={knitDark} strokeWidth={2} opacity={0.3} />
            </g>
            {/* head, turned toward the phone and pitched down to it */}
            <g transform={`translate(0 ${by * 0.7}) rotate(${headDeg})`}>
              <Head q={q} pal={pal} uid={uid} />
            </g>
            {/* right forearm forward and up to the phone */}
            {forearm(elR, wrR, 74, 62, `${uid}rf`)}
          </g>
          {palm}
          {phoneBody}
          {layer === 'all' && screen ? <g>{screen}</g> : null}
        </g>
      ) : null}
      {front ? thumb : null}
    </g>
  );
};

const camT = (c?: Crop) => {
  if (!c) return undefined;
  const ox = c.ox ?? 540;
  const oy = c.oy ?? 960;
  return `translate(${ox + c.x} ${oy + c.y}) scale(${c.scale}) translate(${-ox} ${-oy})`;
};

/** The desk rig as a full-frame layer. `camera` scales about (540, 960) then moves (same convention as the sets). */
export const GusDesk: React.FC<GusPose & {layer?: GusLayer; camera?: Crop; screen?: React.ReactNode; style?: React.CSSProperties}> = ({camera, style, ...rest}) => (
  <AbsoluteFill style={{pointerEvents: 'none', ...style}}>
    <svg width={1080} height={1920} viewBox="0 0 1080 1920" style={{position: 'absolute', inset: 0, overflow: 'visible'}}>
      <g transform={camT(camera)}>
        <GusDeskArt {...rest} />
      </g>
    </svg>
  </AbsoluteFill>
);

// ─── Silhouette at the window (S23; S27 at night) ───────────────────────────

export type GusSilhouetteProps = {
  /** 0..1 the mug (left hand) rises from his chest to a toast at head height. */
  mugRaise?: number;
  /** 'dawn' (ivory window behind him, default) or 'night' (Rita's red neon across the road). */
  light?: 'dawn' | 'night';
  /** What he holds up: the mug (S23) or binoculars (both hands, elbows out). */
  hold?: 'mug' | 'binoculars';
  /** 0..1 a smile on the sliver of face we see. */
  smile?: number;
  t?: number;
  /** Neck pivot in frame px and scale. Default: bottom right, leaving the window's centre clear. */
  x?: number;
  y?: number;
  scale?: number;
};

const SIL_MUG_REST: P = [-150, 230];
const SIL_MUG_UP: P = [-252, -176];
const silMugAt = (raise: number) => arc(SIL_MUG_REST, SIL_MUG_UP, 60, raise);
const silMugDeg = (raise: number) => lerp(8, -10, raise);

/** The silhouette as an SVG <g> (neck pivot at 0,0). */
export const GusSilhouetteArt: React.FC<Omit<GusSilhouetteProps, 'x' | 'y' | 'scale'>> = ({mugRaise = 0, light = 'dawn', hold = 'mug', smile = 0, t = 0}) => {
  const uid = useUid('gs');
  const dawn = light === 'dawn';
  const rim = dawn ? NIGHT.ivory : NIGHT.redSoft;
  const glow = dawn ? LIGHT.highlightSoft : NIGHT.red;
  const body = dawn ? mix(NIGHT.ink, LIGHT.inverse, 0.55) : NIGHT.ink;
  const edge = mix(body, rim, 0.14);
  const b = breath(t, 0.2, 2);
  const raise = smoothstep(clamp01(mugRaise));
  const bino = hold === 'binoculars';
  const sm = clamp01(smile);
  const headDeg = bino ? -3 : -5 + 3 * raise;
  // left arm (frame left): a toast toward the window; with binoculars both elbows go out
  const shL: P = [-232, 108 - b];
  const handL: P = bino ? [40, -120] : add(silMugAt(raise), [8, -30]);
  const [elL, wrL] = ik(shL, handL, 200, 176, -1);
  const shR: P = [232, 100 - b];
  const handR: P = [150, -118];
  const [elR, wrR] = ik(shR, handR, 200, 176, 1);
  const skull = SKULL.map((p, i) => (SMILE_PTS.includes(i) ? ([p[0] + sm * 4, p[1] - sm * 5] as C) : p));
  const limb = (a: P, c: P, wa: number, wc: number, key: string) => (
    <g key={key}>
      <path d={capsule(a, c, wa, wc)} fill={body} />
      <path d={litEdge(a, c, wa, wc, 0.48)} stroke={rim} strokeWidth={3} opacity={0.85} strokeLinecap="round" />
    </g>
  );
  return (
    <g>
      <defs>
        <radialGradient id={`${uid}halo`}>
          <stop offset="0" stopColor={glow} stopOpacity={0.4} />
          <stop offset="1" stopColor={glow} stopOpacity={0} />
        </radialGradient>
        <linearGradient id={`${uid}body`} x1="0" y1="-300" x2="0" y2="700" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={mix(body, rim, 0.06)} />
          <stop offset="0.5" stopColor={body} />
          <stop offset="1" stopColor={mix(body, NIGHT.ink, 0.5)} />
        </linearGradient>
      </defs>
      {/* window light wrapping round his head and shoulders */}
      <ellipse cx={30} cy={-130} rx={280} ry={230} fill={`url(#${uid}halo)`} />
      <ellipse cx={50} cy={-160} rx={180} ry={160} fill={`url(#${uid}halo)`} />
      {bino ? (
        <>
          {limb(shR, elR, 112, 90, 'ru')}
          {limb(elR, wrR, 82, 62, 'rf')}
        </>
      ) : null}
      <g transform={`translate(0 ${-b})`}>
        <path d={shape(TORSO)} fill={`url(#${uid}body)`} />
        {/* the cardigan's shawl collar and the shirt collar breaking the neckline */}
        <path d="M-124 44 Q0 6 132 38 Q150 46 160 56 Q0 30 -136 70 Q-140 54 -124 44 Z" fill={edge} />
        <path d="M96 0 L120 36 L94 32 Z" fill={edge} />
        <path d="M86 14 Q160 46 224 100 Q262 170 286 290" fill="none" stroke={rim} strokeWidth={3.4} opacity={0.9} strokeLinecap="round" />
        <path d="M-80 14 Q-170 36 -238 84 Q-266 156 -274 290" fill="none" stroke={rim} strokeWidth={2.4} opacity={0.5} strokeLinecap="round" />
        <path d={shape(NECK)} fill={body} />
      </g>
      {limb(shL, elL, 110, 88, 'lu')}
      {limb(elL, wrL, 80, 62, 'lf')}
      {/* the shoved-up sleeve at the elbow */}
      <path d={capsule(lerpP(elL, wrL, -0.05), lerpP(elL, wrL, 0.18), 96, 90)} fill={edge} />
      {/* head: solid, the window light along the crown, brow, nose tip, cheek; the ear and glasses breaking the outline */}
      <g transform={`rotate(${headDeg})`}>
        <path d={shape(skull)} fill={body} />
        <path d={shape(skull)} fill="none" stroke={rim} strokeWidth={16} opacity={0.1} />
        <path d={shape(EAR)} fill={edge} />
        <path d="M108 -194 Q126 -186 131 -162 Q131 -134 119 -114" fill="none" stroke={dawn ? mix(SKIN, NIGHT.red, 0.3) : rim} strokeWidth={3} opacity={0.6} strokeLinecap="round" />
        <path d="M-96 -270 Q-46 -302 14 -312 Q74 -300 118 -267 Q142 -228 151 -196 Q148 -178 152 -160 Q162 -142 152 -130 Q149 -114 153 -100 Q150 -86 140 -62" fill="none" stroke={rim} strokeWidth={3.4} strokeLinecap="round" strokeLinejoin="round" />
        <path d="M-128 -224 Q-138 -170 -120 -100" fill="none" stroke={rim} strokeWidth={2} opacity={0.35} strokeLinecap="round" />
        {/* stubble and moustache roughen the jaw's edge */}
        <path d={`M140 ${-104 - sm * 4} Q154 ${-108 - sm * 6} ${160 + sm * 2} ${-98 - sm * 6} Q154 ${-92 - sm * 4} 142 ${-94 - sm * 3} Z`} fill={body} />
        <path d={`M146 ${-106 - sm * 5} Q156 ${-106 - sm * 6} ${160 + sm * 2} ${-99 - sm * 6}`} fill="none" stroke={rim} strokeWidth={1.8} opacity={0.7} strokeLinecap="round" />
        {/* glasses: temple over the ear, the lens edge past the brow */}
        <path d="M94 -186 Q120 -192 156 -190" fill="none" stroke={edge} strokeWidth={4} strokeLinecap="round" />
        <path d="M154 -206 Q166 -190 160 -170" fill="none" stroke={body} strokeWidth={7} strokeLinecap="round" />
        <path d="M156 -205 Q168 -190 162 -172" fill="none" stroke={rim} strokeWidth={1.8} opacity={0.9} />
        {bino ? (
          // the binoculars' far ends showing past his face
          <g>
            <path d="M136 -214 L188 -220 Q198 -220 198 -210 L198 -164 Q198 -154 188 -154 L136 -160 Z" fill={body} />
            <path d="M138 -214 L188 -220 Q198 -220 198 -210" fill="none" stroke={rim} strokeWidth={2.6} opacity={0.9} />
            <ellipse cx={198} cy={-187} rx={5} ry={26} fill={mix(body, rim, 0.3)} />
          </g>
        ) : null}
      </g>
      {bino ? null : (
        <g transform={place(silMugAt(raise), silMugDeg(raise))}>
          <path d="M-30 -2 L-33 -80 Q-33 -86 -27 -86 L27 -86 Q33 -86 33 -80 L30 -2 Q30 4 24 4 L-24 4 Q-30 4 -30 -2 Z" fill={body} />
          <path d="M-32 -46 Q-60 -48 -58 -26 Q-56 -8 -30 -12" fill="none" stroke={body} strokeWidth={9} strokeLinecap="round" />
          <path d="M-27 -86 L27 -86 Q33 -86 33 -80 L30 -2" fill="none" stroke={rim} strokeWidth={2.8} opacity={0.9} strokeLinejoin="round" />
          <path d="M-58 -30 Q-60 -44 -36 -48" fill="none" stroke={rim} strokeWidth={1.8} opacity={0.5} strokeLinecap="round" />
          {/* his fingers through the handle and round the mug, the thumb on top */}
          <path d={shape([[-86, -66], [-62, -66], [-48, -56], [-50, -14], [-64, -6], [-88, -12], [-96, -40]])} fill={body} />
          {[-54, -38, -22].map((y, i) => (
            <path key={i} d={capsule([-60, y], [-28, y - 2], 15, 13)} fill={body} />
          ))}
          <path d={capsule([-70, -64], [-34, -76], 16, 13)} fill={body} />
          <path d="M-84 -68 Q-60 -72 -34 -82" fill="none" stroke={rim} strokeWidth={2.2} opacity={0.75} strokeLinecap="round" />
          {/* a wisp of steam lit by the window */}
          <path d="M4 -98 Q-8 -120 6 -140 Q18 -156 4 -174" fill="none" stroke={rim} strokeWidth={3} opacity={0.4 * (0.4 + 0.6 * raise)} strokeLinecap="round" />
          <path d="M-10 -100 Q-18 -116 -8 -130" fill="none" stroke={rim} strokeWidth={2} opacity={0.25 * (0.4 + 0.6 * raise)} strokeLinecap="round" />
        </g>
      )}
    </g>
  );
};

/** The silhouette as a full-frame layer. Default: neck at (790, 1330), scale 1.45 (head ≈ y 880–1330, shoulders off the bottom right). */
export const GusSilhouette: React.FC<GusSilhouetteProps & {style?: React.CSSProperties}> = ({x = 790, y = 1330, scale = 1.45, style, ...rest}) => (
  <AbsoluteFill style={{pointerEvents: 'none', ...style}}>
    <svg width={1080} height={1920} viewBox="0 0 1080 1920" style={{position: 'absolute', inset: 0}}>
      <g transform={`translate(${x} ${y}) scale(${scale})`}>
        <GusSilhouetteArt {...rest} />
      </g>
    </svg>
  </AbsoluteFill>
);

/** Where the mug's rim is on the silhouette (frame px) for a raise, e.g. to time the S23 clink against the glass. */
export const gusSilhouetteMug = (mugRaise: number, at: {x?: number; y?: number; scale?: number} = {}) => {
  const x = at.x ?? 790;
  const y = at.y ?? 1330;
  const s = at.scale ?? 1.45;
  const raise = smoothstep(clamp01(mugRaise));
  const top = add(silMugAt(raise), rot([0, -86], silMugDeg(raise)));
  return {x: x + top[0] * s, y: y + top[1] * s};
};
