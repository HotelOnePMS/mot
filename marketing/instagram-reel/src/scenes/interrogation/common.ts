// Shared timing helpers for the Interrogation scene (S11–S13, 20.5–28.5).
// Every time comes from marks.ts / timeline.ts (measured voice), never the board's literal numbers.
import {Easing, interpolate} from 'remotion';
import {S11, S12, S13} from '../../marks.ts';
import {FPS, cue, local, scene, shot, type Cue} from '../../timeline.ts';
import type {StenoNotes} from '../../set/CarInterior.tsx';

export const SCENE = 'Interrogation';
export const FROM = scene(SCENE).from;
/** Absolute seconds → scene-local frame (snapped like every picture mark). */
export const lf = (sec: number) => local(SCENE, sec);
/** Scene-local frame → absolute seconds (continuous, for progress values). */
export const secOf = (frame: number) => (FROM + frame) / FPS;

export const S12_AT = shot('S12').from - FROM;
export const S13_AT = shot('S13').from - FROM;
export const END_AT = shot('S13').to - FROM;

export const clamp = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;
export const c01 = (x: number) => Math.max(0, Math.min(1, x));

/** 0..1 progress of a stroke list (contiguous strokes), from absolute seconds. */
export const strokeProgress = (strokes: readonly {t: number; dur: number}[], sec: number) => {
  const a = strokes[0].t;
  const last = strokes[strokes.length - 1];
  return c01((sec - a) / (last.t + last.dur - a));
};

/**
 * Notes on the pad at a moment. The progress values are nudged off the exact
 * stroke boundaries (a fraction of a pen-width), so stenoPenTip() always finds
 * the stroke in hand and never snaps back to an older note on a boundary frame.
 */
const nudge = (p: number) => (p <= 0 || p >= 1 ? p : Math.min(0.9995, p + 0.0015));
export const notesAt = (sec: number): StenoNotes => ({
  nights: 4,
  tonight: 1,
  fri: nudge(strokeProgress(S11.pen, sec)),
  price: nudge(strokeProgress(S12.price, sec)),
  underline: nudge(strokeProgress(S12.underline, sec)),
  margin: nudge(strokeProgress(S12.margin, sec)),
});

/** Lip flap per measured word of a cue (0..amp), quiet between words. */
export const mouthFor = (c: Cue, sec: number, amp = 0.32) => {
  for (const w of c.words) {
    if (sec >= w.start && sec <= w.end) {
      const u = (sec - w.start) / Math.max(0.05, w.end - w.start);
      // two syllable-ish beats on longer words
      const beats = w.end - w.start > 0.32 ? 2 : 1;
      return amp * Math.abs(Math.sin(Math.PI * u * beats)) ** 0.7;
    }
  }
  return 0;
};

export const R09 = cue('R09');
export const AI02 = cue('AI02');
export const R10 = cue('R10');

/** A 0→1→0 blink over 4 frames starting at local frame `at`. */
export const blinkAt = (frame: number, at: number) => interpolate(frame, [at, at + 1, at + 2, at + 4], [0, 1, 1, 0], clamp);

/** Ease helpers. */
export const easeOut = Easing.out(Easing.cubic);
export const easeInOut = Easing.inOut(Easing.cubic);

export {S11, S12, S13};
