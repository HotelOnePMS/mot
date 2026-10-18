// Shared timing for the RitaSaysHi scene (S15–S16, 31.5–37.0).
// Every voice-synced time comes from marks.ts / timeline.ts (measured voice), never the board's literal numbers.
import {Easing, interpolate} from 'remotion';
import {HANGUP, PHONE_THUD, S15, S16} from '../../marks.ts';
import {FPS, cue, local, scene, shot, type Cue} from '../../timeline.ts';
import {carToFrame, type CarCamera} from '../../set/CarInterior.tsx';
import {ritaAPoints, type RitaPose} from '../../char/Rita.tsx';
import type {P} from '../../char/rig.ts';

export const SCENE = 'RitaSaysHi';
export const FROM = scene(SCENE).from;
/** Absolute seconds → scene-local frame (snapped like every picture mark). */
export const lf = (sec: number) => local(SCENE, sec);
/** Scene-local frame → absolute seconds (continuous, for progress values). */
export const secOf = (frame: number) => (FROM + frame) / FPS;

export const S16_AT = shot('S16').from - FROM;
export const END_AT = shot('S16').to - FROM;

export const R11 = cue('R11');
export const R12 = cue('R12');
export const AI04 = cue('AI04');
export const R13 = cue('R13');

/** S16 picture marks (scene-local frames). HANG is cue('AI04').cut, the frame "they’ll" is chopped. */
export const HANG = lf(HANGUP);
export const LAND = lf(PHONE_THUD);
export const SETTLE = lf(S16.toss.end);
export const TURN = lf(S16.turn);

export const clamp = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;
export const c01 = (x: number) => Math.max(0, Math.min(1, x));
export const easeOut = Easing.out(Easing.cubic);
export const easeInOut = Easing.inOut(Easing.cubic);
export const sine = Easing.inOut(Easing.sin);

/** Eased ramp a→b between absolute seconds t0..t1. */
export const ramp = (sec: number, t0: number, t1: number, a: number, b: number, easing = easeInOut) =>
  interpolate(sec, [t0, t1], [a, b], {...clamp, easing});

/** Lip flap per measured word of a cue (0..amp), closed between words. */
export const mouthFor = (c: Cue, sec: number, amp = 0.3) => {
  for (const w of c.words) {
    if (w.end > w.start && sec >= w.start && sec <= w.end) {
      const u = (sec - w.start) / Math.max(0.05, w.end - w.start);
      const beats = w.end - w.start > 0.32 ? 2 : 1;
      return amp * Math.abs(Math.sin(Math.PI * u * beats)) ** 0.7;
    }
  }
  return 0;
};

/** 0..1 while a cue's (un-cut) words are sounding, shaped by the syllables: for light that breathes with a voice. */
export const voiceLevel = (c: Cue, sec: number) => {
  const on = c.words.some((w) => w.end > w.start && sec >= w.start - 0.04 && sec <= w.end + 0.04);
  return on ? 0.55 + 0.45 * mouthFor(c, sec, 1) : 0;
};

/** A 0→1→0 blink over `len` frames starting at local frame `at`. */
export const blinkAt = (frame: number, at: number, len = 4) =>
  interpolate(frame, [at, at + 1, at + len - 2, at + len], [0, 1, 1, 0], clamp);

/** A cabin camera that puts rest point p at frame point `to` at `scale` (about the cabin's (540, 960)). */
export const camOn = (p: P, scale: number, to: P, depth: number): CarCamera => ({
  scale,
  x: to[0] - 540 - (p[0] - 540) * scale,
  y: to[1] - 960 - (p[1] - 960) * scale,
  depth,
});

/** Rest px → frame px under a camera. */
export const toFrame = (p: P, cam: CarCamera): P => {
  const q = carToFrame({x: p[0], y: p[1]}, cam);
  return [q.x, q.y];
};

/** Rest-framing camera transform (same maths as the sets'), for drawing props in cabin units. */
export const camT = (c: CarCamera) => {
  const ox = c.ox ?? 540;
  const oy = c.oy ?? 960;
  return `translate(${ox + c.x} ${oy + c.y}) scale(${c.scale}) translate(${-ox} ${-oy})`;
};

/**
 * S15: the binoculars come down 120 frame px (board). Solve the rig's binocular value whose objectives sit
 * that far below their raised position at the S15 camera scale (the rig moves them on an arc, not linearly).
 */
export const binocularsFor = (dropFramePx: number, scale: number) => {
  const y = (b: number) => {
    const o = ritaAPoints({binoculars: b, phoneToEar: 1}).objectives;
    return (o[0][1] + o[1][1]) / 2;
  };
  const target = y(1) + dropFramePx / scale;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (y(mid) > target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
};

/** Points of a pose, for light spills that track her. */
export const points = (pose: RitaPose) => ritaAPoints(pose);

export {S15, S16, HANGUP, PHONE_THUD};
