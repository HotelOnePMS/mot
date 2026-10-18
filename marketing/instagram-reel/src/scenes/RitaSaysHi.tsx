// RitaSaysHi (S15–S16, 31.5–37.0). Rig A in the car, the same night (2:21).
//   S15  The whip-pan from the console lands in the car (blur resolves over 4 frames). Rita lowers the
//        binoculars 120 px (31.6–32.3, ease-out) and looks across at the Starlite with grudging
//        recognition: "…That’s Gus’s rule." Teal from the sign on her face. 2% push. Hard cut.
//   S16  Wider, with the passenger seat. Phone at her ear, a tiny smug smile and a head tip toward the
//        Starlite (33.2–33.6): "Rita says hi." She listens to the AI, brings the phone down, and taps End
//        exactly on cue('AI04').cut (chopping "they’ll"), tosses it onto the passenger seat (thud at
//        PHONE_THUD, one 6 px bounce, settled by S16.toss.end), glances at it at S16.turn: "Show-off."
// Captions are global (Captions.tsx); nothing here draws text.
import React from 'react';
import {AbsoluteFill, Easing, interpolate, useCurrentFrame} from 'remotion';
import type {SceneProps} from './types.ts';
import {NIGHT} from '../theme.ts';
import {handheld} from '../fx/noise.ts';
import {points as ritaPoints} from './ritasayshi/common.ts';
import type {RitaPose} from '../char/Rita.tsx';
import type {P} from '../char/rig.ts';
import {Cabin, type Spill} from './ritasayshi/Cabin.tsx';
import {LANDING, TossedPhone} from './ritasayshi/Toss.tsx';
import {WhipStreaks, whipOffset, whipSamples} from './ritasayshi/Whip.tsx';
import {
  AI04,
  HANG,
  R11,
  R12,
  R13,
  S15,
  S16,
  S16_AT,
  END_AT,
  SETTLE,
  TURN,
  binocularsFor,
  blinkAt,
  camOn,
  clamp,
  easeInOut,
  easeOut,
  lf,
  mouthFor,
  ramp,
  secOf,
  sine,
  voiceLevel,
} from './ritasayshi/common.ts';

// ─── S15 ─────────────────────────────────────────────────────────────────────

/** MCU: her face left, the STARLITE sign in the windshield right. */
const S15_FOCUS: P = [600, 650];
const S15_TO: P = [505, 772];
const S15_SCALE = 1.22;
/** Binoculars lowered 120 frame px (board), solved on the rig's arc at this scale. */
const B_LOW = binocularsFor(120, S15_SCALE);
const B_SETTLE = binocularsFor(165, S15_SCALE);

const S15Shot: React.FC<{frame: number}> = ({frame}) => {
  const sec = secOf(frame);
  const blurFrames = S15.blurResolve.frames;
  const push = interpolate(frame, [0, S16_AT], [0, 1], {...clamp, easing: sine});
  const hh = handheld(frame, 1.4, 0.45, 'rsh15');
  const cam = (dx: number) => camOn(S15_FOCUS, S15_SCALE * (1 + 0.02 * push), [S15_TO[0] + hh.x + dx, S15_TO[1] + hh.y], 0.3);

  const lower = interpolate(sec, [S15.lower.start, S15.lower.end], [0, 1], {...clamp, easing: easeOut});
  // then a slow settle (+45 px by "rule") so the grudging corner of her mouth clears the barrels
  const settle = ramp(sec, S15.lower.end, R11.words[2].start + 0.2, 0, 1, sine);
  const binoculars = 1 + (B_LOW - 1) * lower + (B_SETTLE - B_LOW) * settle;
  // eyes find the sign over the lenses; the brows go up on "Gus’s", a grudging corner of the mouth on "rule"
  const gus = R11.words[1].start;
  const rule = R11.words[2].start;
  const brow = ramp(sec, gus - 0.12, gus + 0.18, 0.12, 0.5, easeOut);
  const smirk = ramp(sec, rule - 0.05, rule + 0.3, 0.05, 0.32, easeOut);
  const nod = interpolate(sec, [rule - 0.08, rule + 0.14, rule + 0.42], [0, 2.6, 1.2], {...clamp, easing: sine});
  const pose: RitaPose = {
    t: sec,
    phoneToEar: 1,
    grip: 0.3,
    binoculars,
    binocularHand: 'far',
    lookX: 0.55,
    lookY: -0.08,
    browRaise: brow,
    browAsym: 0.35,
    squint: 0.22 + 0.14 * lower,
    smirk,
    headTilt: nod,
    mouthOpen: mouthFor(R11, sec, 0.28),
    light: 'night',
  };
  const spill = {wash: 0.65 + 0.35 * lower, voice: 0};

  const offsets = whipSamples(frame, blurFrames);
  const v = interpolate(frame, [0, blurFrames], [1, 0], {...clamp, easing: easeOut});
  return (
    <AbsoluteFill style={{background: NIGHT.ink}}>
      {offsets.map((dx, i) => (
        <Cabin key={i} id={`rsh15-${i}`} camera={cam(dx)} pose={pose} sec={sec} spill={spill} style={i ? {opacity: 1 / (i + 1)} : undefined} />
      ))}
      <WhipStreaks v={v} travel={260 - whipOffset(frame, blurFrames)} />
    </AbsoluteFill>
  );
};

// ─── S16 ─────────────────────────────────────────────────────────────────────

/** Medium: Rita, the wheel and pad, the Starlite in the windshield, the passenger seat bottom right. */
const S16_FOCUS: P = [560, 940];
const S16_TO: P = [520, 900];
const S16_SCALE = 1.06;

/** Phone lowered to look at the screen (phoneToEar), and the down/up beat of the thumb on End. */
const PHONE_DOWN = 0.46;
const DOWN = {start: 35.42, end: 35.74};
/** The near wrist's follow-through after the toss (body-local px: down and right, toward the seat). */
const REACH_TO: P = [214, 300];

/** Rita's pose and the light on her at a scene-local frame of S16. */
const s16Pose = (frame: number): {pose: RitaPose; spill: Spill} => {
  const sec = secOf(frame);
  const tossed = frame > HANG;
  const look = interpolate(frame, [TURN - 1, TURN + 4], [0, 1], {...clamp, easing: easeOut});

  // phone: at her ear through "Rita says hi" and most of the AI's reply, down to look at it, tap on HANG
  const down = interpolate(sec, [DOWN.start, DOWN.end], [0, 1], {...clamp, easing: easeInOut});
  const tap = interpolate(frame, [HANG - 2, HANG, HANG + 1], [0, 1, 0], clamp);
  const phoneToEar = tossed ? 0 : 1 + (PHONE_DOWN - 1) * down - 0.03 * tap;
  // follow-through: the near hand flicks toward the seat, then comes back to rest
  const reach = interpolate(frame, [HANG, HANG + 2, HANG + 4, SETTLE + 10], [0, 0.85, 0.7, 0], {...clamp, easing: easeInOut});

  // face
  const tilt = ramp(sec, S16.headTilt.start, S16.headTilt.end, 0, 7, easeInOut);
  const tiltBack = ramp(sec, 34.55, 35.1, 0, 4, easeInOut);
  const lookDownAtPhone = ramp(sec, DOWN.start + 0.08, DOWN.end + 0.04, 0, 1, easeInOut);
  // a small eye-roll up on "passed that to the team"
  const passed = AI04.words[1].start;
  const roll = interpolate(sec, [passed - 0.05, passed + 0.25, DOWN.start, DOWN.start + 0.15], [0, 1, 1, 0], {...clamp, easing: sine});
  const smug = ramp(sec, 33.12, 33.55, 0.22, 0.66, easeOut) - ramp(sec, 34.4, 34.9, 0, 0.3, easeInOut);
  const pose: RitaPose = {
    t: sec,
    phoneToEar,
    phone: !tossed,
    grip: 0.3 + 0.5 * tap,
    binoculars: 0,
    headTilt: tilt - tiltBack - 1.5 * roll + 3 * lookDownAtPhone,
    lookX: (0.5 - 0.25 * roll) * (1 - lookDownAtPhone) + 0.18 * lookDownAtPhone,
    lookY: -0.05 - 0.4 * roll + 0.75 * lookDownAtPhone,
    browRaise: 0.15 + 0.3 * roll + 0.05 * lookDownAtPhone,
    browAsym: 0.3,
    squint: 0.32 * (1 - roll) + 0.1,
    smirk: smug + 0.05 * lookDownAtPhone,
    mouthOpen: mouthFor(R12, sec, 0.3),
    blink: Math.max(blinkAt(frame, lf(34.32), 6), blinkAt(frame, HANG - 9, 4)),
    light: 'night',
    nearReach: reach > 0 ? {to: REACH_TO, amount: reach} : undefined,
  };
  if (tossed) {
    // the glance at the phone and "Show-off.": unimpressed, a little impressed
    const show = R13.words[0].start;
    Object.assign(pose, {
      // tossed without looking, eyes back out on the Starlite; then the glance down at the seat
      headTilt: interpolate(frame, [HANG, HANG + 5], [6, 4], {...clamp, easing: easeOut}) + 5 * look,
      lookX: 0.5 + 0.42 * look,
      lookY: 0.95 * look,
      browRaise: ramp(sec, show - 0.05, show + 0.25, 0.12, 0.58, easeOut),
      browAsym: 0.2,
      squint: 0.18 + ramp(sec, show + 0.2, show + 0.5, 0, 0.2, easeInOut),
      smirk: ramp(sec, show + 0.25, show + 0.6, 0.15, 0.38, easeOut),
      mouthOpen: mouthFor(R13, sec, 0.3),
      blink: blinkAt(frame, TURN - 1, 4),
    } satisfies RitaPose);
  }

  // light: the AI breathing teal out of the phone at her ear; the screen on her face once she looks down
  const spill: Spill = {
    wash: 0.4,
    voice: frame <= HANG ? voiceLevel(AI04, sec) * (1 - down) : 0,
    screen: tossed ? 0 : down * (0.75 + 0.5 * tap),
  };
  return {pose, spill};
};

/** The phone in her hand on the tap frame: where the toss starts. */
const TAP_PHONE = (() => {
  const p = ritaPoints(s16Pose(HANG).pose);
  return {at: p.phone, deg: p.phoneDeg};
})();

/** After the toss the operator follows the phone down to the seat: it lands in frame, her face top left. */
const FOLLOW_SCALE = 1.14;
const FOLLOW_TO: P = [792, 1450];

const S16Shot: React.FC<{frame: number}> = ({frame}) => {
  const sec = secOf(frame);
  const push = interpolate(frame, [S16_AT, HANG], [0, 1], {...clamp, easing: sine});
  const hh = handheld(frame, 1.3, 0.4, 'rsh16');
  const a = camOn(S16_FOCUS, S16_SCALE * (1 + 0.03 * push), [S16_TO[0] + hh.x, S16_TO[1] + hh.y], 0.3);
  const drift = interpolate(frame, [HANG, END_AT], [0, 1], clamp);
  const b = camOn(LANDING, FOLLOW_SCALE * (1 + 0.015 * drift), [FOLLOW_TO[0] + hh.x, FOLLOW_TO[1] + hh.y], 0.3);
  const k = interpolate(frame, [HANG + 1, HANG + 10], [0, 1], {...clamp, easing: Easing.bezier(0.3, 0.75, 0.25, 1)});
  const camera = {scale: a.scale + (b.scale - a.scale) * k, x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, depth: 0.3};
  const {pose, spill} = s16Pose(frame);
  return (
    <AbsoluteFill style={{background: NIGHT.ink}}>
      <Cabin
        id="rsh16"
        camera={camera}
        pose={pose}
        sec={sec}
        spill={spill}
        props={frame > HANG ? <TossedPhone frame={frame} from={TAP_PHONE.at} fromDeg={TAP_PHONE.deg} /> : null}
      />
    </AbsoluteFill>
  );
};

/** RitaSaysHi (S15, S16). */
export const RitaSaysHi: React.FC<SceneProps> = () => {
  const frame = useCurrentFrame();
  return frame < S16_AT ? <S15Shot frame={frame} /> : <S16Shot frame={frame} />;
};
