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
//   RitaPhoneArt  her phone (back to camera), for the S16 toss arc.
//
// The camera sits in the passenger seat, so we see her right side: the "near"
// arm is her right arm (phone, cup), the "far" arm her left (pen, binoculars).
// At night her face is mostly silhouette: a teal rim through the windshield,
// green under-light from the dash, the acting carried by brows, a 4–6 px mouth
// corner, lids and the glint on her glasses. `dawn` (0..1) relights her for S21.
// Every moving part is a number so scenes can interpolate() it.
import React from 'react';
import {AbsoluteFill} from 'remotion';
import {DARK, LIGHT, NIGHT} from '../theme.ts';
import {alpha, mix, useUid} from '../set/parts.tsx';
import type {Crop} from '../set/Lobby.tsx';
import {CAR, PAD_BOX, Steam, type PadPlacement} from '../set/CarInterior.tsx';
import {add, angle, arc, breath, clamp01, ik, lerp, lerpP, mapC, norm, perp, place, rot, scaleP, shape, smoothstep, sub, tube, type C, type P} from './rig.ts';

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

// ─── Small geometry helpers ─────────────────────────────────────────────────

const f1 = (p: P) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`;

/** A tapered capsule from a (width wa) to b (width wb), round both ends. */
const capsule = (a: P, b: P, wa: number, wb: number) => {
  const n = perp(norm(sub(b, a)));
  const ra = wa / 2;
  const rb = wb / 2;
  return `M${f1(add(a, scaleP(n, ra)))} L${f1(add(b, scaleP(n, rb)))} A${rb} ${rb} 0 0 0 ${f1(add(b, scaleP(n, -rb)))} L${f1(add(a, scaleP(n, -ra)))} A${ra} ${ra} 0 0 0 ${f1(add(a, scaleP(n, ra)))} Z`;
};

/** The side normal of a→b that faces the windshield light (right and up). */
const litNormal = (a: P, b: P): P => {
  const n = perp(norm(sub(b, a)));
  return n[0] - n[1] < 0 ? [-n[0], -n[1]] : n;
};

/** The edge of a capsule that faces the light, inset a little. */
const litEdge = (a: P, b: P, wa: number, wb: number, inset = 0.42) => {
  const n = litNormal(a, b);
  return `M${f1(add(a, scaleP(n, wa * inset)))} L${f1(add(b, scaleP(n, wb * inset)))}`;
};

/** A tapered lock of hair along a polyline (filled). */
const lock = (pts: readonly P[], w: number) => shape(tube(pts, pts.map((_, i) => (i === 0 || i === pts.length - 1 ? 0.6 : w * (1 - (i / pts.length) * 0.25))), false));

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
  [-40, -32, 1],
  [-60, -46],
  [-82, -30, 1],
  [-100, -46],
  [-122, -38, 1],
  [-136, -64],
  [-154, -104],
  [-163, -160],
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
  [-1, -50], // bob tip curling in at the jaw
  [-10, -33, 1],
  [-26, -46],
  [-46, -29, 1],
  [-64, -44],
  [-84, -31, 1],
  [-100, -50],
  [-117, -96],
  [-121, -150],
  [-112, -220],
  [-82, -286],
];
/** Darker clumps and lighter strands in the hair (tapered fills). */
const HAIR_LOCKS: Array<{pts: P[]; w: number; hi?: boolean}> = [
  {pts: [[-24, -302], [36, -292], [86, -264], [112, -238]], w: 6},
  {pts: [[-40, -288], [8, -268], [50, -250], [80, -243]], w: 5},
  {pts: [[-64, -292], [-84, -228], [-90, -150], [-80, -40]], w: 6},
  {pts: [[-40, -282], [-50, -200], [-42, -120], [-34, -36]], w: 5},
  {pts: [[-98, -270], [-122, -200], [-122, -120], [-102, -54]], w: 5},
  {pts: [[-14, -296], [-24, -230], [-24, -140], [-14, -60]], w: 3, hi: true},
  {pts: [[-82, -298], [-104, -226], [-108, -140], [-92, -56]], w: 3, hi: true},
  {pts: [[0, -300], [56, -290], [96, -262]], w: 3, hi: true},
];

// Eyes and glasses (head-local).
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
  [-236, 246],
  [-250, 1400, 1],
  [262, 1400, 1],
  [256, 246],
  [232, 146],
  [176, 88],
  [110, 60],
  [56, 42],
];
const SHOULDER_N: P = [-166, 150];
const SHOULDER_F: P = [176, 150];
const ARM_N = {upper: 180, fore: 200};
const ARM_F = {upper: 190, fore: 172};

/** Her phone (back to camera): local centre, long axis vertical, the side toward her face is +x. */
const PHONE = {w: 70, h: 146, r: 13};
/** Phone at her ear (head-local centre and tilt). */
const PH_EAR: P = [-16, -114];
const PH_EAR_DEG = -20;
/** Phone low in her near hand (body-local), on its way up or down. */
const PH_LOW: P = [70, 236];
const PH_LOW_DEG = 64;
/** Wrist in phone-local coords (the hand holds the lower half of the phone). */
const PH_WRIST: P = [-4, 102];

// Near-hand targets (body-local wrist positions).
const NEAR_REST: P = [60, 268]; // on the wheel's left rim
const NEAR_CUP: P = [44, -34]; // head-local: the thermos cup at her lips
const NEAR_LAP: P = [18, 404];
// Far-hand targets.
const FAR_REST: P = [236, 250]; // on the wheel's top rim
const FAR_CHEST: P = [128, 214];
const FAR_LAP: P = [156, 384];

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
  /** Draw the phone in her near hand (default true). Set false the frame she lets go of it (S16 toss) and draw RitaPhoneArt in the scene. */
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
  const headDeg = q.headTilt - 16 * sleep + 6 * ln;
  const headOff: P = [-30 * sleep + 30 * ln, -b * 0.7 - 4 * sleep + 18 * ln];
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

  // the phone (near hand): from low in her hand up to her ear
  const phone = smoothstep(q.phoneToEar);
  const phoneC = arc(PH_LOW, H(PH_EAR), 60, phone);
  const phoneDeg = lerp(PH_LOW_DEG, headDeg + PH_EAR_DEG, phone);
  const phoneWrist = add(phoneC, rot(PH_WRIST, phoneDeg));

  // near hand
  let near: P = lerpP(NEAR_REST, NEAR_LAP, sleep);
  near = lerpP(near, phoneWrist, clamp01(q.phoneToEar * 4));
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
  const [elbowF, wristF] = ik(sF, far, ARM_F.upper, ARM_F.fore, 1);

  return {sleep, bodyY, headDeg, headOff, H, binoPos, binoDeg, up, phone, phoneC, phoneDeg, sN, elbowN, wristN, sF, elbowF, wristF, penW, penLocal, nearBino, binoGrip};
};
type Solved = ReturnType<typeof solve>;

// ─── Hands and props ────────────────────────────────────────────────────────

/**
 * A hand in hand-local coords: wrist at 0,0, fingers toward +x, thumb on the
 * −y side (flip mirrors it). 'grip' = a fist round a bar (binoculars, pen,
 * cup, wheel); 'open' = relaxed, palm down (asleep in her lap).
 */
const Hand: React.FC<{pal: Pal; kind?: 'grip' | 'open'; at: P; deg: number; flip?: boolean; scale?: number; grip?: number; uid: string}> = ({pal, kind = 'grip', at, deg, flip = false, scale = 1, grip = 0, uid}) => {
  const fill = `url(#${uid}hand)`;
  const line = pal.faceLine;
  if (kind === 'open') {
    const back: C[] = [[0, -16], [22, -19], [44, -20], [54, -14], [57, 0], [54, 14], [40, 19], [18, 19], [0, 15]];
    const fingers: Array<[P, P, number]> = [
      [[50, -13], [80, -6], 11],
      [[53, -4], [88, 4], 12],
      [[52, 5], [85, 13], 11],
      [[48, 13], [74, 20], 10],
    ];
    return (
      <g transform={`${place(at, deg, scale)} ${flip ? 'scale(1 -1)' : ''}`}>
        {fingers.map(([a, b, w], i) => (
          <path key={i} d={capsule(a, b, w, w * 0.85)} fill={mix(pal.face, pal.faceDeep, 0.2 + i * 0.1)} stroke={line} strokeWidth={1.2} />
        ))}
        <path d={shape(back)} fill={pal.face} />
        <path d={shape(back)} fill={fill} />
        <path d="M10 -15 Q26 -25 42 -29 Q52 -28 48 -22 Q36 -17 24 -12 Z" fill={pal.face} stroke={line} strokeWidth={1.2} />
        <path d="M4 -16 Q28 -22 50 -16" fill="none" stroke={pal.rim} strokeWidth={2} opacity={pal.rimAmt * 0.6} strokeLinecap="round" />
      </g>
    );
  }
  const back: C[] = [[0, -17], [20, -21], [42, -23], [54, -21], [63, -14], [68, -3], [68, 9], [63, 19], [48, 23], [24, 21], [0, 16]];
  const thumb: C[] = [[12, -17], [26, -27], [44, -32], [57, -31], [62, -26], [54, -21], [36, -18]];
  return (
    <g transform={`${place(at, deg, scale)} ${flip ? 'scale(1 -1)' : ''}`}>
      <path d={shape(back)} fill={pal.face} />
      <path d={shape(back)} fill={fill} />
      {/* the knuckle row and the curled fingers beyond it */}
      <path d="M46 -21 Q51 -15 47 -9 Q52 -3 47 3 Q52 9 47 15 Q51 19 46 22" fill="none" stroke={line} strokeWidth={1.6} opacity={0.75} strokeLinecap="round" />
      <path d="M49 -9 Q60 -9 67 -6 M49 3 Q60 3 68 4 M48 15 Q57 16 64 17" fill="none" stroke={line} strokeWidth={1.4} opacity={0.6} strokeLinecap="round" />
      <path d={shape(thumb)} fill={pal.face} />
      <path d={shape(thumb)} fill={pal.faceDeep} opacity={0.25} />
      <path d="M14 -18 Q34 -30 58 -30" fill="none" stroke={pal.rim} strokeWidth={2.2} opacity={pal.rimAmt * 0.8} strokeLinecap="round" />
      <path d="M8 16 Q34 23 60 19" fill="none" stroke={pal.under} strokeWidth={2} opacity={pal.underAmt * 1.2} strokeLinecap="round" />
      {grip > 0 ? <path d="M44 -21 Q50 -15 47 -9 M47 -3 Q51 3 47 9" fill="none" stroke={pal.rimHot} strokeWidth={2.4} opacity={grip} strokeLinecap="round" /> : null}
    </g>
  );
};

/** Her phone, back to camera, centred on 0,0 (long axis vertical, top at −y). No brand. */
const PhoneBody: React.FC<{pal: Pal; L?: number}> = ({pal, L = 1}) => {
  const {w, h, r} = PHONE;
  return (
    <g>
      <rect x={-w / 2} y={-h / 2} width={w} height={h} rx={r} fill={pal.phone} />
      <rect x={-w / 2 + 3} y={-h / 2 + 3} width={w - 6} height={h - 6} rx={r - 3} fill="none" stroke={mix(pal.phone, NIGHT.ink, 0.6)} strokeWidth={2} />
      {/* camera bump */}
      <rect x={-w / 2 + 8} y={-h / 2 + 9} width={22} height={34} rx={8} fill={mix(pal.phone, NIGHT.ink, 0.5)} />
      <circle cx={-w / 2 + 19} cy={-h / 2 + 19} r={5} fill={NIGHT.ink} stroke={alpha(pal.rim, 0.45 * L)} strokeWidth={1.2} />
      <circle cx={-w / 2 + 19} cy={-h / 2 + 33} r={3.5} fill={NIGHT.ink} />
      {/* the window light on the edge toward her face and along the top */}
      <path d={`M${w / 2} ${-h / 2 + r} L${w / 2} ${h / 2 - r}`} stroke={pal.rim} strokeWidth={2.6} opacity={pal.rimAmt * 0.85 * L} strokeLinecap="round" />
      <path d={`M${-w / 2 + r} ${-h / 2} L${w / 2 - r} ${-h / 2} Q${w / 2} ${-h / 2} ${w / 2} ${-h / 2 + r}`} fill="none" stroke={pal.rim} strokeWidth={1.8} opacity={pal.rimAmt * 0.5 * L} strokeLinecap="round" />
    </g>
  );
};

/** Her phone on its own (back to camera, centred, top up), e.g. for the S16 toss onto the seat. */
export const RitaPhoneArt: React.FC<{dawn?: number}> = ({dawn = 0}) => <PhoneBody pal={palette(dawn)} />;

/**
 * Her near (right) hand holding the phone to her ear, in phone-local coords
 * (wrist at PH_WRIST). Seen from outside: the back of the hand covers the lower
 * half of the phone, the knuckles along the edge toward her face with the
 * fingers curling round it onto her cheek, the thumb up the back edge.
 */
const PhoneInHand: React.FC<{pal: Pal; grip?: number; uid: string; L?: number}> = ({pal, grip = 0, uid, L = 1}) => {
  const line = pal.faceLine;
  const back: C[] = [[-6, 104], [-30, 84], [-36, 44], [-30, 6], [-14, -10], [8, -14], [28, -10], [38, 14], [40, 44], [34, 74], [18, 96]];
  const fingers: Array<[P, number]> = [
    [[30, -4], 17],
    [[34, 16], 18],
    [[36, 37], 17],
    [[33, 57], 15],
  ];
  const g = `${uid}ph`;
  return (
    <g>
      <defs>
        <linearGradient id={g} x1="40" y1="0" x2="-36" y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={pal.rim} stopOpacity={0.2 * L} />
          <stop offset="0.35" stopColor={pal.rim} stopOpacity={0} />
          <stop offset="1" stopColor={NIGHT.ink} stopOpacity={0.35} />
        </linearGradient>
        <linearGradient id={`${g}u`} x1="0" y1="40" x2="0" y2="104" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={pal.under} stopOpacity={0} />
          <stop offset="1" stopColor={pal.under} stopOpacity={pal.underAmt * 0.32} />
        </linearGradient>
      </defs>
      <PhoneBody pal={pal} L={L} />
      <g transform="translate(0 102) scale(0.9) translate(0 -102)">
      {/* fingers curling round the near edge onto her cheek */}
      {fingers.map(([a, w], i) => (
        <g key={i}>
          <path d={capsule(a, [a[0] + 14, a[1] + 3], w, w * 0.9)} fill={mix(pal.face, pal.faceDeep, 0.25 + i * 0.08)} stroke={line} strokeWidth={1.3} />
          <path d={`M${a[0] + 2} ${a[1] - w * 0.42} Q${a[0] + 14} ${a[1] - w * 0.46} ${a[0] + 20} ${a[1] - w * 0.1}`} fill="none" stroke={pal.rim} strokeWidth={1.6} opacity={(0.45 + 0.4 * grip) * pal.rimAmt * L} strokeLinecap="round" />
        </g>
      ))}
      {/* back of the hand */}
      <path d={shape(back)} fill={pal.face} />
      <path d={shape(back)} fill={`url(#${g})`} />
      <path d={shape(back)} fill={`url(#${g}u)`} />
      {/* the knuckle row along the edge */}
      <path d="M24 -8 Q32 0 30 8 Q38 16 34 26 Q40 36 36 46 Q40 56 34 64" fill="none" stroke={line} strokeWidth={1.6} opacity={0.7} strokeLinecap="round" />
      {grip > 0 ? <path d="M27 -4 Q32 2 31 8 M33 18 Q38 24 35 30 M35 40 Q39 46 36 52" fill="none" stroke={pal.rimHot} strokeWidth={2.4} opacity={grip * 0.85 * L} strokeLinecap="round" /> : null}
      {/* thumb up the back edge */}
      <path d={capsule([-24, 64], [-32, 0], 20, 16)} fill={mix(pal.face, pal.faceDeep, 0.15)} />
      <path d="M-22 60 Q-20 30 -26 2" fill="none" stroke={line} strokeWidth={1.3} opacity={0.6} strokeLinecap="round" />
      {/* the window light along the knuckles and the edge of the hand */}
      <path d="M8 -14 Q30 -12 38 12 Q42 44 34 74" fill="none" stroke={pal.rim} strokeWidth={2.2} opacity={pal.rimAmt * 0.7 * L} strokeLinecap="round" />
      <path d="M-24 92 Q-6 108 16 98" fill="none" stroke={pal.under} strokeWidth={2.2} opacity={pal.underAmt * L} strokeLinecap="round" />
      </g>
    </g>
  );
};

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
export const BinocularsArt: React.FC<{rim?: string; under?: string; rimAmount?: number; underAmount?: number; lens?: string}> = ({rim = NIGHT.tealSoft, under = GREEN, rimAmount = 1, underAmount = 0.4, lens = NIGHT.teal}) => {
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

  // brows: tapered shapes, head (inner, right) to tail (left); asleep they relax down a touch
  const relax = sleep * 2;
  const browN: C[] = [[61, -184 - raiseN * 0.7 + relax], [38, -193 - raiseN * 1.1 + relax], [12, -182 - raiseN * 0.6 + relax], [14, -186 - raiseN * 0.65 + relax], [38, -199 - raiseN * 1.1 + relax], [60, -191 - raiseN * 0.7 + relax]];
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
          <stop offset="0" stopColor={mix(pal.hair, pal.hairHi, 0.12)} />
          <stop offset="0.45" stopColor={pal.hair} />
          <stop offset="0.8" stopColor={mix(pal.hair, pal.hairDeep, 0.6)} />
          <stop offset="1" stopColor={pal.hairDeep} />
        </linearGradient>
        <linearGradient id={`${uid}hairlit`} x1="-40" y1="0" x2="124" y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={pal.rim} stopOpacity={0} />
          <stop offset="0.6" stopColor={pal.rim} stopOpacity={0.05} />
          <stop offset="1" stopColor={pal.rim} stopOpacity={0.4} />
        </linearGradient>
        <radialGradient id={`${uid}sheen`}>
          <stop offset="0" stopColor={pal.hairHi} stopOpacity={0.32} />
          <stop offset="1" stopColor={pal.hairHi} stopOpacity={0} />
        </radialGradient>
        <clipPath id={`${uid}face`}>
          <path d={shape(FACE)} />
        </clipPath>
        <clipPath id={`${uid}hf`}>
          <path d={shape(HAIR_FRONT)} />
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
      <path d={shape(HAIR_BACK)} fill={NIGHT.ink} opacity={0.18} />

      {/* face */}
      <path d={shape(FACE)} fill={pal.face} />
      <g clipPath={`url(#${uid}face)`}>
        <rect x={-80} y={-300} width={220} height={300} fill={`url(#${uid}lit)`} />
        <rect x={-80} y={-300} width={220} height={300} fill={`url(#${uid}und)`} />
        <rect x={-80} y={-300} width={220} height={300} fill={`url(#${uid}shd)`} />
        {/* eye socket and cheekbone planes */}
        <ellipse cx={40} cy={-160} rx={34} ry={20} fill={pal.faceDeep} opacity={0.4} />
        <path d="M40 -128 Q70 -118 96 -126 Q84 -110 58 -110 Q44 -114 40 -128 Z" fill={pal.rim} opacity={0.07 + 0.08 * pal.d} />
        {/* the hair's shadow along the cheek */}
        <path d="M-10 -210 Q6 -160 0 -100 Q4 -70 14 -46 L-30 -40 L-40 -210 Z" fill={NIGHT.ink} opacity={0.3} />
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
      <path d={`M14 ${-186 - raiseN * 0.65 + relax} Q38 ${-199 - raiseN * 1.1 + relax} 60 ${-191 - raiseN * 0.7 + relax}`} fill="none" stroke={pal.rim} strokeWidth={1.6} opacity={0.35 * pal.rimAmt} />

      {/* rim light along the profile */}
      <path d={shape(FACE_FRONT, false)} fill="none" stroke={pal.rim} strokeWidth={9} opacity={0.14 * pal.rimAmt} strokeLinejoin="round" />
      <path d={shape(FACE_FRONT, false)} fill="none" stroke={pal.rim} strokeWidth={3.2} opacity={pal.rimAmt} strokeLinejoin="round" />
      <path d="M100 -98 Q112 -88 120 -95" fill="none" stroke={pal.rimHot} strokeWidth={2} opacity={0.5 * pal.rimAmt} />
      {/* under-light on the jaw and chin */}
      <path d="M100 -32 Q90 -18 56 -15 Q34 -12 22 -8" fill="none" stroke={pal.under} strokeWidth={3} opacity={pal.underAmt} strokeLinecap="round" />

      {/* hair over the face: fringe and the near curtain of the bob */}
      <path d={shape(HAIR_FRONT)} fill={`url(#${uid}hair)`} />
      <g clipPath={`url(#${uid}hf)`}>
        <path d={shape(HAIR_FRONT)} fill={`url(#${uid}hairlit)`} />
        {/* the sheen on the crown */}
        <ellipse cx={-6} cy={-282} rx={120} ry={48} fill={`url(#${uid}sheen)`} />
        {/* clumps and strands */}
        {HAIR_LOCKS.map((l, i) => (
          <path key={i} d={lock(l.pts, l.w)} fill={l.hi ? pal.hairHi : pal.hairDeep} opacity={l.hi ? 0.28 : 0.6} />
        ))}
        {/* occlusion where the curtain meets the cheek, and under the fringe */}
        <path d="M2 -204 Q-8 -166 -12 -120 Q-10 -80 0 -52" fill="none" stroke={NIGHT.ink} strokeWidth={12} opacity={0.32} strokeLinecap="round" />
        <path d="M-118 -100 Q-110 -60 -92 -44 Q-60 -34 -6 -40" fill="none" stroke={NIGHT.ink} strokeWidth={16} opacity={0.3} strokeLinecap="round" />
      </g>
      <path d="M-30 -312 Q40 -318 96 -284 Q116 -262 121 -233" fill="none" stroke={pal.hairHi} strokeWidth={3.4} opacity={0.75 * pal.rimAmt} strokeLinecap="round" />
      <path d="M-120 -284 Q-60 -326 -10 -320" fill="none" stroke={pal.hairHi} strokeWidth={2.2} opacity={0.35 * pal.rimAmt} strokeLinecap="round" />
      <path d="M-11 -80 Q-4 -56 -1 -50 Q-6 -40 -10 -34" fill="none" stroke={pal.under} strokeWidth={2.6} opacity={pal.underAmt * 0.9} strokeLinecap="round" />

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
        {/* browline frames: thin metal rims, a burgundy bar along the top */}
        <path d={shape(LENS_N)} fill="none" stroke={pal.metalHi} strokeWidth={1.6} opacity={0.8} />
        <path d={shape(LENS_F)} fill="none" stroke={pal.metalHi} strokeWidth={1.4} opacity={0.8} />
        <path d="M7 -156 Q7 -173 36 -178 Q60 -177 64 -162" fill="none" stroke={pal.frame} strokeWidth={6} strokeLinecap="round" />
        <path d="M76 -160 Q77 -176 92 -177 Q103 -175 104 -162" fill="none" stroke={pal.frame} strokeWidth={5} strokeLinecap="round" />
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
  const bandR: C[] = V([[62, 30], [74, 34], [60, 120], [48, 236], [44, 1400, 1], [28, 1400, 1], [32, 236], [46, 116]]);
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
        <linearGradient id={`${uid}lap`} x1="0" y1={240 + y} x2="0" y2={520 + y} gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={NIGHT.ink} stopOpacity={0} />
          <stop offset="1" stopColor={NIGHT.ink} stopOpacity={0.94 - 0.3 * pal.d} />
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
      {/* knit folds at the near shoulder and chest, the shoulder seam */}
      <path d={`M-150 ${116 + y} Q-118 ${190 + y} -126 ${290 + y}`} fill="none" stroke={pal.knitDeep} strokeWidth={4} opacity={0.6} strokeLinecap="round" />
      <path d={`M150 ${136 + y} Q172 ${206 + y} 162 ${306 + y}`} fill="none" stroke={pal.knitDeep} strokeWidth={4} opacity={0.5} strokeLinecap="round" />
      <path d={`M-196 ${112 + y} Q-170 ${100 + y} -150 ${92 + y}`} fill="none" stroke={pal.knitDeep} strokeWidth={3} opacity={0.5} strokeLinecap="round" />
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

/** One sleeve segment with cylindrical shading: lit edge (toward the windshield) → knit → shadow edge. */
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

/** A cardigan arm, shoulder → elbow → wrist: shaded segments, folds in the crook of the elbow, a ribbed cuff. */
const Arm: React.FC<{sh: P; el: P; wr: P; pal: Pal; near: boolean; uid: string}> = ({sh, el, wr, pal, near, uid}) => {
  const [w0, w1, w2] = near ? [96, 74, 58] : [86, 66, 52];
  const k = near ? 'n' : 'f';
  const base = near ? mix(pal.knit, pal.knitHi, 0.1) : mix(pal.knit, pal.knitDeep, 0.35);
  const lit = mix(base, pal.knitHi, near ? 0.55 : 0.4);
  const dark = mix(base, NIGHT.ink, 0.55);
  const cuffDir = angle(sub(wr, el));
  // the crook of the elbow: folds on the inside of the bend, scaled by how bent it is
  const u1 = norm(sub(sh, el));
  const u2 = norm(sub(wr, el));
  const bent = clamp01((u1[0] * u2[0] + u1[1] * u2[1] + 0.85) / 1.3);
  const inner = norm(add(u1, u2));
  const fold = (o: number, len: number) => {
    const p0 = add(add(el, scaleP(inner, w1 * 0.46)), scaleP(u2, o));
    const p1 = add(add(el, scaleP(inner, w1 * 0.46 - len)), scaleP(u2, o + 6));
    const c = add(lerpP(p0, p1, 0.5), scaleP(u2, 8));
    return `M${f1(p0)} Q${f1(c)} ${f1(p1)}`;
  };
  return (
    <g>
      {near ? (
        // a soft cast shadow on the cardigan behind
        <g fill={NIGHT.ink} opacity={0.32}>
          <path d={capsule(add(sh, [-6, 12]), add(el, [-6, 12]), w0 + 8, w1 + 8)} />
          <path d={capsule(add(el, [-6, 12]), add(wr, [-6, 12]), w1 + 8, w2 + 8)} />
        </g>
      ) : null}
      <Segment a={sh} b={el} wa={w0} wb={w1} lit={mix(lit, dark, 0.35)} mid={mix(base, dark, 0.3)} dark={dark} id={`${uid}${k}u`} />
      <Segment a={el} b={wr} wa={w1} wb={w2} lit={lit} mid={base} dark={dark} id={`${uid}${k}f`} />
      {bent > 0.02 ? (
        <g fill="none" stroke={mix(dark, NIGHT.ink, 0.4)} strokeLinecap="round" opacity={bent * 0.8}>
          <path d={fold(4, w1 * 0.5)} strokeWidth={3} />
          <path d={fold(20, w1 * 0.36)} strokeWidth={2.4} />
          <path d={fold(-12, w1 * 0.3)} strokeWidth={2} />
        </g>
      ) : null}
      {/* ribbed cuff */}
      <g transform={place(wr, cuffDir)}>
        <rect x={-26} y={-w2 / 2 - 2} width={26} height={w2 + 4} rx={8} fill={mix(base, pal.knitHi, 0.35)} />
        <path d={`M-20 ${-w2 / 2 + 3} V${w2 / 2 - 3} M-13 ${-w2 / 2 + 2} V${w2 / 2 - 2} M-6 ${-w2 / 2 + 3} V${w2 / 2 - 3}`} stroke={pal.knitDeep} strokeWidth={1.5} opacity={0.55} />
      </g>
      <path d={litEdge(el, wr, w1, w2)} stroke={pal.rim} strokeWidth={2.4} opacity={pal.rimAmt * (near ? 0.5 : 0.75)} strokeLinecap="round" />
      <path d={litEdge(sh, el, w0, w1)} stroke={pal.rim} strokeWidth={2} opacity={pal.rimAmt * (near ? 0.2 : 0.45)} strokeLinecap="round" />
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
  const binoHeldNear = s.nearBino && s.binoGrip > 0.5;
  const holdPhone = q.phone && s.phone > 0.02 && !binoHeldNear;
  const holdCup = q.sip > 0.02 && !holdPhone;
  const openHands = s.sleep > 0.5 && !holdPhone && !holdCup;

  const defs = (
    <defs>
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
        <g transform={place(s.phoneC, s.phoneDeg)}>
          <PhoneInHand pal={pal} grip={q.grip} uid={uid} />
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
      {holdPhone ? null : <Hand pal={pal} kind={openHands ? 'open' : 'grip'} at={s.wristN} deg={nearDeg} grip={q.grip} uid={uid} flip={holdCup || binoHeldNear} />}
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
      <Hand pal={pal} kind={openHands ? 'open' : 'grip'} at={s.wristF} deg={penDeg} uid={uid} scale={0.92} />
    </g>
  );
  const farArm = <Arm sh={s.sF} el={s.elbowF} wr={s.wristF} pal={pal} near={false} uid={uid} />;
  const binos = (
    <g transform={place(s.binoPos, s.binoDeg, 0.95)}>
      <BinocularsArt rim={pal.rim} under={pal.under} rimAmount={pal.rimAmt} underAmount={pal.underAmt} lens={pal.d > 0.5 ? LIGHT.primary : NIGHT.teal} />
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
  return {
    neck: abs([0, 0]),
    /** Centre of the phone in her near hand, its rotation (deg) and size (draw RitaPhoneArt there for the toss). */
    phone: abs(s.phoneC),
    phoneDeg: s.phoneDeg,
    phoneSize: {w: PHONE.w, h: PHONE.h},
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
 * Mirrors CarInterior's CarFront pad transform (translate to the placement,
 * rotate, scale w/600 by w/600 × squash); pass the same placement the cabin uses.
 */
export const padToRest = (p: readonly [number, number], at: PadPlacement = CAR.pad): P => {
  const sx = at.w / PAD_BOX.w;
  const sy = sx * (at.squash ?? 0.62);
  const x = p[0] * sx;
  const y = p[1] * sy;
  const r = ((at.rotate ?? 0) * Math.PI) / 180;
  return [at.x + x * Math.cos(r) - y * Math.sin(r), at.y + x * Math.sin(r) + y * Math.cos(r)];
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
  [-30, -326],
  [50, -316],
  [102, -280],
  [121, -234, 1],
  [100, -230],
  [60, -226],
  [24, -214],
  [8, -180],
  [-2, -130],
  [-8, -80],
  [-2, -46],
  [-14, -30, 1],
  [-34, -44],
  [-56, -28, 1],
  [-80, -42],
  [-104, -30, 1],
  [-128, -48],
  [-160, -96],
  [-180, -170],
  [-176, -236],
  [-148, -290],
  [-96, -322],
];
const PROFILE_LOCKS: Array<{pts: P[]; w: number; hi?: boolean}> = [
  {pts: [[-120, -284], [-160, -204], [-152, -112], [-118, -46]], w: 6},
  {pts: [[-70, -304], [-110, -224], [-104, -120], [-74, -40]], w: 6},
  {pts: [[-24, -310], [-56, -232], [-52, -130], [-34, -40]], w: 5},
  {pts: [[-96, -306], [-136, -226], [-130, -120], [-98, -40]], w: 3, hi: true},
  {pts: [[-10, -316], [52, -306], [100, -272]], w: 3, hi: true},
];
const PROFILE_BODY: C[] = [
  [-50, 30],
  [20, 44],
  [74, 60],
  [140, 108],
  [178, 196],
  [196, 900, 1],
  [-300, 900, 1],
  [-292, 260],
  [-262, 136],
  [-196, 70],
  [-120, 40],
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
  const L = clamp01(light);
  const base = palette(0);
  // a darker palette: she is a silhouette against the windshield glow, picked out by rims
  const pal: Pal = {...base, face: mix(NIGHT.ink, base.face, 0.7), faceDeep: mix(NIGHT.ink, base.faceDeep, 0.7), rimAmt: base.rimAmt * L, underAmt: base.underAmt * L};
  const b = breath(t, 0.25, 2);
  const g = clamp01(grip);
  const sil = pal.face;
  const hair = mix(NIGHT.ink, base.hair, 0.75);
  const knit = mix(NIGHT.ink, base.knit, 0.8);
  const rb = browRaise * 8;
  const lid = clamp01(blink);
  // phone pressed to her ear (top behind the ear, bottom toward her jaw), the hand round it
  const phoneAt: P = [-14, -116];
  const phoneDeg = -22;
  const wrist = add(phoneAt, rot(PH_WRIST, phoneDeg));
  const elbow: P = [70, 236];
  const shoulder: P = [-40, 96];
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
        <linearGradient id={`${uid}body`} x1="0" y1="30" x2="0" y2="420" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={knit} />
          <stop offset="1" stopColor={NIGHT.ink} />
        </linearGradient>
        <linearGradient id={`${uid}neck`} x1="0" y1="-40" x2="0" y2="70" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={NIGHT.ink} stopOpacity={0.6} />
          <stop offset="1" stopColor={NIGHT.ink} stopOpacity={0} />
        </linearGradient>
        <linearGradient id={`${uid}hand`} x1="0" y1="-24" x2="0" y2="24" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={pal.rim} stopOpacity={0.12 * L} />
          <stop offset="0.5" stopColor={pal.rim} stopOpacity={0} />
          <stop offset="1" stopColor={GREEN} stopOpacity={0.25 * L} />
        </linearGradient>
        <clipPath id={`${uid}eye`}>
          <path d="M77 -159 Q87 -166 97 -160 Q89 -152 77 -159 Z" />
        </clipPath>
        <clipPath id={`${uid}hc`}>
          <path d={shape(PROFILE_HAIR)} />
        </clipPath>
      </defs>
      {/* shoulders and chest, falling into the dark */}
      <path d={shape(PROFILE_BODY)} fill={`url(#${uid}body)`} />
      <path d="M74 60 Q140 108 178 196 Q190 240 194 320" fill="none" stroke={pal.rim} strokeWidth={3} opacity={0.8 * L} strokeLinecap="round" />
      <path d="M-120 40 Q-196 70 -262 136" fill="none" stroke={pal.rim} strokeWidth={2} opacity={0.2 * L} strokeLinecap="round" />
      {/* the upper arm hanging from the shoulder, behind the chest line */}
      <path d={capsule(shoulder, elbow, 100, 80)} fill={mix(knit, NIGHT.ink, 0.35)} />
      {/* neck and collar */}
      <path d="M-30 -50 Q30 -22 40 20 L50 64 Q20 76 -6 74 Q-40 64 -38 0 Z" fill={mix(sil, NIGHT.ink, 0.35)} />
      <path d="M-30 -50 Q30 -22 40 20 L50 64 Q20 76 -6 74 Q-40 64 -38 0 Z" fill={`url(#${uid}neck)`} />
      <path d="M30 -20 Q40 20 50 66" fill="none" stroke={GREEN} strokeWidth={2.6} opacity={0.4 * L} />
      <path d="M22 40 L72 56 L48 98 Z" fill={mix(NIGHT.ink, base.blouse, 0.7)} />
      <path d="M72 56 L48 98" stroke={pal.rim} strokeWidth={2} opacity={0.6 * L} />
      <path d="M-40 34 Q10 50 72 56" fill="none" stroke={mix(knit, base.knitHi, 0.4)} strokeWidth={10} strokeLinecap="round" />
      {/* hair mass with locks, face, fringe */}
      <path d={shape(PROFILE_HAIR)} fill={`url(#${uid}hair)`} />
      <g clipPath={`url(#${uid}hc)`}>
        {PROFILE_LOCKS.map((l, i) => (
          <path key={i} d={lock(l.pts, l.w)} fill={l.hi ? base.hairHi : NIGHT.ink} opacity={l.hi ? 0.18 : 0.35} />
        ))}
      </g>
      <path d="M-148 -290 Q-96 -326 -30 -326 Q50 -318 102 -280 Q116 -258 121 -234" fill="none" stroke={base.hairHi} strokeWidth={3} opacity={0.55 * L} strokeLinecap="round" />
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
      <path d={`M62 ${-180 - rb} Q84 ${-192 - rb} 103 ${-183 - rb * 0.8}`} fill="none" stroke={base.brow} strokeWidth={5.5} strokeLinecap="round" />
      <path d={`M68 ${-184 - rb} Q86 ${-194 - rb} 102 ${-186 - rb * 0.8}`} fill="none" stroke={pal.rim} strokeWidth={1.4} opacity={0.5 * L} strokeLinecap="round" />
      <path d="M99 -175 L14 -158" stroke={base.frame} strokeWidth={4} strokeLinecap="round" />
      <path d="M99 -177 Q109 -158 102 -139" fill="none" stroke={base.frame} strokeWidth={6} strokeLinecap="round" />
      <path d="M101 -175 Q110 -158 104 -141" fill="none" stroke={pal.rimHot} strokeWidth={1.6} opacity={0.85 * L} />
      {mouthOpen > 0.01 ? <path d={`M92 -70 Q100 ${-70 + mouthOpen * 6} 106 -69 Q100 -71 92 -70 Z`} fill={NIGHT.ink} /> : null}
      <path d="M90 -70 Q98 -69 105 -70" fill="none" stroke={NIGHT.ink} strokeWidth={2.4} strokeLinecap="round" />
      {/* the profile rim */}
      <path d={shape(FACE_FRONT, false)} fill="none" stroke={pal.rim} strokeWidth={8} opacity={0.15 * L} />
      <path d={shape(FACE_FRONT, false)} fill="none" stroke={pal.rim} strokeWidth={3.2} opacity={0.95 * L} strokeLinejoin="round" />
      <path d="M100 -32 Q90 -18 60 -15 Q38 -16 28 -22" fill="none" stroke={GREEN} strokeWidth={3} opacity={0.6 * L} strokeLinecap="round" />
      <path d="M-20 -306 Q52 -318 102 -280 Q116 -258 121 -234" fill="none" stroke={base.hairHi} strokeWidth={3.2} opacity={0.75 * L} strokeLinecap="round" />
      <path d="M-8 -80 Q-4 -56 -2 -46 Q-8 -36 -14 -30" fill="none" stroke={GREEN} strokeWidth={2.4} opacity={0.5 * L} />
      {/* forearm up to the phone: shaded sleeve, cuff */}
      <Segment a={elbow} b={wrist} wa={74} wb={58} lit={mix(knit, base.knitHi, 0.35)} mid={knit} dark={mix(knit, NIGHT.ink, 0.6)} id={`${uid}fa`} />
      <path d={litEdge(elbow, wrist, 74, 58)} stroke={pal.rim} strokeWidth={2.6} opacity={0.7 * L} strokeLinecap="round" />
      <g transform={place(wrist, angle(sub(wrist, elbow)))}>
        <rect x={-28} y={-31} width={28} height={62} rx={9} fill={mix(knit, base.knitHi, 0.3)} />
        <path d="M-21 -26 V26 M-14 -27 V27 M-7 -26 V26" stroke={NIGHT.ink} strokeWidth={1.5} opacity={0.4} />
      </g>
      {/* the phone and the hand round it */}
      <g transform={place(phoneAt, phoneDeg)}>
        <PhoneInHand pal={pal} grip={g} uid={uid} L={L} />
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
  bridge: {x: 594, y: 800},
} as const;

/** Lens outline points: a soft rounded rectangle, lifted a little at the outer top corner (a gentle cat-eye). */
const lensPts = (l: LensInfo): C[] => {
  const {cx, cy, rx, ry} = l;
  const outerLeft = l.index === 0;
  return [
    [cx - rx * 0.97, cy - ry * 0.6 - (outerLeft ? 16 : 0)],
    [cx - rx * 0.62, cy - ry * 0.98 - (outerLeft ? 8 : 0)],
    [cx + rx * 0.1, cy - ry * 1.0],
    [cx + rx * 0.7, cy - ry * 0.96 - (outerLeft ? 0 : 10)],
    [cx + rx * 0.98, cy - ry * 0.5 - (outerLeft ? 0 : 12)],
    [cx + rx * 0.94, cy + ry * 0.42],
    [cx + rx * 0.62, cy + ry * 0.9],
    [cx, cy + ry * 1.0],
    [cx - rx * 0.62, cy + ry * 0.88],
    [cx - rx * 0.96, cy + ry * 0.3],
  ];
};
const lensPath = (l: LensInfo) => shape(lensPts(l));
/** The browline bar along the top of a lens (open path). */
const browBar = (l: LensInfo) => {
  const p = lensPts(l).map((c): P => [c[0], c[1]]);
  const outerLeft = l.index === 0;
  const a = outerLeft ? lerpP(p[0], p[9], 0.45) : p[0];
  const b = outerLeft ? p[4] : lerpP(p[4], p[5], 0.4);
  return shape([a, p[0], p[1], p[2], p[3], p[4], b], false);
};

/** The fringe across the top of the S09 frame: overlapping locks with pointed tips sweeping right. */
const FRINGE_LOCKS_CU: Array<{x: number; tip: P; w: number; shade: number}> = [
  {x: -40, tip: [60, 590], w: 200, shade: 0.5},
  {x: 120, tip: [240, 630], w: 220, shade: 0.75},
  {x: 290, tip: [400, 596], w: 210, shade: 0.55},
  {x: 440, tip: [560, 624], w: 220, shade: 0.8},
  {x: 590, tip: [700, 586], w: 210, shade: 0.6},
  {x: 730, tip: [850, 606], w: 230, shade: 0.85},
  {x: 890, tip: [1000, 556], w: 240, shade: 0.65},
  {x: 1020, tip: [1120, 520], w: 210, shade: 0.75},
  {x: 50, tip: [170, 548], w: 170, shade: 0.95},
  {x: 360, tip: [470, 560], w: 180, shade: 1},
  {x: 660, tip: [770, 548], w: 180, shade: 0.95},
  {x: 940, tip: [1060, 500], w: 170, shade: 1},
];
const fringeLock = (l: (typeof FRINGE_LOCKS_CU)[number]) => {
  const [tx, ty] = l.tip;
  const x0 = l.x - l.w / 2;
  const x1 = l.x + l.w / 2;
  return `M${x0} -40 C${x0 + 10} ${ty * 0.45} ${tx - 70} ${ty * 0.8} ${tx} ${ty} C${tx - 16} ${ty * 0.74} ${x1 - 16} ${ty * 0.45} ${x1} -40 Z`;
};
/** Brow hairs (deterministic): [x0, y0, x1, y1] in frame px. */
const browHairs = (from: P, to: P, n: number, h: number, seed: number) =>
  Array.from({length: n}, (_, i) => {
    const u = i / (n - 1);
    const j = Math.sin((i + 1) * 12.9898 + seed * 78.233) * 43758.5453;
    const r = j - Math.floor(j);
    const x = lerp(from[0], to[0], u);
    const y = lerp(from[1], to[1], u) - Math.sin(u * Math.PI) * h + (r - 0.5) * 10;
    return [x, y + 8, x + 26 + r * 10, y - 6 - r * 4] as const;
  });

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

/** The S09 extreme close-up as a full-frame layer (glasses within x 90–940, y 640–1120). No facial animation needed. */
export const RitaGlasses: React.FC<RitaGlassesProps & {style?: React.CSSProperties}> = ({reflection, reflectionOpacity = 0.6, drift = 0, glint = 0, chainGlint = 0.5, lookX = 0, blink = 0, style}) => {
  const uid = useUid('rg');
  const pal = palette(0);
  const skin = mix(NIGHT.ink, pal.face, 0.95);
  const skinLit = mix(skin, NIGHT.tealSoft, 0.2);
  const skinDeep = mix(skin, NIGHT.ink, 0.45);
  const L = GLASSES_CU.lenses;
  const frame = mix(NIGHT.ink, NIGHT.redDeep, 0.85);
  const frameHi = mix(NIGHT.redDeep, NIGHT.red, 0.45);
  const metal = mix(NIGHT.grey, NIGHT.ink, 0.45);
  const gOn = glint > 0.001 && glint < 0.999;
  const gx = lerp(L[0].cx - L[0].rx * 1.3, L[0].cx + L[0].rx * 1.3, glint);
  const lid = clamp01(blink);
  const beads = Array.from({length: 46}, (_, i) => {
    const u = i / 45;
    return {p: arc([30, 800], [210, 1960], -90, u), i, u};
  });
  const nose: C[] = [[574, 790], [628, 772], [700, 960], [790, 1140], [880, 1268], [946, 1316], [962, 1366], [926, 1404], [866, 1404], [818, 1396], [784, 1384, 1], [770, 1344], [744, 1300], [690, 1210], [636, 1080], [596, 940]];
  // an almond eye, dark behind the glass: lids, lashes, a pinpoint catchlight
  const eye = (cx: number, cy: number, w: number, h: number, key: string) => {
    const hw = w / 2;
    const top = cy - h * 0.62;
    const bot = cy + h * 0.42;
    const upper = lerp(top, bot, lid);
    const d = `M${cx - hw} ${cy + 4} Q${cx - hw * 0.2} ${top - h * 0.25} ${cx + hw} ${cy - h * 0.1} Q${cx + hw * 0.1} ${bot + h * 0.2} ${cx - hw} ${cy + 4} Z`;
    return (
      <g key={key}>
        <defs>
          <clipPath id={`${uid}eye${key}`}>
            <path d={d} />
          </clipPath>
        </defs>
        {/* the socket's shadow, the lid crease and the bag under the eye */}
        <ellipse cx={cx} cy={cy - h * 0.2} rx={hw * 1.3} ry={h * 1.6} fill={`url(#${uid}sock)`} />
        <path d={`M${cx - hw * 0.9} ${top - h * 0.3} Q${cx} ${top - h * 0.95} ${cx + hw * 0.95} ${top - h * 0.28}`} fill="none" stroke={skinDeep} strokeWidth={5} strokeLinecap="round" opacity={0.8} />
        <path d={`M${cx - hw * 0.7} ${bot + h * 0.3} Q${cx} ${bot + h * 0.55} ${cx + hw * 0.75} ${bot + h * 0.1}`} fill="none" stroke={skinDeep} strokeWidth={3.5} opacity={0.6} strokeLinecap="round" />
        <path d={d} fill={mix(NIGHT.ink, NIGHT.tealDeep, 0.85)} />
        <g clipPath={`url(#${uid}eye${key})`}>
          <circle cx={cx + lookX * hw * 0.3} cy={cy - h * 0.05} r={h * 0.5} fill={NIGHT.ink} />
          <circle cx={cx + lookX * hw * 0.3} cy={cy - h * 0.05} r={h * 0.5} fill="none" stroke={NIGHT.teal} strokeWidth={3} opacity={0.35} />
          <circle cx={cx + lookX * hw * 0.3 + h * 0.18} cy={cy - h * 0.22} r={h * 0.08} fill={NIGHT.tealSoft} opacity={0.8} />
          <path d={`M${cx - hw - 10} ${upper - h * 0.6} L${cx + hw + 10} ${upper - h * 0.6} L${cx + hw + 10} ${upper + (cy - h * 0.1 - upper) * 0.1} Q${cx} ${upper - h * 0.1 + (lid > 0.5 ? h * 0.25 : 0)} ${cx - hw - 10} ${upper + 6} Z`} fill={skin} />
        </g>
        <path d={`M${cx - hw} ${cy + 4} Q${cx - hw * 0.2} ${lerp(top - h * 0.25, bot, lid)} ${cx + hw} ${cy - h * 0.1}`} fill="none" stroke={NIGHT.ink} strokeWidth={7} strokeLinecap="round" />
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
              <stop offset="1" stopColor={NIGHT.ink} stopOpacity={0.6} />
            </radialGradient>
          ))}
          <linearGradient id={`${uid}face`} x1="0" y1="400" x2="0" y2="1920" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor={mix(skin, NIGHT.ink, 0.5)} />
            <stop offset="0.3" stopColor={skin} />
            <stop offset="0.75" stopColor={mix(skin, GREEN, 0.07)} />
            <stop offset="1" stopColor={mix(skin, NIGHT.ink, 0.5)} />
          </linearGradient>
          <linearGradient id={`${uid}side`} x1="0" y1="0" x2="1080" y2="0" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor={NIGHT.ink} stopOpacity={0.62} />
            <stop offset="0.4" stopColor={NIGHT.ink} stopOpacity={0.08} />
            <stop offset="0.75" stopColor={NIGHT.ink} stopOpacity={0.05} />
            <stop offset="1" stopColor={NIGHT.tealSoft} stopOpacity={0.1} />
          </linearGradient>
          <radialGradient id={`${uid}sock`}>
            <stop offset="0" stopColor={NIGHT.ink} stopOpacity={0.4} />
            <stop offset="1" stopColor={NIGHT.ink} stopOpacity={0} />
          </radialGradient>
          <radialGradient id={`${uid}soft`}>
            <stop offset="0" stopColor={NIGHT.tealSoft} stopOpacity={0.1} />
            <stop offset="1" stopColor={NIGHT.tealSoft} stopOpacity={0} />
          </radialGradient>
          <radialGradient id={`${uid}warm`}>
            <stop offset="0" stopColor={mix(SKIN, NIGHT.red, 0.2)} stopOpacity={0.07} />
            <stop offset="1" stopColor={mix(SKIN, NIGHT.red, 0.2)} stopOpacity={0} />
          </radialGradient>
          <linearGradient id={`${uid}nose`} x1="600" y1="1000" x2="860" y2="940" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor={skinDeep} />
            <stop offset="0.55" stopColor={skin} />
            <stop offset="0.85" stopColor={skinLit} />
            <stop offset="1" stopColor={mix(skinLit, NIGHT.tealSoft, 0.15)} />
          </linearGradient>
          <linearGradient id={`${uid}fringe`} x1="0" y1="0" x2="0" y2="520" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor={mix(NIGHT.ink, pal.hair, 0.35)} />
            <stop offset="0.55" stopColor={mix(NIGHT.ink, pal.hair, 0.5)} />
            <stop offset="1" stopColor={mix(NIGHT.ink, skin, 0.5)} />
          </linearGradient>
          <linearGradient id={`${uid}fshade`} x1="0" y1="420" x2="0" y2="760" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor={NIGHT.ink} stopOpacity={0.6} />
            <stop offset="1" stopColor={NIGHT.ink} stopOpacity={0} />
          </linearGradient>
          <linearGradient id={`${uid}tint`} x1="0" y1="700" x2="0" y2="1060" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor={NIGHT.tealSoft} stopOpacity={0.1} />
            <stop offset="1" stopColor={NIGHT.teal} stopOpacity={0.04} />
          </linearGradient>
        </defs>
        {/* her face fills the frame, in shadow: lit from the windshield (right), green from below */}
        <rect x={0} y={0} width={1080} height={1920} fill={`url(#${uid}face)`} />
        <rect x={0} y={0} width={1080} height={1920} fill={`url(#${uid}side)`} />
        {/* forehead in the fringe's shadow */}
        <rect x={0} y={380} width={1080} height={400} fill={`url(#${uid}fshade)`} />
        {/* cheeks: the near cheekbone's soft roundness, the far cheek catching the windshield */}
        <ellipse cx={360} cy={1250} rx={330} ry={170} fill={`url(#${uid}warm)`} />
        <ellipse cx={1010} cy={1150} rx={220} ry={260} fill={`url(#${uid}soft)`} />
        <path d="M110 1190 Q300 1136 540 1196" fill="none" stroke={skinDeep} strokeWidth={4} opacity={0.35} strokeLinecap="round" />
        {/* nose: bridge between the lenses, the lit ridge falling to the tip at the lower right, wing and nostril */}
        <path d={shape(nose)} fill={`url(#${uid}nose)`} />
        <path d="M632 776 Q700 960 790 1140 Q872 1262 944 1312" fill="none" stroke={skinLit} strokeWidth={16} opacity={0.4} strokeLinecap="round" />
        <path d="M636 778 Q704 958 794 1136 Q876 1258 950 1310" fill="none" stroke={NIGHT.tealSoft} strokeWidth={3.5} opacity={0.6} strokeLinecap="round" />
        <path d="M784 1384 Q752 1344 776 1310 Q806 1290 836 1318" fill="none" stroke={skinDeep} strokeWidth={6} opacity={0.75} strokeLinecap="round" />
        <ellipse cx={866} cy={1394} rx={20} ry={8} fill={NIGHT.ink} opacity={0.6} transform="rotate(-8 866 1394)" />
        <path d="M800 1408 Q880 1424 950 1400" fill="none" stroke={GREEN} strokeWidth={3} opacity={0.3} strokeLinecap="round" />
        <path d="M600 960 Q650 1120 744 1300" fill="none" stroke={NIGHT.ink} strokeWidth={22} opacity={0.12} strokeLinecap="round" />
        {/* the fold from the nose wing toward the mouth corner */}
        <path d="M770 1396 Q720 1470 690 1580" fill="none" stroke={skinDeep} strokeWidth={5} opacity={0.5} strokeLinecap="round" />
        {/* brows: a tapered mass, hairs along it, partly under the fringe */}
        <path d="M120 716 Q260 640 470 650 Q488 660 474 672 Q270 664 132 730 Q110 732 120 716 Z" fill={mix(pal.brow, NIGHT.ink, 0.45)} />
        <path d="M686 664 Q800 634 914 666 Q920 678 908 682 Q800 656 692 680 Q678 674 686 664 Z" fill={mix(pal.brow, NIGHT.ink, 0.45)} />
        <g stroke={mix(pal.brow, NIGHT.tealSoft, 0.15)} strokeWidth={2.4} strokeLinecap="round" opacity={0.55} fill="none">
          {browHairs([130, 712], [462, 656], 22, 40, 1).map(([a, b, c, d], i) => (
            <path key={`n${i}`} d={`M${a} ${b} Q${(a + c) / 2} ${b - 12} ${c} ${d}`} />
          ))}
          {browHairs([690, 674], [904, 668], 14, 26, 2).map(([a, b, c, d], i) => (
            <path key={`f${i}`} d={`M${a} ${b} Q${(a + c) / 2} ${b - 10} ${c} ${d}`} />
          ))}
        </g>
        {/* eyes, dark behind the glass */}
        {eye(L[0].cx + 14, L[0].cy + 10, 220, 70, 'n')}
        {eye(L[1].cx + 6, L[1].cy + 8, 128, 56, 'f')}
        {/* the fringe across the top of the frame */}
        <rect x={-20} y={-40} width={1120} height={560} fill={`url(#${uid}fringe)`} />
        {[...FRINGE_LOCKS_CU].sort((a, b) => a.shade - b.shade).map((l, i) => (
          <path key={i} d={fringeLock(l)} fill={mix(NIGHT.ink, mix(pal.hair, NIGHT.tealSoft, 0.08), l.shade)} />
        ))}
        {FRINGE_LOCKS_CU.map((l, i) => (
          <path key={i} d={`M${l.x + l.w * 0.25} 120 C${l.x + l.w * 0.25} ${l.tip[1] * 0.5} ${l.tip[0] - 30} ${l.tip[1] * 0.82} ${l.tip[0] - 4} ${l.tip[1] - 8}`} fill="none" stroke={NIGHT.tealSoft} strokeWidth={2.5} opacity={0.08 + l.shade * 0.12} strokeLinecap="round" />
        ))}
        {/* the near curtain of the bob down the left edge */}
        <path d="M0 520 Q74 640 88 900 Q100 1200 64 1500 Q44 1700 0 1780 Z" fill={mix(NIGHT.ink, pal.hair, 0.5)} />
        <path d="M30 600 Q86 760 86 900 Q94 1200 62 1500" fill="none" stroke={NIGHT.tealSoft} strokeWidth={3} opacity={0.16} strokeLinecap="round" />
        {/* the lenses: the empty teal lobby reflected, bulging slightly */}
        {L.map((l) => (
          <g key={l.index} clipPath={`url(#${uid}l${l.index})`}>
            <rect x={l.cx - l.rx * 1.2} y={l.cy - l.ry * 1.2} width={l.rx * 2.4} height={l.ry * 2.4} fill={`url(#${uid}tint)`} />
            {reflection ? (
              <g opacity={reflectionOpacity} transform={`translate(${l.cx + drift} ${l.cy}) scale(1.08 1.06) translate(${-l.cx} ${-l.cy})`}>
                {typeof reflection === 'function' ? reflection(l) : reflection}
              </g>
            ) : null}
            <rect x={l.cx - l.rx * 1.2} y={l.cy - l.ry * 1.2} width={l.rx * 2.4} height={l.ry * 2.4} fill={`url(#${uid}v${l.index})`} />
            {/* a curved sheen along the top of the glass */}
            <path d={`M${l.cx - l.rx * 0.8} ${l.cy - l.ry * 0.6} Q${l.cx} ${l.cy - l.ry * 0.96} ${l.cx + l.rx * 0.75} ${l.cy - l.ry * 0.64}`} fill="none" stroke={NIGHT.ivory} strokeWidth={10} opacity={0.08} strokeLinecap="round" />
            {l.index === 0 && gOn ? (
              <g opacity={Math.sin(glint * Math.PI)}>
                <path d={`M${gx - 60} ${l.cy - l.ry * 1.2} L${gx + 10} ${l.cy - l.ry * 1.2} L${gx - 80} ${l.cy + l.ry * 1.2} L${gx - 150} ${l.cy + l.ry * 1.2} Z`} fill={NIGHT.phoneGlowTeal} opacity={0.45} />
                <path d={`M${gx + 30} ${l.cy - l.ry * 1.2} L${gx + 44} ${l.cy - l.ry * 1.2} L${gx - 46} ${l.cy + l.ry * 1.2} L${gx - 60} ${l.cy + l.ry * 1.2} Z`} fill={NIGHT.phoneGlowTeal} opacity={0.6} />
              </g>
            ) : null}
          </g>
        ))}
        {/* nose pads on their arms */}
        <path d="M570 900 Q574 860 586 830" fill="none" stroke={metal} strokeWidth={3} />
        <ellipse cx={566} cy={922} rx={11} ry={24} fill={NIGHT.tealSoft} opacity={0.1} stroke={NIGHT.tealSoft} strokeOpacity={0.3} strokeWidth={2} />
        {/* browline frames: a thin metal rim round each lens, a burgundy bar along the top */}
        {L.map((l) => (
          <g key={l.index}>
            <path d={lensPath(l)} fill="none" stroke={NIGHT.ink} strokeWidth={8} opacity={0.4} transform="translate(3 6)" />
            <path d={lensPath(l)} fill="none" stroke={metal} strokeWidth={l.index === 0 ? 5 : 4} strokeLinejoin="round" />
            <path d={`M${l.cx - l.rx * 0.5} ${l.cy + l.ry * 0.95} Q${l.cx} ${l.cy + l.ry * 1.04} ${l.cx + l.rx * 0.55} ${l.cy + l.ry * 0.93}`} fill="none" stroke={GREEN} strokeWidth={2.5} opacity={0.45} strokeLinecap="round" />
            <path d={browBar(l)} fill="none" stroke={NIGHT.ink} strokeWidth={l.index === 0 ? 30 : 24} strokeLinecap="round" strokeLinejoin="round" opacity={0.45} transform="translate(4 9)" />
            <path d={browBar(l)} fill="none" stroke={frame} strokeWidth={l.index === 0 ? 26 : 20} strokeLinecap="round" strokeLinejoin="round" />
            <path d={browBar(l)} fill="none" stroke={frameHi} strokeWidth={3} opacity={0.5} strokeLinecap="round" transform={`translate(0 ${l.index === 0 ? 7 : 5})`} />
            <path d={`M${l.cx - l.rx * 0.62} ${l.cy - l.ry * 0.98 - (l.index === 0 ? 8 : 0) - 9} Q${l.cx + l.rx * 0.1} ${l.cy - l.ry * 1.1} ${l.cx + l.rx * 0.72} ${l.cy - l.ry * 0.98 - (l.index === 0 ? 0 : 10) - 7}`} fill="none" stroke={NIGHT.tealSoft} strokeWidth={4} opacity={0.75} strokeLinecap="round" />
          </g>
        ))}
        {/* bridge, hinge and temple to the left */}
        <path d={`M${L[0].cx + L[0].rx * 0.96} ${L[0].cy - L[0].ry * 0.62} Q${GLASSES_CU.bridge.x} ${GLASSES_CU.bridge.y - 40} ${L[1].cx - L[1].rx * 0.96} ${L[1].cy - L[1].ry * 0.56}`} fill="none" stroke={frame} strokeWidth={16} strokeLinecap="round" />
        <path d={`M${L[0].cx + L[0].rx * 0.96} ${L[0].cy - L[0].ry * 0.62 - 6} Q${GLASSES_CU.bridge.x} ${GLASSES_CU.bridge.y - 47} ${L[1].cx - L[1].rx * 0.96} ${L[1].cy - L[1].ry * 0.56 - 6}`} fill="none" stroke={NIGHT.tealSoft} strokeWidth={3} opacity={0.65} strokeLinecap="round" />
        <path d={`M${L[0].cx - L[0].rx * 0.97} ${L[0].cy - L[0].ry * 0.6 - 16} L-20 ${L[0].cy - L[0].ry * 0.5 - 16}`} stroke={frame} strokeWidth={18} strokeLinecap="round" />
        <path d={`M${L[0].cx - L[0].rx * 0.97} ${L[0].cy - L[0].ry * 0.6 - 23} L-20 ${L[0].cy - L[0].ry * 0.5 - 23}`} stroke={frameHi} strokeWidth={2.5} opacity={0.4} strokeLinecap="round" />
        <circle cx={L[0].cx - L[0].rx * 0.97} cy={L[0].cy - L[0].ry * 0.6 - 14} r={8} fill={pal.brass} />
        <circle cx={L[0].cx - L[0].rx * 0.97 + 2.5} cy={L[0].cy - L[0].ry * 0.6 - 17} r={3} fill={NIGHT.brassLight} />
        {/* the beaded chain from the temple loop, a highlight running down it */}
        {beads.map(({p, i, u}) => {
          const hot = Math.max(0, 1 - Math.abs(u - chainGlint) * 6);
          return (
            <g key={i}>
              <circle cx={p[0]} cy={p[1]} r={7} fill={mix(NIGHT.ink, NIGHT.brass, 0.65)} />
              <circle cx={p[0] + 2} cy={p[1] - 2} r={2.6 + hot * 2} fill={mix(NIGHT.brassLight, NIGHT.ivory, hot)} opacity={0.45 + hot * 0.55} />
            </g>
          );
        })}
      </svg>
    </AbsoluteFill>
  );
};
