// Rita (50s, owner of Rita's Motor Inn): practical, wry, grey bob, burgundy
// cardigan over an ivory blouse, reading glasses on a beaded chain. Two rigs
// only (STORYBOARD.md, Production notes):
//
//   RigA  a 3/4 medium close-up in her car, facing right toward the Starlite
//         (S04, S10, S11, S13, S15, S16, S17, S21). Drawn in CarInterior's
//         rest-framing px (Rita at x 180–640, y 620–1180), so the same
//         `camera` (Crop) moves her with the set. Draw order in a scene:
//           <CarInterior layer="back" camera={c} />
//           <RitaA layer="body" camera={c} {...pose} />
//           <CarInterior layer="front" camera={c} />
//           <RitaA layer="front" camera={c} {...pose} />   (near arm; far arm when writing)
//   RigB  a profile silhouette facing right, phone pressed to her ear (S07).
//   RitaGlasses  the S09 extreme close-up: two lenses that host a reflection.
//
// At night her face is mostly silhouette: a teal rim through the windshield,
// green under-light from the dash, the acting carried by brows, a 4–6 px mouth
// corner, lids and the glint on her glasses. `dawn` (0..1) relights her for S21.
// Every moving part is a number so scenes can interpolate() it.
import React from 'react';
import {AbsoluteFill} from 'remotion';
import {DARK, LIGHT, NIGHT} from '../theme.ts';
import {alpha, mix, useUid} from '../set/parts.tsx';
import type {Crop} from '../set/Lobby.tsx';
import {CAR, PAD_BOX, Steam} from '../set/CarInterior.tsx';
import {add, angle, arc, breath, clamp01, ik, lerp, lerpP, mapC, place, rot, shape, smoothstep, sub, type C, type P} from './rig.ts';

// ─── Palette ────────────────────────────────────────────────────────────────

/** Her skin in daylight (a shade of the paper/tape and soft red tokens). */
const SKIN = mix(NIGHT.tape, NIGHT.redSoft, 0.3);
const GREEN = DARK.successSoftForeground; // the dash clock's green

type Pal = ReturnType<typeof palette>;
const palette = (dawn: number) => {
  const d = clamp01(dawn);
  const n = 1 - d;
  const m = (night: string, day: string) => mix(night, day, d);
  return {
    d,
    n,
    face: m(mix(NIGHT.ink, mix(SKIN, NIGHT.red, 0.12), 0.22), mix(SKIN, LIGHT.highlight, 0.06)),
    faceDeep: m(mix(NIGHT.ink, SKIN, 0.08), mix(SKIN, NIGHT.redDeep, 0.4)),
    faceLine: m(mix(NIGHT.ink, SKIN, 0.03), mix(SKIN, NIGHT.redDeep, 0.62)),
    lip: m(mix(NIGHT.ink, NIGHT.red, 0.2), mix(SKIN, NIGHT.red, 0.38)),
    eyeWhite: m(mix(NIGHT.ink, NIGHT.tealSoft, 0.34), mix(NIGHT.ivory, NIGHT.paper, 0.4)),
    iris: m(NIGHT.ink, mix(NIGHT.ink, NIGHT.tealDeep, 0.6)),
    hair: m(mix(NIGHT.ink, NIGHT.grey, 0.3), mix(NIGHT.grey, NIGHT.ivory, 0.28)),
    hairDeep: m(mix(NIGHT.ink, NIGHT.grey, 0.12), mix(NIGHT.grey, NIGHT.ink, 0.3)),
    hairHi: m(mix(NIGHT.grey, NIGHT.tealSoft, 0.4), NIGHT.ivory),
    brow: m(mix(NIGHT.ink, NIGHT.grey, 0.62), mix(NIGHT.grey, NIGHT.ink, 0.4)),
    knit: m(mix(NIGHT.ink, NIGHT.redDeep, 0.95), mix(NIGHT.redDeep, NIGHT.red, 0.42)),
    knitDeep: m(mix(NIGHT.ink, NIGHT.redDeep, 0.5), mix(NIGHT.redDeep, NIGHT.ink, 0.2)),
    knitHi: m(mix(NIGHT.redDeep, NIGHT.red, 0.35), mix(NIGHT.red, NIGHT.redSoft, 0.5)),
    blouse: m(mix(NIGHT.ink, NIGHT.ivory, 0.26), mix(NIGHT.ivory, NIGHT.paper, 0.5)),
    blouseDeep: m(mix(NIGHT.ink, NIGHT.ivory, 0.12), mix(NIGHT.paper, NIGHT.grey, 0.5)),
    frame: m(mix(NIGHT.ink, NIGHT.redDeep, 0.6), mix(NIGHT.redDeep, NIGHT.ink, 0.25)),
    brass: m(mix(NIGHT.ink, NIGHT.brass, 0.7), NIGHT.brass),
    rim: m(NIGHT.tealSoft, LIGHT.highlightSoft),
    rimHot: m(NIGHT.phoneGlowTeal, NIGHT.ivory),
    under: GREEN,
    underAmt: 0.42 * n,
    rimAmt: 0.95 - 0.35 * d,
    metal: m(mix(NIGHT.ink, NIGHT.wallLow, 0.8), mix(NIGHT.wallLow, NIGHT.grey, 0.25)),
    metalHi: m(mix(NIGHT.wallLow, NIGHT.grey, 0.55), NIGHT.grey),
    phone: m(mix(NIGHT.ink, NIGHT.wallLow, 0.6), mix(NIGHT.ink, NIGHT.wallLow, 0.9)),
  };
};

// ─── Rig A geometry (car rest-framing px) ────────────────────────────────────

/** Neck pivot (top of the neck, under the skull) at the rest framing. Body-local and head-local coords start here. */
const NP: P = [398, 872];

// Head-local (origin at the neck pivot, facing right). Units: rest px.
const FACE_FRONT: C[] = [
  [72, -262],
  [95, -228],
  [101, -196],
  [104, -178], // brow ridge
  [99, -163], // nose root
  [106, -142],
  [117, -117],
  [125, -103], // nose tip
  [121, -94],
  [111, -90],
  [106, -88, 1], // under the nose
  [109, -81],
  [112, -75], // upper lip
  [105, -70, 1], // lip seam
  [109, -64],
  [103, -55],
  [98, -50], // under the lower lip
  [102, -41], // chin
  [98, -29],
  [84, -21],
];
const FACE: C[] = [[-40, -262], [20, -284], ...FACE_FRONT, [55, -15], [28, -5], [-12, -30], [-46, -82], [-62, -150], [-60, -215]];

const NECK: C[] = [[-40, -76], [6, -18], [32, -8], [37, 24], [44, 62], [-6, 68], [-46, 62], [-44, 20]];

const HAIR_BACK: C[] = [
  [-10, -320],
  [60, -306],
  [104, -270],
  [120, -236],
  [100, -224],
  [60, -228],
  [-10, -200],
  [-28, -120],
  [-22, -50],
  [-60, -34],
  [-112, -42],
  [-146, -82],
  [-160, -152],
  [-152, -232],
  [-114, -294],
  [-62, -320],
];
const HAIR_FRONT: C[] = [
  [-36, -306],
  [30, -310],
  [86, -290],
  [113, -255],
  [121, -232, 1], // the fringe's tip
  [100, -234],
  [74, -241],
  [44, -236],
  [16, -222],
  [0, -200],
  [-10, -166],
  [-14, -120],
  [-11, -80],
  [-1, -52], // bob tip curling in at the jaw
  [-14, -38, 1],
  [-52, -36],
  [-98, -48],
  [-120, -120],
  [-112, -220],
  [-82, -286],
];
/** Strand lines in the hair (open paths). */
const HAIR_STRANDS: C[][] = [
  [[-20, -300], [40, -290], [90, -262], [112, -240]],
  [[-30, -290], [10, -270], [52, -250], [80, -244]],
  [[-60, -290], [-80, -230], [-86, -150], [-70, -60]],
  [[-40, -280], [-48, -200], [-40, -120], [-26, -60]],
  [[-100, -270], [-126, -200], [-130, -120], [-112, -56]],
];

// Eyes, brows, glasses, mouth (head-local).
const EYE_N = {c: [36, -158] as P, w: 31, h: 12};
const EYE_F = {c: [88, -159] as P, w: 17, h: 10};
const LENS_N: C[] = [[9, -173], [36, -178], [61, -173], [64, -160], [59, -145], [36, -139], [14, -143], [7, -158]];
const LENS_F: C[] = [[77, -174], [92, -177], [102, -173], [104, -159], [101, -145], [91, -140], [80, -144], [76, -160]];

// ─── Body (body-local: origin NP, not tilted) ───────────────────────────────

const TORSO: C[] = [
  [-50, 22],
  [-112, 50],
  [-178, 86],
  [-218, 144],
  [-234, 246],
  [-240, 900, 1],
  [256, 900, 1],
  [256, 246],
  [232, 146],
  [176, 88],
  [110, 60],
  [56, 42],
];
const SHOULDER_N: P = [-172, 158];
const SHOULDER_F: P = [172, 156];
const ARM_N = {upper: 172, fore: 160};
const ARM_F = {upper: 168, fore: 156};

// Near-hand targets (body-local wrist positions).
const NEAR_REST: P = [56, 236]; // on the wheel's left rim
const NEAR_PHONE: P = [-46, -44]; // head-local: under her ear, the phone up against it
const NEAR_CUP: P = [44, -34]; // head-local: the thermos cup at her lips
const NEAR_LAP: P = [10, 400];
// Far-hand targets.
const FAR_REST: P = [236, 250]; // on the wheel's top rim
const FAR_CHEST: P = [128, 214];
const FAR_LAP: P = [150, 380];

// ─── Pose ───────────────────────────────────────────────────────────────────

export type RitaLight = 'night' | 'dawn';

export type RitaPose = {
  /** 0 = binoculars resting on her chest (strap round her neck), 1 = up at her eyes. */
  binoculars?: number;
  /** Which hand lifts the binoculars: 'far' (default; leaves the near hand for the phone) or 'near' (leaves the far hand free to write, S04). */
  binocularHand?: 'near' | 'far';
  /** 0..1 brows up (skeptical: the near brow leads, `browAsym` of it on the far brow). */
  browRaise?: number;
  /** 0..1 how much of browRaise the far brow gets (default 0.45; 1 = both equally). */
  browAsym?: number;
  /** 0..1 narrowed eyes (lower lids up, upper lids down a little). */
  squint?: number;
  /** 0..1 the near mouth corner up (≈6 px at rest scale) with a cheek crease. */
  smirk?: number;
  /** 0..1 eyelids closed. */
  blink?: number;
  /** Head roll in degrees about the neck (positive = toward the windshield / forward). */
  headTilt?: number;
  /** -1..1 eyes left..right (left = at camera) and up..down. */
  lookX?: number;
  lookY?: number;
  /** 0..1 a glint sweeping across her lenses (0 and 1 = none; draw it over ~6 frames). */
  glint?: number;
  /** 0..1 the thermos cup to her lips (near hand). */
  sip?: number;
  /** 0..1 asleep: head back on the headrest, eyes shut, mouth a little open, hands in her lap. */
  asleep?: number;
  /** 0..1 the near hand brings her phone to her ear. */
  phoneToEar?: number;
  /** Draw the phone in her near hand (default true). Set false the frame she lets go of it (S16 toss) and draw the flying phone in the scene. */
  phone?: boolean;
  /** 0..1 the far hand writes on the steno pad with a pen whose tip is at `penAt` (rest px). */
  pen?: number;
  penAt?: P;
  /** Light: 'night' (teal rim, green dash under-light) or 'dawn'. `dawn` (0..1) overrides for a time-lapse. */
  light?: RitaLight;
  dawn?: number;
  /** Seconds, for breathing (0.25 Hz awake, 0.2 Hz asleep); `breathe` px amplitude (default 2, 3 asleep). */
  t?: number;
  breathe?: number;
  /** 0..1 knuckles tighten on what the near hand holds (a highlight). */
  grip?: number;
  /** 0..1 lips parted (asleep sets it too). */
  mouthOpen?: number;
  /** 0..1 leaning in over the wheel (S11): head and shoulders forward and down. */
  lean?: number;
  /** Override: blend the near wrist toward a body-local point (gestures, the S16 toss follow-through). */
  nearReach?: {to: P; amount: number};
};

const dflt = (p: RitaPose) => ({
  binoculars: clamp01(p.binoculars ?? 0),
  binocularHand: p.binocularHand ?? 'far',
  browRaise: clamp01(p.browRaise ?? 0),
  browAsym: clamp01(p.browAsym ?? 0.45),
  squint: clamp01(p.squint ?? 0),
  smirk: clamp01(p.smirk ?? 0),
  blink: clamp01(p.blink ?? 0),
  headTilt: p.headTilt ?? 0,
  lookX: Math.max(-1, Math.min(1, p.lookX ?? 0)),
  lookY: Math.max(-1, Math.min(1, p.lookY ?? 0)),
  glint: clamp01(p.glint ?? 0),
  sip: clamp01(p.sip ?? 0),
  asleep: clamp01(p.asleep ?? 0),
  phoneToEar: clamp01(p.phoneToEar ?? 0),
  phone: p.phone ?? true,
  pen: clamp01(p.pen ?? 0),
  penAt: p.penAt ?? ([740, 1016] as P),
  dawn: clamp01(p.dawn ?? (p.light === 'dawn' ? 1 : 0)),
  t: p.t ?? 0,
  breathe: p.breathe,
  grip: clamp01(p.grip ?? 0),
  mouthOpen: clamp01(p.mouthOpen ?? 0),
  lean: clamp01(p.lean ?? 0),
  nearReach: p.nearReach,
});
type Pose = ReturnType<typeof dflt>;

/** Everything the drawing needs, solved once per frame (positions in body-local px). */
const solve = (q: Pose) => {
  const sleep = smoothstep(q.asleep);
  const hz = lerp(0.25, 0.2, sleep);
  const amp = q.breathe ?? lerp(2, 3, sleep);
  const b = breath(q.t, hz, amp);
  const ln = smoothstep(q.lean);
  const bodyY = -b + 10 * ln; // shoulders rise on the inhale, drop as she leans in
  const headDeg = q.headTilt - 12 * sleep + 6 * ln;
  const headOff: P = [-22 * sleep + 30 * ln, -b * 0.7 - 6 * sleep + 18 * ln];
  /** head-local → body-local */
  const H = (p: P): P => add(rot(p, headDeg), headOff);

  // binoculars: eyepiece (near barrel) position and angle
  const up = smoothstep(q.binoculars);
  const eyeAt = H(add(EYE_N.c, [-6, 4]));
  const restAt: P = [6, 196 + bodyY];
  const binoPos = arc(restAt, eyeAt, -40, up);
  const binoDeg = lerp(32, headDeg - 3, smoothstep(q.binoculars / 0.5));
  const nearBino = q.binocularHand === 'near';
  const binoGrip = clamp01(q.binoculars * 5);
  const binoHand = add(binoPos, rot([nearBino ? 70 : 104, nearBino ? 30 : 34], binoDeg));

  // near hand
  const phone = smoothstep(q.phoneToEar);
  let near: P = lerpP(NEAR_REST, NEAR_LAP, sleep);
  near = arc(near, H(NEAR_PHONE), 70, phone);
  near = lerpP(near, H(NEAR_CUP), smoothstep(q.sip));
  if (nearBino) near = lerpP(near, binoHand, binoGrip);
  if (q.nearReach) near = lerpP(near, q.nearReach.to, clamp01(q.nearReach.amount));
  const sN: P = [SHOULDER_N[0], SHOULDER_N[1] + bodyY];
  const [elbowN, wristN] = ik(sN, near, ARM_N.upper, ARM_N.fore, 1);

  // far hand
  const penW = smoothstep(q.pen);
  const penLocal: P = sub(q.penAt, NP);
  let far: P = lerpP(lerpP(FAR_REST, FAR_CHEST, 0.3), FAR_LAP, sleep);
  if (!nearBino) far = lerpP(far, binoHand, binoGrip);
  far = lerpP(far, add(penLocal, [-30, -96]), penW);
  const sF: P = [SHOULDER_F[0], SHOULDER_F[1] + bodyY];
  // writing: the elbow drops behind the pad and the hand comes over its top edge; binoculars: elbow out toward the windshield
  const [elbowF, wristF] = ik(sF, far, ARM_F.upper, ARM_F.fore, 1);

  return {sleep, bodyY, headDeg, headOff, H, binoPos, binoDeg, up, phone, sN, elbowN, wristN, sF, elbowF, wristF, penW, penLocal, nearBino, binoGrip};
};
type Solved = ReturnType<typeof solve>;

// ─── Parts ──────────────────────────────────────────────────────────────────

/** A curled hand (fist round something) in hand-local coords: wrist at 0,0, fingers toward +x. `flip` mirrors (thumb below). */
const Fist: React.FC<{pal: Pal; deg: number; at: P; flip?: boolean; scale?: number; grip?: number; uid: string}> = ({pal, deg, at, flip = false, scale = 1, grip = 0, uid}) => {
  const palm: C[] = [[0, -15], [20, -19], [40, -22], [56, -20], [64, -8], [64, 8], [56, 19], [36, 21], [16, 18], [0, 14]];
  const thumb: C[] = [[16, -16], [34, -28], [52, -30], [60, -24], [50, -18], [32, -12]];
  return (
    <g transform={`${place(at, deg, scale)} ${flip ? 'scale(1 -1)' : ''}`}>
      <path d={shape(palm)} fill={pal.face} />
      <path d={shape(palm)} fill={`url(#${uid}hand)`} />
      {/* knuckle ridges where the fingers curl */}
      <path d="M50 -18 Q64 -4 52 19" fill="none" stroke={pal.faceLine} strokeWidth={2} strokeLinecap="round" opacity={0.7} />
      <path d="M58 -6 L64 -6 M58 7 L64 7" stroke={pal.faceLine} strokeWidth={1.6} strokeLinecap="round" opacity={0.6} />
      <path d={shape(thumb)} fill={pal.face} />
      <path d="M18 -17 Q36 -30 56 -29" fill="none" stroke={pal.rim} strokeWidth={2.2} opacity={pal.rimAmt * 0.8} strokeLinecap="round" />
      {grip > 0 ? <path d="M40 -21 Q52 -22 58 -16 M60 -8 Q64 0 60 8" fill="none" stroke={pal.rimHot} strokeWidth={2.4} opacity={grip} strokeLinecap="round" /> : null}
    </g>
  );
};

/** Her phone, back to camera (generic, no brand), centred on 0,0, long axis vertical. */
const PhoneBack: React.FC<{pal: Pal}> = ({pal}) => (
  <g>
    <rect x={-24} y={-50} width={48} height={100} rx={9} fill={pal.phone} />
    <rect x={-24} y={-50} width={48} height={100} rx={9} fill="none" stroke={pal.rim} strokeWidth={2} opacity={pal.rimAmt * 0.75} />
    <rect x={-14} y={-40} width={16} height={22} rx={5} fill={mix(pal.phone, NIGHT.ink, 0.5)} />
    <circle cx={-6} cy={-34} r={3.2} fill={NIGHT.ink} stroke={alpha(pal.rim, 0.5)} strokeWidth={1} />
    <path d="M-22 40 Q-22 48 -14 48" fill="none" stroke={alpha(pal.under, pal.underAmt * 1.4)} strokeWidth={2} />
  </g>
);

/** The thermos's cup-lid in her hand, centred on its base. */
const Cup: React.FC<{pal: Pal}> = ({pal}) => (
  <g>
    <path d="M-20 -46 L20 -46 L16 0 L-16 0 Z" fill={pal.metal} />
    <path d="M-20 -46 L20 -46" stroke={pal.metalHi} strokeWidth={3} />
    <path d="M14 -44 L11 -2" stroke={pal.rim} strokeWidth={2} opacity={pal.rimAmt * 0.7} />
    <ellipse cx={0} cy={-46} rx={20} ry={4} fill={mix(pal.metal, NIGHT.ink, 0.5)} />
  </g>
);

/**
 * Binoculars (porro), local: near eyepiece at 0,0, pointing +x. Two barrels:
 * the far one offset back by the eye spacing, the near one in front.
 */
export const BinocularsArt: React.FC<{rim?: string; under?: string; rimAmount?: number; underAmount?: number; lens?: string; uidPrefix?: string}> = ({rim = NIGHT.tealSoft, under = GREEN, rimAmount = 1, underAmount = 0.4, lens = NIGHT.teal}) => {
  const uid = useUid('bn');
  const body = mix(NIGHT.ink, NIGHT.wallLow, 0.7);
  const rubber = mix(NIGHT.ink, NIGHT.wall, 0.4);
  const barrel = (dx: number, dy: number, s: number, key: string, front: boolean) => (
    <g key={key} transform={`translate(${dx} ${dy}) scale(${s})`}>
      {/* eyecup */}
      <rect x={-6} y={-20} width={26} height={40} rx={8} fill={rubber} />
      {/* prism housing (the porro step) */}
      <path d="M18 -26 L92 -30 Q104 -30 104 -18 L104 22 Q104 34 92 34 L18 30 Q12 30 12 22 L12 -18 Q12 -26 18 -26 Z" fill={`url(#${uid}b)`} />
      {/* objective tube */}
      <path d="M96 -34 L170 -38 Q178 -38 178 -30 L178 32 Q178 40 170 40 L96 36 Z" fill={`url(#${uid}b)`} />
      <path d="M118 -36 L118 38 M134 -37 L134 39" stroke={alpha(NIGHT.ink, 0.6)} strokeWidth={2} />
      {/* objective lens, nearly edge-on */}
      <ellipse cx={178} cy={1} rx={12} ry={38} fill={mix(NIGHT.ink, lens, 0.18)} />
      <ellipse cx={180} cy={1} rx={8} ry={31} fill={`url(#${uid}l)`} />
      <path d="M178 -37 Q190 -20 189 1" fill="none" stroke={rim} strokeWidth={2.5} opacity={rimAmount} />
      {front ? (
        <>
          <path d="M20 -25 L92 -29 Q103 -29 104 -20 M98 -33 L170 -37 Q177 -37 178 -31" fill="none" stroke={rim} strokeWidth={3} opacity={rimAmount} strokeLinecap="round" />
          <path d="M20 29 L92 33 M98 35 L170 39" fill="none" stroke={under} strokeWidth={2.5} opacity={underAmount} strokeLinecap="round" />
        </>
      ) : (
        <path d="M98 -33 L170 -37" fill="none" stroke={rim} strokeWidth={2} opacity={rimAmount * 0.6} strokeLinecap="round" />
      )}
    </g>
  );
  return (
    <g>
      <defs>
        <linearGradient id={`${uid}b`} x1="0" y1="-40" x2="0" y2="40" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={mix(body, rim, 0.18 * rimAmount)} />
          <stop offset="0.35" stopColor={body} />
          <stop offset="1" stopColor={NIGHT.ink} />
        </linearGradient>
        <radialGradient id={`${uid}l`} cx="0.35" cy="0.3" r="0.9">
          <stop offset="0" stopColor={lens} stopOpacity={0.85} />
          <stop offset="0.5" stopColor={mix(NIGHT.ink, lens, 0.4)} stopOpacity={0.9} />
          <stop offset="1" stopColor={NIGHT.ink} />
        </radialGradient>
      </defs>
      {barrel(48, -10, 0.92, 'far', false)}
      {/* hinge */}
      <rect x={52} y={-22} width={40} height={30} rx={10} fill={mix(NIGHT.ink, NIGHT.wallLow, 0.5)} />
      {barrel(0, 0, 1, 'near', true)}
    </g>
  );
};

// ─── Head ───────────────────────────────────────────────────────────────────

const Head: React.FC<{q: Pose; pal: Pal; uid: string}> = ({q, pal, uid}) => {
  const sleep = smoothstep(q.asleep);
  const blink = Math.max(q.blink, sleep);
  const sq = q.squint;
  const raiseN = q.browRaise * 10;
  const raiseF = q.browRaise * 10 * q.browAsym;
  const sm = q.smirk;
  const open = Math.max(q.mouthOpen, sleep * 0.6);

  // eyes: upper lid edge (y offset from the eye's top arc), lower lid
  const eye = (e: typeof EYE_N, key: string, far: boolean) => {
    const [cx, cy] = e.c;
    const hw = e.w / 2;
    const top = cy - e.h * 0.62;
    const bot = cy + e.h * 0.38;
    // outer corner sits slightly lower on the near eye (left), higher on the far (right)
    const oL: P = [cx - hw, cy + (far ? 0 : 1)];
    const oR: P = [cx + hw, cy + (far ? 1 : 0)];
    const lidDown = clamp01(blink * 1.02 + sq * 0.32);
    const lowUp = sq * 0.38;
    const upperY = lerp(top, bot, lidDown);
    const lowerY = lerp(bot, lerp(top, bot, 0.5), lowUp);
    const eyeD = `M${oL[0]} ${oL[1]} Q${cx} ${top - 3} ${oR[0]} ${oR[1]} Q${cx} ${bot + 2} ${oL[0]} ${oL[1]} Z`;
    const ix = cx + q.lookX * hw * 0.42 + (far ? 1 : 2);
    const iy = cy + q.lookY * 2 - 0.5;
    const lidD = `M${oL[0] - 2} ${oL[1]} Q${cx} ${upperY - 4 - (top - upperY) * 0.2} ${oR[0] + 2} ${oR[1]} L${oR[0] + 4} ${top - 12} L${oL[0] - 4} ${top - 12} Z`;
    const lowD = `M${oL[0] - 2} ${oL[1] + 0.5} Q${cx} ${lowerY + 3} ${oR[0] + 2} ${oR[1] + 0.5} L${oR[0] + 3} ${bot + 10} L${oL[0] - 3} ${bot + 10} Z`;
    const lash = `M${oL[0] - 1} ${oL[1]} Q${cx} ${upperY - 4 - (top - upperY) * 0.2} ${oR[0] + 1} ${oR[1]}`;
    return (
      <g key={key}>
        <defs>
          <clipPath id={`${uid}e${key}`}>
            <path d={eyeD} />
          </clipPath>
        </defs>
        <path d={eyeD} fill={pal.eyeWhite} />
        <g clipPath={`url(#${uid}e${key})`}>
          <circle cx={ix} cy={iy} r={far ? 4.6 : 6.4} fill={pal.iris} />
          <circle cx={ix + 1.6} cy={iy - 2} r={far ? 1 : 1.5} fill={pal.rimHot} opacity={0.85} />
          <path d={lidD} fill={pal.face} />
          <path d={lowD} fill={pal.face} />
        </g>
        <path d={lash} fill="none" stroke={pal.faceLine} strokeWidth={far ? 2.4 : 3} strokeLinecap="round" />
        {/* crease above the lid */}
        {!far ? <path d={`M${oL[0] + 3} ${top - 4 + lidDown * 3} Q${cx} ${top - 9 + lidDown * 4} ${oR[0] - 2} ${top - 3 + lidDown * 3}`} fill="none" stroke={pal.faceLine} strokeWidth={1.4} opacity={0.6} /> : null}
        {/* crow's feet at the outer corner of the near eye */}
        {!far ? <path d={`M${oL[0] - 4} ${oL[1] - 3} l-7 -3 M${oL[0] - 4} ${oL[1] + 1} l-8 1 M${oL[0] - 3} ${oL[1] + 5} l-6 4`} stroke={pal.faceLine} strokeWidth={1.2} opacity={0.35 + sm * 0.3 + sq * 0.3} strokeLinecap="round" /> : null}
      </g>
    );
  };

  // brows: tapered shapes, head (inner, right) to tail (left)
  const browN: C[] = [[61, -184 - raiseN * 0.7], [38, -193 - raiseN * 1.1], [12, -182 - raiseN * 0.6], [14, -186 - raiseN * 0.65], [38, -199 - raiseN * 1.1], [60, -191 - raiseN * 0.7]];
  const browF: C[] = [[77, -185 - raiseF * 0.8], [92, -189 - raiseF], [101, -182 - raiseF * 0.8], [100, -186 - raiseF * 0.8], [92, -195 - raiseF], [77, -191 - raiseF * 0.8]];

  // mouth: near corner (smirk lifts it), seam to the profile
  const mc: P = [72 - sm * 2, -71 - sm * 6];
  const seam = `M${mc[0]} ${mc[1]} Q${86} ${-68.5 + sm * -1.5} ${105} ${-70}`;
  const mouthGap = open > 0.01 ? `M${mc[0] + 4} ${mc[1] + 0.5} Q${88} ${-69 + open * 5} ${104} ${-69} Q${88} ${-70 - open * 1} ${mc[0] + 4} ${mc[1] + 0.5} Z` : '';

  // glint: a diagonal band crossing both lenses
  const g = q.glint;
  const gx = lerp(-10, 120, g);
  const glintOn = g > 0.001 && g < 0.999;

  return (
    <g>
      <defs>
        <linearGradient id={`${uid}lit`} x1="10" y1="0" x2="126" y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={pal.rim} stopOpacity={0} />
          <stop offset="0.55" stopColor={pal.rim} stopOpacity={0.06 + 0.1 * pal.d} />
          <stop offset="1" stopColor={pal.rim} stopOpacity={0.32 + 0.1 * pal.d} />
        </linearGradient>
        <linearGradient id={`${uid}und`} x1="0" y1="-74" x2="0" y2="-14" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={pal.under} stopOpacity={0} />
          <stop offset="1" stopColor={pal.under} stopOpacity={pal.underAmt * 0.5} />
        </linearGradient>
        <linearGradient id={`${uid}shd`} x1="-20" y1="0" x2="50" y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={NIGHT.ink} stopOpacity={0.55} />
          <stop offset="1" stopColor={NIGHT.ink} stopOpacity={0} />
        </linearGradient>
        <linearGradient id={`${uid}hair`} x1="0" y1="-320" x2="0" y2="-36" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={pal.hair} />
          <stop offset="0.7" stopColor={mix(pal.hair, pal.hairDeep, 0.6)} />
          <stop offset="1" stopColor={pal.hairDeep} />
        </linearGradient>
        <linearGradient id={`${uid}hairlit`} x1="-40" y1="0" x2="124" y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={pal.rim} stopOpacity={0} />
          <stop offset="0.6" stopColor={pal.rim} stopOpacity={0.05} />
          <stop offset="1" stopColor={pal.rim} stopOpacity={0.4} />
        </linearGradient>
        <clipPath id={`${uid}face`}>
          <path d={shape(FACE)} />
        </clipPath>
        <clipPath id={`${uid}lens`}>
          <path d={shape(LENS_N)} />
          <path d={shape(LENS_F)} />
        </clipPath>
        <linearGradient id={`${uid}glass`} x1="0" y1="-178" x2="0" y2="-139" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={pal.rim} stopOpacity={0.22} />
          <stop offset="0.5" stopColor={pal.rim} stopOpacity={0.05} />
          <stop offset="1" stopColor={pal.rim} stopOpacity={0.14} />
        </linearGradient>
      </defs>

      {/* hair, back mass */}
      <path d={shape(HAIR_BACK)} fill={`url(#${uid}hair)`} />
      <path d={shape(HAIR_BACK)} fill={`url(#${uid}hairlit)`} />

      {/* face */}
      <path d={shape(FACE)} fill={pal.face} />
      <g clipPath={`url(#${uid}face)`}>
        <rect x={-80} y={-300} width={220} height={300} fill={`url(#${uid}lit)`} />
        <rect x={-80} y={-300} width={220} height={300} fill={`url(#${uid}und)`} />
        <rect x={-80} y={-300} width={220} height={300} fill={`url(#${uid}shd)`} />
        {/* eye socket and cheekbone planes */}
        <ellipse cx={40} cy={-160} rx={34} ry={20} fill={pal.faceDeep} opacity={0.4} />
        <path d="M40 -128 Q70 -118 96 -126 Q84 -110 58 -110 Q44 -114 40 -128 Z" fill={pal.rim} opacity={0.07 + 0.08 * pal.d} />
        {/* under-nose and under-lip shadows */}
        <path d="M96 -90 Q104 -84 110 -88 L106 -86 Q100 -84 96 -90 Z" fill={pal.faceLine} opacity={0.6} />
        <path d="M86 -54 Q96 -50 102 -55 Q96 -46 86 -54 Z" fill={pal.faceLine} opacity={0.5} />
      </g>
      {/* nose wing, nasolabial fold */}
      <path d="M97 -103 Q94 -95 101 -92 Q106 -91 111 -93" fill="none" stroke={pal.faceLine} strokeWidth={2} strokeLinecap="round" opacity={0.85} />
      <path d={`M93 -99 Q83 -88 ${76 - sm * 3} ${-78 - sm * 4}`} fill="none" stroke={pal.faceLine} strokeWidth={1.6} strokeLinecap="round" opacity={0.35 + sm * 0.35} />
      {/* mouth */}
      <path d={`M${mc[0] + 4} ${mc[1] - 4} Q90 ${-79} 108 ${-79} L111 ${-75} L105 -70 Q88 ${-69.5 - sm} ${mc[0]} ${mc[1]} Z`} fill={pal.lip} opacity={0.7} />
      <path d={`M${mc[0] + 6} ${mc[1] + 2} Q90 -64 104 -65 L108 -64 Q100 -57 90 -59 Q78 -61 ${mc[0] + 6} ${mc[1] + 2} Z`} fill={pal.lip} opacity={0.55} />
      <path d="M84 -61 Q94 -60 104 -63" fill="none" stroke={pal.under} strokeWidth={2} opacity={pal.underAmt * 0.9} strokeLinecap="round" />
      {mouthGap ? <path d={mouthGap} fill={NIGHT.ink} opacity={0.85} /> : null}
      <path d={seam} fill="none" stroke={pal.faceLine} strokeWidth={2.6} strokeLinecap="round" />
      {/* the smirk: corner tuck + crease */}
      <path d={`M${mc[0] + 1} ${mc[1] + 1} q-4 -2 -5 -6`} fill="none" stroke={pal.faceLine} strokeWidth={2} strokeLinecap="round" opacity={0.1 + sm * 0.9} />
      {sm > 0.02 ? <path d={`M${mc[0] - 6} ${mc[1] - 10} q-3 6 0 13`} fill="none" stroke={pal.faceLine} strokeWidth={1.4} strokeLinecap="round" opacity={sm * 0.6} /> : null}

      {/* eyes and brows */}
      {eye(EYE_F, 'f', true)}
      {eye(EYE_N, 'n', false)}
      <path d={shape(browF)} fill={pal.brow} />
      <path d={shape(browN)} fill={pal.brow} />
      <path d={`M14 ${-186 - raiseN * 0.65} Q38 ${-199 - raiseN * 1.1} 60 ${-191 - raiseN * 0.7}`} fill="none" stroke={pal.rim} strokeWidth={1.6} opacity={0.35 * pal.rimAmt} />

      {/* rim light along the profile */}
      <path d={shape(FACE_FRONT, false)} fill="none" stroke={pal.rim} strokeWidth={9} opacity={0.14 * pal.rimAmt} strokeLinejoin="round" />
      <path d={shape(FACE_FRONT, false)} fill="none" stroke={pal.rim} strokeWidth={3.2} opacity={pal.rimAmt} strokeLinejoin="round" />
      <path d="M100 -98 Q112 -88 120 -95" fill="none" stroke={pal.rimHot} strokeWidth={2} opacity={0.5 * pal.rimAmt} />
      {/* under-light on the jaw and chin */}
      <path d="M100 -32 Q90 -18 56 -15 Q34 -12 22 -8" fill="none" stroke={pal.under} strokeWidth={3} opacity={pal.underAmt} strokeLinecap="round" />

      {/* hair over the face: fringe and the near curtain of the bob */}
      <path d={shape(HAIR_FRONT)} fill={`url(#${uid}hair)`} />
      <path d={shape(HAIR_FRONT)} fill={`url(#${uid}hairlit)`} />
      {HAIR_STRANDS.map((s, i) => (
        <path key={i} d={shape(s, false)} fill="none" stroke={pal.hairDeep} strokeWidth={2.2} opacity={0.55} strokeLinecap="round" />
      ))}
      <path d="M-30 -312 Q40 -318 96 -284 Q116 -262 121 -233" fill="none" stroke={pal.hairHi} strokeWidth={3.4} opacity={0.75 * pal.rimAmt} strokeLinecap="round" />
      <path d="M-120 -284 Q-60 -326 -10 -320" fill="none" stroke={pal.hairHi} strokeWidth={2.2} opacity={0.35 * pal.rimAmt} strokeLinecap="round" />
      <path d="M-11 -80 Q-4 -56 -1 -52 Q-8 -40 -16 -38" fill="none" stroke={pal.under} strokeWidth={2.6} opacity={pal.underAmt * 0.9} strokeLinecap="round" />

      {/* reading glasses */}
      <g>
        <path d={shape(LENS_N)} fill={`url(#${uid}glass)`} />
        <path d={shape(LENS_F)} fill={`url(#${uid}glass)`} />
        {glintOn ? (
          <g clipPath={`url(#${uid}lens)`}>
            <path d={`M${gx - 20} -190 L${gx + 4} -190 L${gx - 16} -130 L${gx - 40} -130 Z`} fill={pal.rimHot} opacity={0.75 * Math.sin(g * Math.PI)} />
            <path d={`M${gx + 10} -190 L${gx + 16} -190 L${gx - 4} -130 L${gx - 10} -130 Z`} fill={pal.rimHot} opacity={0.55 * Math.sin(g * Math.PI)} />
          </g>
        ) : null}
        <path d={shape(LENS_N)} fill="none" stroke={pal.frame} strokeWidth={4.5} />
        <path d={shape(LENS_F)} fill="none" stroke={pal.frame} strokeWidth={4} />
        <path d="M62 -166 Q70 -173 78 -167" fill="none" stroke={pal.frame} strokeWidth={4} strokeLinecap="round" />
        <path d="M8 -166 L-16 -160" stroke={pal.frame} strokeWidth={4} strokeLinecap="round" />
        {/* rim on the frames' top edges */}
        <path d="M12 -174 Q36 -180 60 -174" fill="none" stroke={pal.rim} strokeWidth={1.6} opacity={0.6 * pal.rimAmt} />
        <path d="M80 -175 Q92 -179 103 -173 L105 -160" fill="none" stroke={pal.rimHot} strokeWidth={1.8} opacity={0.8 * pal.rimAmt} />
        <path d="M16 -141 Q36 -137 58 -144" fill="none" stroke={pal.under} strokeWidth={1.6} opacity={pal.underAmt * 0.8} />
        <circle cx={8} cy={-166} r={2.2} fill={pal.brass} />
      </g>
    </g>
  );
};

// ─── Body layer ─────────────────────────────────────────────────────────────

const Torso: React.FC<{s: Solved; pal: Pal; uid: string}> = ({s, pal, uid}) => {
  const y = s.bodyY;
  const T = mapC(TORSO, (p) => [p[0], p[1] + y]);
  const V = (pts: C[]) => mapC(pts, (p) => [p[0], p[1] + y]);
  const vNeck: C[] = V([[-40, 22], [64, 32], [52, 110], [38, 232, 1], [16, 110]]);
  const bandR: C[] = V([[62, 30], [74, 34], [60, 120], [48, 236], [44, 900, 1], [28, 900, 1], [32, 236], [46, 116]]);
  const bandL: C[] = V([[-40, 20], [-30, 22], [6, 110], [38, 232], [30, 236], [-2, 116]]);
  const collarN: C[] = V([[-46, 16], [-26, 30], [-4, 64], [2, 90, 1], [-24, 70], [-54, 34]]);
  const collarF: C[] = V([[56, 26], [70, 30], [72, 50], [58, 86, 1], [50, 60], [48, 36]]);
  return (
    <g>
      <defs>
        <linearGradient id={`${uid}knit2`} x1="-240" y1="0" x2="260" y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={pal.knitDeep} />
          <stop offset="0.45" stopColor={pal.knit} />
          <stop offset="0.85" stopColor={mix(pal.knit, pal.knitHi, 0.3)} />
          <stop offset="1" stopColor={pal.knit} />
        </linearGradient>
        <linearGradient id={`${uid}lap`} x1="0" y1={240 + y} x2="0" y2={460 + y} gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={NIGHT.ink} stopOpacity={0} />
          <stop offset="1" stopColor={NIGHT.ink} stopOpacity={0.94 - 0.4 * pal.d} />
        </linearGradient>
        <linearGradient id={`${uid}neck`} x1="0" y1="-30" x2="0" y2="70" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={NIGHT.ink} stopOpacity={0.55} />
          <stop offset="0.5" stopColor={NIGHT.ink} stopOpacity={0.1} />
          <stop offset="1" stopColor={pal.under} stopOpacity={pal.underAmt * 0.25} />
        </linearGradient>
      </defs>
      {/* neck, shadowed under the jaw */}
      <path d={shape(NECK)} fill={pal.faceDeep} />
      <path d={shape(NECK)} fill={`url(#${uid}neck)`} />
      <path d="M33 0 Q38 30 44 64" fill="none" stroke={pal.rim} strokeWidth={2} opacity={pal.rimAmt * 0.3} />
      {/* cardigan */}
      <path d={shape(T)} fill={`url(#${uid}knit2)`} />
      <path d={shape(T)} fill={`url(#${uid}knitv)`} />
      {/* the blouse in the V, the ribbed bands either side, brass buttons */}
      <path d={shape(vNeck)} fill={pal.blouseDeep} />
      <path d={`M-30 ${30 + y} Q10 ${60 + y} 60 ${40 + y}`} fill="none" stroke={pal.blouse} strokeWidth={10} opacity={0.5} />
      <path d={shape(bandL)} fill={pal.knitHi} opacity={0.42} />
      <path d={shape(bandR)} fill={pal.knitHi} opacity={0.5} />
      <path d={`M68 ${34 + y} L54 ${118 + y} L42 ${236 + y} L38 ${900 + y}`} fill="none" stroke={pal.rim} strokeWidth={1.6} opacity={pal.rimAmt * 0.45} />
      {[0, 1, 2, 3].map((i) => (
        <g key={i}>
          <circle cx={i === 0 ? 46 : 38} cy={(i === 0 ? 206 : 206 + i * 66) + y} r={5.5} fill={pal.brass} />
          <circle cx={(i === 0 ? 46 : 38) + 1.5} cy={(i === 0 ? 204 : 204 + i * 66) + y} r={2} fill={pal.rimHot} opacity={0.6 * pal.rimAmt} />
        </g>
      ))}
      {/* blouse collar points over the cardigan */}
      <path d={shape(collarN)} fill={pal.blouse} />
      <path d={shape(collarF)} fill={mix(pal.blouse, pal.rim, 0.2)} />
      <path d={`M74 ${30 + y} L80 ${52 + y} L62 ${98 + y}`} fill="none" stroke={pal.rim} strokeWidth={1.8} opacity={pal.rimAmt * 0.7} strokeLinejoin="round" />
      {/* knit folds at the near shoulder and chest */}
      <path d={`M-150 ${116 + y} Q-118 ${190 + y} -126 ${290 + y}`} fill="none" stroke={pal.knitDeep} strokeWidth={4} opacity={0.6} strokeLinecap="round" />
      <path d={`M150 ${136 + y} Q172 ${206 + y} 162 ${306 + y}`} fill="none" stroke={pal.knitDeep} strokeWidth={4} opacity={0.5} strokeLinecap="round" />
      {/* rim on the far shoulder (toward the windshield), a whisper on the near one */}
      <path d={`M74 ${36 + y} Q140 ${62 + y} 196 ${100 + y} Q234 ${134 + y} 254 ${224 + y}`} fill="none" stroke={pal.rim} strokeWidth={3.4} opacity={pal.rimAmt * 0.85} strokeLinecap="round" />
      <path d={`M-48 ${24 + y} Q-120 ${48 + y} -180 ${88 + y}`} fill="none" stroke={pal.rim} strokeWidth={2} opacity={pal.rimAmt * 0.25} strokeLinecap="round" />
      {/* falls away into the dark of the cabin toward her lap */}
      <path d={shape(T)} fill={`url(#${uid}lap)`} />
    </g>
  );
};

/** The beaded glasses chain: from the temple tips down past her jaw and round the back of her neck. */
const Chain: React.FC<{s: Solved; pal: Pal}> = ({s, pal}) => {
  const a = s.H([-10, -50]);
  const b: P = [6, 52 + s.bodyY];
  const c: P = [-36, 30 + s.bodyY];
  return (
    <path d={`M${a[0]} ${a[1]} Q${b[0] + 8} ${b[1] - 30} ${b[0]} ${b[1]} Q${c[0] + 24} ${c[1] + 16} ${c[0]} ${c[1]}`} fill="none" stroke={pal.brass} strokeWidth={4} strokeDasharray="0.1 7" strokeLinecap="round" opacity={0.9} />
  );
};

const Strap: React.FC<{s: Solved; pal: Pal}> = ({s, pal}) => {
  const lugA = add(s.binoPos, rot([46, -26], s.binoDeg));
  const lugB = add(s.binoPos, rot([60, 30], s.binoDeg));
  const l: P = [-34, 34 + s.bodyY];
  const r: P = [66, 40 + s.bodyY];
  const sag = 30 + 140 * s.up;
  const col = mix(pal.knitDeep, NIGHT.ink, 0.15);
  return (
    <g fill="none" strokeLinecap="round">
      <path d={`M${l[0]} ${l[1]} Q${l[0] - 4} ${l[1] + sag} ${lugA[0]} ${lugA[1]}`} stroke={col} strokeWidth={4} />
      <path d={`M${r[0]} ${r[1]} Q${r[0] + 14} ${r[1] + sag * 0.7} ${lugB[0]} ${lugB[1]}`} stroke={col} strokeWidth={4} />
    </g>
  );
};

/** A tapered capsule from a (width wa) to b (width wb), round both ends. */
const capsule = (a: P, b: P, wa: number, wb: number) => {
  const d = sub(b, a);
  const l = Math.hypot(d[0], d[1]) || 1;
  const n: P = [-d[1] / l, d[0] / l];
  const ra = wa / 2;
  const rb = wb / 2;
  const a1 = add(a, [n[0] * ra, n[1] * ra]);
  const a2 = add(a, [-n[0] * ra, -n[1] * ra]);
  const b1 = add(b, [n[0] * rb, n[1] * rb]);
  const b2 = add(b, [-n[0] * rb, -n[1] * rb]);
  const f = (p: P) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`;
  return `M${f(a1)} L${f(b1)} A${rb} ${rb} 0 0 0 ${f(b2)} L${f(a2)} A${ra} ${ra} 0 0 0 ${f(a1)} Z`;
};

/** The edge of a capsule that faces the light (up and toward the windshield), inset a little. */
const litEdge = (a: P, b: P, wa: number, wb: number, inset = 0.42) => {
  const d = sub(b, a);
  const l = Math.hypot(d[0], d[1]) || 1;
  let n: P = [-d[1] / l, d[0] / l];
  if (n[0] - n[1] < 0) n = [-n[0], -n[1]];
  const p1 = add(a, [n[0] * wa * inset, n[1] * wa * inset]);
  const p2 = add(b, [n[0] * wb * inset, n[1] * wb * inset]);
  return `M${p1[0].toFixed(1)} ${p1[1].toFixed(1)} L${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
};

const Arm: React.FC<{sh: P; el: P; wr: P; pal: Pal; near: boolean; uid: string}> = ({sh, el, wr, pal, near, uid}) => {
  const [w0, w1, w2] = near ? [92, 72, 56] : [84, 64, 50];
  const cuffDir = angle(sub(wr, el));
  const fill = near ? mix(pal.knit, pal.knitHi, 0.12) : pal.knitDeep;
  const sh2: P = add(sh, [-8, 10]);
  const el2: P = add(el, [-8, 10]);
  const wr2: P = add(wr, [-8, 10]);
  // a soft cast shadow on whatever is behind, then upper arm (turning away, darker) and forearm
  return (
    <g>
      {near ? (
        <g fill={NIGHT.ink} opacity={0.4}>
          <path d={capsule(sh2, el2, w0 + 6, w1 + 6)} />
          <path d={capsule(el2, wr2, w1 + 6, w2 + 6)} />
        </g>
      ) : null}
      <path d={capsule(sh, el, w0, w1)} fill={fill} />
      <path d={capsule(sh, el, w0, w1)} fill={NIGHT.ink} opacity={near ? 0.25 : 0.35} />
      <path d={capsule(el, wr, w1, w2)} fill={fill} />
      {/* the inside of the elbow */}
      <path d={litEdge(el, sh, w1 * 0.4, w1 * 0.2, -0.3)} stroke={pal.knitDeep} strokeWidth={3} opacity={0.6} strokeLinecap="round" />
      {/* ribbed cuff */}
      <g transform={place(wr, cuffDir)}>
        <rect x={-24} y={-w2 / 2 - 1} width={24} height={w2 + 2} rx={8} fill={mix(pal.knit, pal.knitHi, 0.45)} />
        <path d={`M-18 ${-w2 / 2 + 4} V${w2 / 2 - 4} M-10 ${-w2 / 2 + 3} V${w2 / 2 - 3}`} stroke={pal.knitDeep} strokeWidth={1.5} opacity={0.5} />
      </g>
      <path d={litEdge(el, wr, w1, w2)} stroke={pal.rim} strokeWidth={2.4} opacity={pal.rimAmt * (near ? 0.45 : 0.75)} strokeLinecap="round" />
      {near ? null : <path d={litEdge(sh, el, w0, w1)} stroke={pal.rim} strokeWidth={2} opacity={pal.rimAmt * 0.45} strokeLinecap="round" />}
    </g>
  );
};

// ─── Rig A ──────────────────────────────────────────────────────────────────

export type RitaLayer = 'all' | 'body' | 'front';

/** Rig A as an SVG <g> in rest-framing px (draw inside your own <svg>, e.g. under a camera transform). */
export const RitaAArt: React.FC<RitaPose & {layer?: RitaLayer}> = ({layer = 'all', ...pose}) => {
  const uid = useUid('ra');
  const q = dflt(pose);
  const pal = palette(q.dawn);
  const s = solve(q);
  const showBody = layer !== 'front';
  const showFront = layer !== 'body';
  const farInFront = s.penW > 0.02;
  const nearDeg = angle(sub(s.wristN, s.elbowN));
  const farDeg = angle(sub(s.wristF, s.elbowF));
  // the object in the near hand
  const holdPhone = q.phone && s.phone > 0.02 && !(s.nearBino && s.binoGrip > 0.5);
  const holdCup = q.sip > 0.02;
  const binoHeldNear = s.nearBino && s.binoGrip > 0.5;

  const defs = (
    <defs>
      <linearGradient id={`${uid}knit`} x1="-240" y1="0" x2="260" y2="0" gradientUnits="userSpaceOnUse">
        <stop offset="0" stopColor={pal.knitDeep} />
        <stop offset="0.5" stopColor={pal.knit} />
        <stop offset="1" stopColor={mix(pal.knit, pal.knitHi, 0.3)} />
      </linearGradient>
      <linearGradient id={`${uid}knitv`} x1="0" y1="-100" x2="0" y2="430" gradientUnits="userSpaceOnUse">
        <stop offset="0" stopColor={NIGHT.ink} stopOpacity={0} />
        <stop offset="1" stopColor={NIGHT.ink} stopOpacity={0.5 * pal.n + 0.1} />
      </linearGradient>
      <linearGradient id={`${uid}hand`} x1="0" y1="-24" x2="0" y2="24" gradientUnits="userSpaceOnUse">
        <stop offset="0" stopColor={pal.rim} stopOpacity={0.18} />
        <stop offset="0.5" stopColor={pal.rim} stopOpacity={0} />
        <stop offset="1" stopColor={pal.under} stopOpacity={pal.underAmt * 0.6} />
      </linearGradient>
    </defs>
  );

  const nearArm = (
    <g>
      <Arm sh={s.sN} el={s.elbowN} wr={s.wristN} pal={pal} near uid={uid} />
      {holdPhone ? (
        <g transform={place(add(s.wristN, rot([40, 0], nearDeg)), nearDeg + 90 - 8)}>
          <PhoneBack pal={pal} />
        </g>
      ) : null}
      {holdCup ? (
        <g transform={place(add(s.wristN, rot([44, -6], nearDeg)), nearDeg + 90)}>
          <Cup pal={pal} />
          <g transform={`translate(0 -50) rotate(${-(nearDeg + 90)})`}>
            <Steam amount={clamp01(q.sip * 2) * (1 - pal.d * 0.5)} t={q.t} scale={0.5} />
          </g>
        </g>
      ) : null}
      <Fist pal={pal} at={s.wristN} deg={nearDeg} grip={q.grip} uid={uid} flip={holdPhone || holdCup || binoHeldNear} />
    </g>
  );
  // writing: the far arm reaches behind the pad; the hand comes over its top edge to the pen tip
  const penDeg = lerp(farDeg, angle(sub(s.penLocal, s.wristF)), s.penW);
  const farHand = (
    <g>
      {s.penW > 0.02 ? (
        <g opacity={clamp01(s.penW * 3)}>
          <path d={`M${s.penLocal[0]} ${s.penLocal[1]} L${s.wristF[0] + Math.cos((penDeg * Math.PI) / 180) * 30 - 4} ${s.wristF[1] + Math.sin((penDeg * Math.PI) / 180) * 30 - 16}`} stroke={mix(NIGHT.ink, LIGHT.infoSoftForeground, 0.55)} strokeWidth={6} strokeLinecap="round" />
          <path d={`M${s.penLocal[0]} ${s.penLocal[1]} l-3 -5`} stroke={pal.metalHi} strokeWidth={3} strokeLinecap="round" />
        </g>
      ) : null}
      <Fist pal={pal} at={s.wristF} deg={penDeg} uid={uid} scale={0.92} grip={0} />
    </g>
  );
  const farArm = <Arm sh={s.sF} el={s.elbowF} wr={s.wristF} pal={pal} near={false} uid={uid} />;
  const binos = (
    <g transform={place(s.binoPos, s.binoDeg, 0.95)}>
      <BinocularsArt rim={pal.rim} under={pal.under} rimAmount={pal.rimAmt} underAmount={pal.underAmt} lens={lerp(0, 1, pal.d) > 0.5 ? LIGHT.primary : NIGHT.teal} />
    </g>
  );

  return (
    <g transform={`translate(${NP[0]} ${NP[1]})`}>
      {defs}
      {showBody ? (
        <g>
          <Torso s={s} pal={pal} uid={uid} />
          <Chain s={s} pal={pal} />
          {s.up < 0.5 ? <Strap s={s} pal={pal} /> : null}
          {s.up < 0.5 ? binos : null}
          <g transform={`translate(${s.headOff[0]} ${s.headOff[1]}) rotate(${s.headDeg})`}>
            <Head q={q} pal={pal} uid={uid} />
          </g>
          {farArm}
          {!farInFront ? farHand : null}
          {s.up >= 0.5 ? binos : null}
        </g>
      ) : null}
      {showFront ? (
        <g>
          {farInFront ? farHand : null}
          {nearArm}
        </g>
      ) : null}
    </g>
  );
};

const camT = (c?: Crop) => {
  if (!c) return undefined;
  const ox = c.ox ?? 540;
  const oy = c.oy ?? 960;
  return `translate(${ox + c.x} ${oy + c.y}) scale(${c.scale}) translate(${-ox} ${-oy})`;
};

/** Rig A as a full-frame layer. `camera` uses CarInterior's convention, so pass the same one. */
export const RitaA: React.FC<RitaPose & {layer?: RitaLayer; camera?: Crop; style?: React.CSSProperties}> = ({camera, style, ...rest}) => (
  <AbsoluteFill style={{pointerEvents: 'none', ...style}}>
    <svg width={1080} height={1920} viewBox="0 0 1080 1920" style={{position: 'absolute', inset: 0, overflow: 'visible'}}>
      <g transform={camT(camera)}>
        <RitaAArt {...rest} />
      </g>
    </svg>
  </AbsoluteFill>
);

/** Where things are on Rig A for a pose, in rest-framing px (map through carToFrame for a camera). */
export const ritaAPoints = (pose: RitaPose) => {
  const q = dflt(pose);
  const s = solve(q);
  const abs = (p: P): P => [p[0] + NP[0], p[1] + NP[1]];
  const nearDeg = angle(sub(s.wristN, s.elbowN));
  return {
    neck: abs([0, 0]),
    /** Centre of the phone in her near hand. */
    phone: abs(add(s.wristN, rot([40, 0], nearDeg))),
    phoneDeg: nearDeg + 90 - 8,
    nearHand: abs(s.wristN),
    farHand: abs(s.wristF),
    /** Lens centres of her reading glasses (glint anchors). */
    lensNear: abs(s.H([36, -158])),
    lensFar: abs(s.H([90, -158])),
    mouth: abs(s.H([88, -70])),
    /** The binoculars' two objective lenses (S04's match-cut anchors). */
    objectives: [abs(add(s.binoPos, rot([179 * 0.95, 1 * 0.95], s.binoDeg))), abs(add(s.binoPos, rot([(48 + 178 * 0.92) * 0.95, (-10 + 1 * 0.92) * 0.95], s.binoDeg)))] as [P, P],
  };
};


/**
 * A steno-pad point (pad units, e.g. stenoPenTip()) → rest-framing px, for `penAt`.
 * Mirrors CarInterior's CarFront pad transform (translate to CAR.pad, rotate −3°,
 * scale w/600 by w/600 × 0.62); keep in step if that transform changes.
 */
export const padToRest = (p: readonly [number, number]): P => {
  const sx = CAR.pad.w / PAD_BOX.w;
  const sy = sx * 0.62;
  const x = p[0] * sx;
  const y = p[1] * sy;
  const r = (-3 * Math.PI) / 180;
  return [CAR.pad.x + x * Math.cos(r) - y * Math.sin(r), CAR.pad.y + x * Math.sin(r) + y * Math.cos(r)];
};

// ─── Rig B: profile silhouette, phone to her ear (S07) ──────────────────────

// Head-local, true profile facing right (same units as rig A's head).
const PROFILE_FACE: C[] = [
  [18, -232],
  [72, -262],
  ...FACE_FRONT,
  [60, -15],
  [30, -22],
  [6, -44], // jaw angle
  [-4, -80],
  [0, -130],
  [8, -190],
];
const PROFILE_HAIR: C[] = [
  [-30, -324],
  [50, -314],
  [102, -278],
  [121, -234, 1],
  [100, -230],
  [60, -226],
  [24, -214],
  [8, -180],
  [-2, -130],
  [-8, -80],
  [-2, -48],
  [-18, -36, 1],
  [-80, -36],
  [-140, -52],
  [-172, -110],
  [-180, -200],
  [-150, -284],
  [-96, -320],
];
const PROFILE_FRINGE: C[] = [
  [-20, -306],
  [52, -312],
  [102, -278],
  [121, -234, 1],
  [98, -234],
  [70, -244],
  [36, -236],
  [14, -222],
  [2, -196],
  [-12, -250],
];
const PROFILE_STRANDS: C[][] = [
  [[-120, -280], [-160, -200], [-150, -110], [-110, -50]],
  [[-70, -300], [-110, -220], [-104, -120], [-70, -44]],
  [[-24, -306], [-56, -230], [-50, -130], [-30, -46]],
];
const PROFILE_NECK: C[] = [[-30, -50], [30, -22], [40, 20], [50, 64], [-6, 74], [-40, 62], [-38, 0]];
const PROFILE_BODY: C[] = [
  [-56, 36],
  [20, 46],
  [70, 60],
  [140, 110],
  [176, 200],
  [190, 600, 1],
  [-280, 600, 1],
  [-270, 220],
  [-230, 110],
  [-140, 60],
];

export type RitaBProps = {
  /** Where the neck pivot sits in the frame, and the scale (S07 default: head at y ≈ 1320–1520). */
  x?: number;
  y?: number;
  scale?: number;
  /** 0..1 knuckles tighten on the phone (S07 at 14.5): a hot rim on the knuckles. */
  grip?: number;
  /** 0..1 lids closed. */
  blink?: number;
  /** 0..1 brows up. */
  browRaise?: number;
  /** 0..1 lips parted (simple talk flaps if a scene wants them). */
  mouthOpen?: number;
  /** Seconds, for breathing. */
  t?: number;
  /** Teal from the windshield (side) and green from the dash (below) at full; 0..1 scales both. */
  light?: number;
};

/** Rig B as an SVG <g> in its own px (neck pivot at 0,0). */
export const RitaBArt: React.FC<Omit<RitaBProps, 'x' | 'y' | 'scale'>> = ({grip = 0, blink = 0, browRaise = 0, mouthOpen = 0, t = 0, light = 1}) => {
  const uid = useUid('rb');
  const pal = palette(0);
  const L = clamp01(light);
  const b = breath(t, 0.25, 2);
  const g = clamp01(grip);
  const sil = mix(NIGHT.ink, pal.face, 0.75);
  const hair = mix(NIGHT.ink, pal.hair, 0.8);
  const knit = mix(NIGHT.ink, pal.knit, 0.85);
  const rb = browRaise * 8;
  const lid = clamp01(blink);
  // phone pressed to her ear (top behind the ear, bottom toward her mouth), the hand wrapped round it
  const phoneAt: P = [-6, -120];
  const phoneDeg = -24;
  const wrist = add(phoneAt, rot([-34, 76], phoneDeg));
  const elbow: P = [40, 150];
  return (
    <g transform={`translate(0 ${-b})`}>
      <defs>
        <linearGradient id={`${uid}rim`} x1="0" y1="0" x2="128" y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={pal.rim} stopOpacity={0} />
          <stop offset="0.6" stopColor={pal.rim} stopOpacity={0.06 * L} />
          <stop offset="1" stopColor={pal.rim} stopOpacity={0.34 * L} />
        </linearGradient>
        <linearGradient id={`${uid}und`} x1="0" y1="-74" x2="0" y2="-12" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={GREEN} stopOpacity={0} />
          <stop offset="1" stopColor={GREEN} stopOpacity={0.3 * L} />
        </linearGradient>
        <linearGradient id={`${uid}hair`} x1="-180" y1="-320" x2="120" y2="-60" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={mix(hair, NIGHT.ink, 0.5)} />
          <stop offset="0.75" stopColor={hair} />
          <stop offset="1" stopColor={mix(hair, pal.rim, 0.25 * L)} />
        </linearGradient>
        <linearGradient id={`${uid}body`} x1="0" y1="30" x2="0" y2="360" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={knit} />
          <stop offset="1" stopColor={NIGHT.ink} />
        </linearGradient>
        <linearGradient id={`${uid}neck`} x1="0" y1="-40" x2="0" y2="70" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={NIGHT.ink} stopOpacity={0.6} />
          <stop offset="1" stopColor={NIGHT.ink} stopOpacity={0} />
        </linearGradient>
        <clipPath id={`${uid}eye`}>
          <path d="M77 -159 Q87 -166 97 -160 Q89 -152 77 -159 Z" />
        </clipPath>
      </defs>
      {/* shoulders and chest, falling into the dark */}
      <path d={shape(PROFILE_BODY)} fill={`url(#${uid}body)`} />
      <path d="M70 60 Q140 110 176 200" fill="none" stroke={pal.rim} strokeWidth={3} opacity={0.8 * L} strokeLinecap="round" />
      {/* neck and collar */}
      <path d={shape(PROFILE_NECK)} fill={mix(sil, NIGHT.ink, 0.35)} />
      <path d={shape(PROFILE_NECK)} fill={`url(#${uid}neck)`} />
      <path d="M30 -20 Q40 20 50 66" fill="none" stroke={GREEN} strokeWidth={2.6} opacity={0.4 * L} />
      <path d="M22 40 L72 56 L48 98 Z" fill={mix(NIGHT.ink, pal.blouse, 0.7)} />
      <path d="M72 56 L48 98" stroke={pal.rim} strokeWidth={2} opacity={0.6 * L} />
      {/* hair mass, face, fringe */}
      <path d={shape(PROFILE_HAIR)} fill={`url(#${uid}hair)`} />
      <path d="M-150 -284 Q-96 -324 -30 -324 Q50 -316 102 -278 Q116 -258 121 -234" fill="none" stroke={pal.hairHi} strokeWidth={3} opacity={0.55 * L} strokeLinecap="round" />
      {PROFILE_STRANDS.map((s, i) => (
        <path key={i} d={shape(s, false)} fill="none" stroke={mix(hair, NIGHT.ink, 0.55)} strokeWidth={2.4} opacity={0.7} strokeLinecap="round" />
      ))}
      <path d={shape(PROFILE_FACE)} fill={sil} />
      <path d={shape(PROFILE_FACE)} fill={`url(#${uid}rim)`} />
      <path d={shape(PROFILE_FACE)} fill={`url(#${uid}und)`} />
      <path d="M8 -190 L0 -130 L-4 -80 L6 -44" fill="none" stroke={NIGHT.ink} strokeWidth={6} opacity={0.4} strokeLinecap="round" />
      {/* profile eye under the brow; the lens edge-on in front of it */}
      <path d="M77 -159 Q87 -166 97 -160 Q89 -152 77 -159 Z" fill={mix(NIGHT.ink, NIGHT.tealSoft, 0.32)} />
      <g clipPath={`url(#${uid}eye)`}>
        <circle cx={92} cy={-159} r={4.2} fill={NIGHT.ink} />
        <rect x={70} y={-172} width={30} height={10 + lid * 12} fill={sil} />
      </g>
      <path d="M76 -160 Q87 -168 98 -160" fill="none" stroke={NIGHT.ink} strokeWidth={2.6} strokeLinecap="round" />
      <path d={`M62 ${-180 - rb} Q84 ${-192 - rb} 103 ${-183 - rb * 0.8}`} fill="none" stroke={pal.brow} strokeWidth={5.5} strokeLinecap="round" />
      <path d={`M68 ${-184 - rb} Q86 ${-194 - rb} 102 ${-186 - rb * 0.8}`} fill="none" stroke={pal.rim} strokeWidth={1.4} opacity={0.5 * L} strokeLinecap="round" />
      <path d="M99 -175 L14 -158" stroke={pal.frame} strokeWidth={4} strokeLinecap="round" />
      <path d="M99 -177 Q109 -158 102 -139" fill="none" stroke={pal.frame} strokeWidth={6} strokeLinecap="round" />
      <path d="M101 -175 Q110 -158 104 -141" fill="none" stroke={pal.rimHot} strokeWidth={1.6} opacity={0.85 * L} />
      {mouthOpen > 0.01 ? <path d={`M92 -70 Q100 ${-70 + mouthOpen * 6} 106 -69 Q100 -71 92 -70 Z`} fill={NIGHT.ink} /> : null}
      <path d="M90 -70 Q98 -69 105 -70" fill="none" stroke={NIGHT.ink} strokeWidth={2.4} strokeLinecap="round" />
      {/* the profile rim */}
      <path d={shape(FACE_FRONT, false)} fill="none" stroke={pal.rim} strokeWidth={8} opacity={0.15 * L} />
      <path d={shape(FACE_FRONT, false)} fill="none" stroke={pal.rim} strokeWidth={3.2} opacity={0.95 * L} strokeLinejoin="round" />
      <path d="M100 -32 Q90 -18 60 -15 Q38 -16 28 -22" fill="none" stroke={GREEN} strokeWidth={3} opacity={0.6 * L} strokeLinecap="round" />
      <path d={shape(PROFILE_FRINGE)} fill={`url(#${uid}hair)`} />
      <path d="M-20 -306 Q52 -318 102 -278 Q116 -258 121 -234" fill="none" stroke={pal.hairHi} strokeWidth={3.2} opacity={0.75 * L} strokeLinecap="round" />
      <path d="M-8 -80 Q-4 -56 -2 -48 Q-8 -38 -18 -36" fill="none" stroke={GREEN} strokeWidth={2.4} opacity={0.5 * L} />
      {/* forearm up to the phone */}
      <path d={capsule(elbow, wrist, 66, 50)} fill={mix(knit, pal.knitHi, 0.12)} />
      <path d={litEdge(elbow, wrist, 66, 50)} stroke={pal.rim} strokeWidth={2.4} opacity={0.6 * L} strokeLinecap="round" />
      <g transform={place(wrist, angle(sub(wrist, elbow)))}>
        <rect x={-26} y={-27} width={26} height={54} rx={8} fill={mix(knit, pal.knitHi, 0.4)} />
      </g>
      {/* the phone (back to us) and the hand wrapped round it */}
      <g transform={place(phoneAt, phoneDeg)}>
        <rect x={-22} y={-56} width={44} height={112} rx={10} fill={pal.phone} />
        <path d="M22 -46 L22 46" stroke={pal.rim} strokeWidth={2.6} opacity={0.9 * L} strokeLinecap="round" />
        <path d="M-12 -50 L12 -50" stroke={pal.rim} strokeWidth={1.6} opacity={0.4 * L} strokeLinecap="round" />
        {/* back of the hand and four fingers across the phone, tips curling round its far edge */}
        <path d={shape([[-30, -26], [-6, -32], [20, -30], [30, -22], [32, 30], [20, 40], [-10, 52], [-40, 86], [-58, 70], [-40, 30]])} fill={sil} />
        {[-24, -10, 4, 18].map((y, i) => (
          <g key={i}>
            <path d={`M-30 ${y} L22 ${y - 2} Q32 ${y - 1} 32 ${y + 6} Q32 ${y + 12} 22 ${y + 12} L-30 ${y + 12}`} fill={sil} stroke={NIGHT.ink} strokeWidth={1.6} />
            <path d={`M-28 ${y + 1} L20 ${y - 1}`} stroke={pal.rim} strokeWidth={1.4} opacity={(0.25 + 0.6 * g) * L} strokeLinecap="round" />
            {g > 0 ? <circle cx={-26} cy={y + 5} r={3} fill={pal.rimHot} opacity={0.8 * g * L} /> : null}
          </g>
        ))}
        <path d={`M-30 -26 Q-40 0 -40 30 Q-46 56 -58 70`} fill="none" stroke={pal.rim} strokeWidth={2.2} opacity={0.35 * L} strokeLinecap="round" />
        <path d="M-10 52 Q12 46 30 30" fill="none" stroke={GREEN} strokeWidth={2.4} opacity={0.55 * L} strokeLinecap="round" />
        {/* thumb along the near edge */}
        <path d={shape([[-36, 40], [-18, 36], [4, 40], [10, 48], [-6, 54], [-32, 58]])} fill={mix(sil, pal.rim, 0.06)} stroke={NIGHT.ink} strokeWidth={1.4} />
      </g>
    </g>
  );
};

/** Rig B as a full-frame layer. Default placement is S07's bottom half: head y ≈ 1320–1520, shoulder line at 1540. */
export const RitaB: React.FC<RitaBProps & {style?: React.CSSProperties}> = ({x = 470, y = 1528, scale = 0.68, style, ...rest}) => (
  <AbsoluteFill style={{pointerEvents: 'none', ...style}}>
    <svg width={1080} height={1920} viewBox="0 0 1080 1920" style={{position: 'absolute', inset: 0}}>
      <g transform={`translate(${x} ${y}) scale(${scale})`}>
        <RitaBArt {...rest} />
      </g>
    </svg>
  </AbsoluteFill>
);

// ─── S09: her reading glasses, extreme close-up ─────────────────────────────

export type LensInfo = {index: 0 | 1; cx: number; cy: number; rx: number; ry: number};

/** The two lenses in frame px (left = near lens, right = far lens, foreshortened). */
export const GLASSES_CU = {
  lenses: [
    {index: 0, cx: 336, cy: 884, rx: 226, ry: 168},
    {index: 1, cx: 772, cy: 872, rx: 146, ry: 162},
  ] as LensInfo[],
  bridge: {x: 580, y: 838},
} as const;

const lensPath = (l: LensInfo) => {
  // a soft rounded rectangle with a slight cat-eye lift at the outer top corner
  const {cx, cy, rx, ry} = l;
  const lift = l.index === 0 ? -1 : 1;
  const pts: C[] = [
    [cx - rx * 0.92, cy - ry * 0.72 + (lift < 0 ? -10 : 0)],
    [cx - rx * 0.2, cy - ry * 1.0],
    [cx + rx * 0.7, cy - ry * 0.92 + (lift > 0 ? -12 : 0)],
    [cx + rx * 1.0, cy - ry * 0.25],
    [cx + rx * 0.86, cy + ry * 0.62],
    [cx + rx * 0.2, cy + ry * 0.98],
    [cx - rx * 0.62, cy + ry * 0.88],
    [cx - rx * 1.0, cy + ry * 0.1],
  ];
  return shape(pts);
};

// The S09 fringe: a row of locks sweeping right, tips pointing down-right.
const FRINGE_TIPS: Array<[number, number]> = [[90, 640], [250, 600], [400, 572], [560, 566], [700, 548], [860, 548], [1000, 500]];
const FRINGE_CU = (() => {
  // right to left: notch, pointed tip, notch, ...
  const pts: C[] = [[1080, -40], [1080, 400]];
  [...FRINGE_TIPS].reverse().forEach(([x, y], i) => {
    pts.push([x + 34, y - 64]);
    pts.push([x, y, 1]);
    if (i === FRINGE_TIPS.length - 1) pts.push([x - 50, y - 40]);
  });
  pts.push([0, 540], [0, -40, 1]);
  return shape(pts);
})();
const FRINGE_LOCKS = FRINGE_TIPS.map(([x, y], i) => `M${x - 160 + (i % 2) * 30} 20 Q${x - 60} ${y * 0.5} ${x - 6} ${y - 18}`);

export type RitaGlassesProps = {
  /** What the lenses reflect (frame-px SVG content, or a function per lens). Drawn at `reflectionOpacity` with a slight barrel bulge. */
  reflection?: React.ReactNode | ((lens: LensInfo) => React.ReactNode);
  reflectionOpacity?: number;
  /** Reflection drift in px (S09: 12 px L→R over the shot). */
  drift?: number;
  /** 0..1 the glint sweeping across the near (left) lens; 0 and 1 = none. */
  glint?: number;
  /** 0..1 a highlight travelling down the beaded chain. */
  chainGlint?: number;
  /** -1..1 where her eyes (dark, behind the lenses) look. */
  lookX?: number;
  blink?: number;
};

/** The S09 extreme close-up as a full-frame layer (frame area x 90–940, y 640–1120). No facial animation needed. */
export const RitaGlasses: React.FC<RitaGlassesProps & {style?: React.CSSProperties}> = ({reflection, reflectionOpacity = 0.6, drift = 0, glint = 0, chainGlint = 0.5, lookX = 0, blink = 0, style}) => {
  const uid = useUid('rg');
  const pal = palette(0);
  const skin = mix(NIGHT.ink, pal.face, 0.85);
  const L = GLASSES_CU.lenses;
  const frame = mix(NIGHT.ink, NIGHT.redDeep, 0.75);
  const frameHi = mix(NIGHT.redDeep, NIGHT.redSoft, 0.35);
  const gOn = glint > 0.001 && glint < 0.999;
  const gx = lerp(L[0].cx - L[0].rx * 1.3, L[0].cx + L[0].rx * 1.3, glint);
  const beads = Array.from({length: 48}, (_, i) => {
    const u = i / 47;
    const p = arc([118, 870], [190, 1960], -70, u);
    return {p, i, u};
  });
  const eye = (cx: number, cy: number, w: number, h: number, key: string) => {
    const lid = clamp01(blink);
    return (
      <g key={key}>
        <path d={`M${cx - w / 2} ${cy} Q${cx} ${cy - h} ${cx + w / 2} ${cy - h * 0.1} Q${cx} ${cy + h * 0.7} ${cx - w / 2} ${cy} Z`} fill={mix(NIGHT.ink, NIGHT.tealDeep, 0.6)} />
        <circle cx={cx + lookX * w * 0.18} cy={cy - h * 0.1} r={h * 0.55} fill={NIGHT.ink} />
        <path d={`M${cx - w / 2 - 6} ${cy} Q${cx} ${cy - h - 4 + lid * h * 1.6} ${cx + w / 2 + 6} ${cy - h * 0.1} L${cx + w / 2 + 6} ${cy - h * 2.2} L${cx - w / 2 - 6} ${cy - h * 2.2} Z`} fill={skin} />
        <path d={`M${cx - w / 2} ${cy} Q${cx} ${cy - h - 2 + lid * h * 1.6} ${cx + w / 2} ${cy - h * 0.1}`} fill="none" stroke={NIGHT.ink} strokeWidth={6} strokeLinecap="round" />
      </g>
    );
  };
  return (
    <AbsoluteFill style={{pointerEvents: 'none', ...style}}>
      <svg width={1080} height={1920} viewBox="0 0 1080 1920" style={{position: 'absolute', inset: 0}}>
        <defs>
          {L.map((l) => (
            <clipPath key={l.index} id={`${uid}l${l.index}`}>
              <path d={lensPath(l)} />
            </clipPath>
          ))}
          {L.map((l) => (
            <radialGradient key={l.index} id={`${uid}v${l.index}`} cx={l.cx} cy={l.cy} r={Math.max(l.rx, l.ry) * 1.05} gradientUnits="userSpaceOnUse">
              <stop offset="0.55" stopColor={NIGHT.ink} stopOpacity={0} />
              <stop offset="1" stopColor={NIGHT.ink} stopOpacity={0.7} />
            </radialGradient>
          ))}
          <linearGradient id={`${uid}face`} x1="0" y1="400" x2="0" y2="1700" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor={mix(skin, NIGHT.ink, 0.5)} />
            <stop offset="0.45" stopColor={skin} />
            <stop offset="0.8" stopColor={mix(skin, GREEN, 0.1)} />
            <stop offset="1" stopColor={mix(skin, NIGHT.ink, 0.4)} />
          </linearGradient>
          <radialGradient id={`${uid}cheek`}>
            <stop offset="0" stopColor={pal.rim} stopOpacity={0.07} />
            <stop offset="1" stopColor={pal.rim} stopOpacity={0} />
          </radialGradient>
          <linearGradient id={`${uid}fringe`} x1="0" y1="0" x2="0" y2="640" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor={mix(NIGHT.ink, pal.hair, 0.45)} />
            <stop offset="0.8" stopColor={mix(NIGHT.ink, pal.hair, 0.85)} />
            <stop offset="1" stopColor={mix(pal.hair, pal.rim, 0.25)} />
          </linearGradient>
          <linearGradient id={`${uid}lit`} x1="0" y1="0" x2="1080" y2="0" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor={NIGHT.ink} stopOpacity={0.45} />
            <stop offset="0.5" stopColor={NIGHT.ink} stopOpacity={0} />
            <stop offset="1" stopColor={pal.rim} stopOpacity={0.12} />
          </linearGradient>
          <linearGradient id={`${uid}glint`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor={NIGHT.phoneGlowTeal} stopOpacity={0} />
            <stop offset="0.5" stopColor={NIGHT.phoneGlowTeal} stopOpacity={0.85} />
            <stop offset="1" stopColor={NIGHT.phoneGlowTeal} stopOpacity={0} />
          </linearGradient>
        </defs>
        {/* her face fills the frame, in shadow: forehead under the fringe, the bridge of the nose, cheeks */}
        <rect x={0} y={0} width={1080} height={1920} fill={`url(#${uid}face)`} />
        <path d="M0 0 H1080 V1920 H0 Z" fill={`url(#${uid}lit)`} />
        {/* nose: ridge from the bridge down toward the tip, its lit side plane toward the windshield */}
        <path d="M560 760 Q610 900 690 1120 Q740 1260 860 1330 Q930 1360 990 1330 L1080 1300 L1080 1920 L520 1920 Q600 1500 600 1300 Q590 1000 560 760 Z" fill={mix(skin, NIGHT.ink, 0.18)} />
        <path d="M600 770 Q660 930 730 1110 Q790 1250 900 1320" fill="none" stroke={pal.rim} strokeWidth={6} opacity={0.5} strokeLinecap="round" />
        <path d="M612 800 Q676 950 744 1110" fill="none" stroke={pal.rim} strokeWidth={26} opacity={0.06} strokeLinecap="round" />
        {/* cheekbone under the near lens, the far cheek beyond the nose */}
        <ellipse cx={330} cy={1240} rx={260} ry={120} fill={`url(#${uid}cheek)`} />
        {/* brows: tapered, the tails thinning outward */}
        <path d="M118 716 Q250 646 466 664 Q478 670 470 678 Q268 668 126 726 Q110 726 118 716 Z" fill={mix(pal.brow, NIGHT.ink, 0.35)} />
        <path d="M160 690 Q280 652 450 664" fill="none" stroke={pal.rim} strokeWidth={2.4} opacity={0.3} strokeLinecap="round" />
        <path d="M690 670 Q800 646 902 680 Q906 688 898 690 Q798 664 694 682 Q682 676 690 670 Z" fill={mix(pal.brow, NIGHT.ink, 0.35)} />
        {/* the fringe across the top of the frame: locks with pointed tips catching the teal */}
        <path d={FRINGE_CU} fill={`url(#${uid}fringe)`} />
        <path d={FRINGE_CU} fill="none" stroke={pal.hairHi} strokeWidth={3} opacity={0.45} strokeLinejoin="round" />
        {FRINGE_LOCKS.map((d, i) => (
          <path key={i} d={d} fill="none" stroke={mix(NIGHT.ink, pal.hair, 0.4)} strokeWidth={5} opacity={0.7} strokeLinecap="round" />
        ))}
        {/* the near curtain of the bob down the left edge */}
        <path d="M0 560 Q70 640 84 900 Q96 1200 60 1500 Q40 1700 0 1760 Z" fill={mix(NIGHT.ink, pal.hair, 0.6)} />
        <path d="M30 620 Q86 760 84 900 Q92 1200 60 1500" fill="none" stroke={pal.hairHi} strokeWidth={3} opacity={0.25} strokeLinecap="round" />
        {/* eyes, dark behind the glass */}
        {eye(L[0].cx + 6, L[0].cy + 14, 190, 46, 'n')}
        {eye(L[1].cx + 8, L[1].cy + 12, 112, 38, 'f')}
        {/* the lenses: the empty teal lobby reflected, bulging slightly */}
        {L.map((l) => (
          <g key={l.index} clipPath={`url(#${uid}l${l.index})`}>
            <rect x={l.cx - l.rx * 1.2} y={l.cy - l.ry * 1.2} width={l.rx * 2.4} height={l.ry * 2.4} fill={NIGHT.tealSoft} opacity={0.06} />
            {reflection ? (
              <g opacity={reflectionOpacity} transform={`translate(${l.cx + drift} ${l.cy}) scale(1.08 1.06) translate(${-l.cx} ${-l.cy})`}>
                {typeof reflection === 'function' ? reflection(l) : reflection}
              </g>
            ) : null}
            <rect x={l.cx - l.rx * 1.2} y={l.cy - l.ry * 1.2} width={l.rx * 2.4} height={l.ry * 2.4} fill={`url(#${uid}v${l.index})`} />
            {/* a curved sheen along the top of the glass */}
            <path d={`M${l.cx - l.rx * 0.8} ${l.cy - l.ry * 0.55} Q${l.cx} ${l.cy - l.ry * 0.95} ${l.cx + l.rx * 0.75} ${l.cy - l.ry * 0.6}`} fill="none" stroke={NIGHT.ivory} strokeWidth={10} opacity={0.08} strokeLinecap="round" />
            {l.index === 0 && gOn ? (
              <g opacity={Math.sin(glint * Math.PI)}>
                <path d={`M${gx - 60} ${l.cy - l.ry * 1.2} L${gx + 10} ${l.cy - l.ry * 1.2} L${gx - 80} ${l.cy + l.ry * 1.2} L${gx - 150} ${l.cy + l.ry * 1.2} Z`} fill={NIGHT.phoneGlowTeal} opacity={0.45} />
                <path d={`M${gx + 30} ${l.cy - l.ry * 1.2} L${gx + 44} ${l.cy - l.ry * 1.2} L${gx - 46} ${l.cy + l.ry * 1.2} L${gx - 60} ${l.cy + l.ry * 1.2} Z`} fill={NIGHT.phoneGlowTeal} opacity={0.6} />
              </g>
            ) : null}
          </g>
        ))}
        {/* frames: front face, inner bevel, top rim light */}
        {L.map((l) => (
          <g key={l.index}>
            <path d={lensPath(l)} fill="none" stroke={frame} strokeWidth={l.index === 0 ? 30 : 24} strokeLinejoin="round" />
            <path d={lensPath(l)} fill="none" stroke={frameHi} strokeWidth={3} opacity={0.5} transform={`translate(${l.cx} ${l.cy}) scale(0.955) translate(${-l.cx} ${-l.cy})`} />
            <path d={`M${l.cx - l.rx * 0.85} ${l.cy - l.ry * 0.9} Q${l.cx} ${l.cy - l.ry * 1.16} ${l.cx + l.rx * 0.75} ${l.cy - l.ry * 1.02}`} fill="none" stroke={pal.rim} strokeWidth={4} opacity={0.75} strokeLinecap="round" />
            <path d={`M${l.cx - l.rx * 0.5} ${l.cy + l.ry * 1.06} Q${l.cx} ${l.cy + l.ry * 1.12} ${l.cx + l.rx * 0.6} ${l.cy + l.ry * 0.98}`} fill="none" stroke={GREEN} strokeWidth={3} opacity={0.35} strokeLinecap="round" />
          </g>
        ))}
        {/* bridge, hinge and temple */}
        <path d={`M${L[0].cx + L[0].rx * 0.95} ${L[0].cy - 60} Q${GLASSES_CU.bridge.x} ${GLASSES_CU.bridge.y - 50} ${L[1].cx - L[1].rx * 0.98} ${L[1].cy - 70}`} fill="none" stroke={frame} strokeWidth={20} strokeLinecap="round" />
        <path d={`M${L[0].cx + L[0].rx * 0.95} ${L[0].cy - 68} Q${GLASSES_CU.bridge.x} ${GLASSES_CU.bridge.y - 60} ${L[1].cx - L[1].rx * 0.98} ${L[1].cy - 78}`} fill="none" stroke={pal.rim} strokeWidth={3} opacity={0.6} strokeLinecap="round" />
        <path d={`M${L[0].cx - L[0].rx * 0.98} ${L[0].cy - 40} L40 ${L[0].cy - 10}`} stroke={frame} strokeWidth={22} strokeLinecap="round" />
        <circle cx={L[0].cx - L[0].rx * 0.98} cy={L[0].cy - 40} r={10} fill={pal.brass} />
        <circle cx={L[0].cx - L[0].rx * 0.98 + 3} cy={L[0].cy - 43} r={3.5} fill={NIGHT.brassLight} />
        {/* the beaded chain, a highlight running down it */}
        {beads.map(({p, i, u}) => {
          const hot = Math.max(0, 1 - Math.abs(u - chainGlint) * 6);
          return (
            <g key={i}>
              <circle cx={p[0]} cy={p[1]} r={7} fill={mix(NIGHT.ink, NIGHT.brass, 0.7)} />
              <circle cx={p[0] + 2} cy={p[1] - 2} r={2.6 + hot * 2} fill={mix(NIGHT.brassLight, NIGHT.ivory, hot)} opacity={0.5 + hot * 0.5} />
            </g>
          );
        })}
      </svg>
    </AbsoluteFill>
  );
};
