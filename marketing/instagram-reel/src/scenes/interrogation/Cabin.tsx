// S11 and S13: rig A in the cabin.
//   S11 (20.5–24.0) Rita leans over the wheel, phone at her ear, pen hovering over the steno pad;
//       pen click 20.6, headlight on the dash 22.0, brows up on "We do.", "Fri 23" written on "Friday the twenty-third".
//   S13 (27.0–28.5) the trap: half-smile, sideways glance at camera, glasses glint on "cash?", then the
//       dive toward the phone's speaker at 28.35 (zoom ghosts as the radial blur) carrying into S14.
import React from 'react';
import {AbsoluteFill, Easing, interpolate} from 'remotion';
import {CarInterior, stenoPenTip, pushCamera, carToFrame, type CarCamera, type PadPlacement} from '../../set/CarInterior.tsx';
import {RitaA, padToRest, ritaAPoints, type RitaPose} from '../../char/Rita.tsx';
import {LensGlint} from '../../fx/LensGlint.tsx';
import {HEADLIGHT} from '../../fx/HeadlightSweep.tsx';
import {handheld} from '../../fx/noise.ts';
import {missedPulse} from '../../marks.ts';
import {NIGHT} from '../../theme.ts';
import type {P} from '../../char/rig.ts';
import {AI02, R09, R10, S11, S13, S13_AT, END_AT, blinkAt, c01, clamp, easeInOut, easeOut, lf, mouthFor, notesAt, secOf} from './common.ts';

/** Story time: same night as S07–S10 (the Starlite's LED clock read 2:21 when the AI picked up). */
const STORY_CLOCK = '2:21';
const OFFICE = {clock: STORY_CLOCK, phoneState: 'dark'} as const;

/** A cabin camera that puts rest point p at frame point `to` at `scale` (about the cabin's (540, 960)). */
const camOn = (p: P, scale: number, to: P, depth: number): CarCamera => ({
  scale,
  x: to[0] - 540 - (p[0] - 540) * scale,
  y: to[1] - 960 - (p[1] - 960) * scale,
  depth,
});

/** The four layers of a cabin shot in their draw order (car back, Rita body, car front, Rita front). */
const CabinLayers: React.FC<{camera: CarCamera; pose: RitaPose; sec: number; padAt?: PadPlacement; dashSweep?: number; opacity?: number; voice?: number}> = ({camera, pose, sec, padAt, dashSweep = 0, opacity = 1, voice = 0}) => {
  const style = opacity < 1 ? {opacity} : undefined;
  return (
    <AbsoluteFill style={style}>
      <CarInterior layer="back" camera={camera} clock={STORY_CLOCK} office={OFFICE} mirrorPulse={missedPulse(sec)} time={sec} dashSweep={dashSweep} />
      {dashSweep > 0 && dashSweep < 1 ? <DashGlare camera={camera} p={dashSweep} /> : null}
      <RitaA layer="body" camera={camera} {...pose} />
      {voice > 0 ? <VoiceSpill camera={camera} pose={pose} amount={voice} /> : null}
      <CarInterior layer="front" camera={camera} pad={notesAt(sec)} padAt={padAt} pen={false} time={sec} />
      <RitaA layer="front" camera={camera} {...pose} />
    </AbsoluteFill>
  );
};

const camT = (c: CarCamera) => {
  const ox = c.ox ?? 540;
  const oy = c.oy ?? 960;
  return `translate(${ox + c.x} ${oy + c.y}) scale(${c.scale}) translate(${-ox} ${-oy})`;
};

/**
 * S11 22.0: a passing car's headlight reflection sliding right → left along the dash top and, fainter, across the
 * windshield glass. Drawn behind Rita and the pad (rest px under the cabin camera), clipped to the set's own outlines.
 */
const DashGlare: React.FC<{camera: CarCamera; p: number}> = ({camera, p}) => {
  const env = Math.sin(Math.PI * p) ** 0.7;
  // right → left; centred on the visible strip of glass (rest x ≈ 680–870) at mid-sweep
  const x = 1150 - p * 700;
  return (
    <svg width={1080} height={1920} viewBox="0 0 1080 1920" style={{position: 'absolute', inset: 0, mixBlendMode: 'screen'}}>
      <defs>
        <clipPath id="int-dash-clip">
          <path d="M676 1062 L782 1056 L1400 1044 L1400 1150 L600 1172 Z" />
        </clipPath>
        <clipPath id="int-ws-clip">
          <path d="M650 226 Q1000 196 1400 190 L1400 1046 L782 1056 Z" />
        </clipPath>
        <linearGradient id="int-glare" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor={HEADLIGHT} stopOpacity={0} />
          <stop offset="0.5" stopColor={HEADLIGHT} stopOpacity={1} />
          <stop offset="1" stopColor={HEADLIGHT} stopOpacity={0} />
        </linearGradient>
      </defs>
      <g transform={camT(camera)}>
        <g clipPath="url(#int-dash-clip)">
          <rect x={x - 160} y={1000} width={320} height={200} fill="url(#int-glare)" opacity={0.5 * env} transform={`translate(${x} 1100) skewX(-40) translate(${-x} -1100)`} />
          <rect x={x - 40} y={1040} width={80} height={30} rx={15} fill={HEADLIGHT} opacity={0.55 * env} />
        </g>
        <g clipPath="url(#int-ws-clip)">
          <rect x={x - 260} y={150} width={520} height={950} fill="url(#int-glare)" opacity={0.2 * env} transform={`translate(${x} 620) skewX(-18) translate(${-x} -620)`} />
          <rect x={x - 70} y={150} width={140} height={950} fill="url(#int-glare)" opacity={0.42 * env} transform={`translate(${x} 620) skewX(-18) translate(${-x} -620)`} />
          <rect x={x + 90} y={150} width={36} height={950} fill="url(#int-glare)" opacity={0.3 * env} transform={`translate(${x} 620) skewX(-18) translate(${-x} -620)`} />
        </g>
      </g>
    </svg>
  );
};

/** While the AI talks, a breath of teal light leaks from the phone's screen edge onto her cheek (the voice is the product). */
const VoiceSpill: React.FC<{camera: CarCamera; pose: RitaPose; amount: number}> = ({camera, pose, amount}) => {
  const pts = ritaAPoints(pose);
  const a = (pts.phoneDeg * Math.PI) / 180;
  // the screen-side edge (+x in phone-local), upper half
  const lx = 30;
  const ly = -20;
  const at = carToFrame({x: pts.phone[0] + lx * Math.cos(a) - ly * Math.sin(a), y: pts.phone[1] + lx * Math.sin(a) + ly * Math.cos(a)}, camera);
  const r = 120 * camera.scale;
  return (
    <svg width={1080} height={1920} viewBox="0 0 1080 1920" style={{position: 'absolute', inset: 0, mixBlendMode: 'screen'}}>
      <defs>
        <radialGradient id="int-voice" cx={at.x} cy={at.y} r={r} gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={NIGHT.tealSoft} stopOpacity={0.5} />
          <stop offset="0.4" stopColor={NIGHT.teal} stopOpacity={0.18} />
          <stop offset="1" stopColor={NIGHT.teal} stopOpacity={0} />
        </radialGradient>
      </defs>
      <circle cx={at.x} cy={at.y} r={r} fill="url(#int-voice)" opacity={Math.min(1, amount)} />
    </svg>
  );
};

// ─── S11 · "Got a room Friday, for two?" ───────────────────────────────────

/**
 * The pad pulled in a little toward her as she leans (the cabin default sits further right): with the camera
 * below it lands at about x 440–850, y 960–1340 in frame, so the "Fri 23" row writes at y ≈ 1010 and the
 * tallies sit just above the caption band.
 */
const S11_PAD: PadPlacement = {x: 486, y: 928, w: 326, rotate: -5, squash: 0.68, shade: 0.5};
/** The push holds this rest point (between her face and the pad) still. */
const S11_FOCUS: P = [520, 880];
const S11_SCALE = 1.28;

export const S11Shot: React.FC<{frame: number; paid?: boolean}> = ({frame, paid = false}) => {
  const sec = secOf(frame);
  // 3% push across the shot (a hair of ease so the cut in and out both feel in motion)
  const k = interpolate(frame, [0, lf(S11.push.end)], [0, 1], {...clamp, easing: Easing.inOut(Easing.sin)});
  const hh = handheld(frame, 1.6, 0.45, 's11');
  const at: P = [482 + hh.x, (paid ? 772 : 888) + hh.y];
  const camera = camOn(S11_FOCUS, S11_SCALE * (1 + 0.03 * k), at, 0.22);

  // She is already leaning when we cut in, and settles the last few px over the wheel.
  const lean = interpolate(frame, [0, 16], [0.7, 1], {...clamp, easing: easeOut});

  // Pen: hovering over the top of the pad (the "F" of Fri), a click at 20.6 (a 2-frame dip), down to the paper at 23.4.
  const notes = notesAt(sec);
  const writing = (notes.fri ?? 0) > 0;
  const friStart = padToRest(stenoPenTip({nights: 4, tonight: 1, fri: 0.002}), S11_PAD);
  const tip = padToRest(stenoPenTip(notes), S11_PAD);
  const click = lf(S11.penClick);
  const clickDip = interpolate(frame, [click - 1, click, click + 1, click + 3], [0, 1, 0.4, 0], clamp);
  const writeAt = lf(S11.pen[0].t);
  const descend = interpolate(frame, [writeAt - 5, writeAt], [0, 1], {...clamp, easing: easeInOut});
  // a slow idle circle while hovering (she's thinking with the pen)
  const idle: P = [Math.sin(frame / 9) * 3, Math.cos(frame / 11) * 2];
  const hover: P = [friStart[0] + 4 + idle[0], friStart[1] - 13 + idle[1] + clickDip * 4];
  const penAt: P = writing ? tip : [hover[0] + (friStart[0] - hover[0]) * descend, hover[1] + (friStart[1] - hover[1]) * descend];

  // Face: interrogating. Slight squint throughout; brows lift on "We do."; eyes drop to the pad to write.
  const browAt = lf(S11.brows);
  const brow = interpolate(frame, [browAt, browAt + 5], [0, 0.55], {...clamp, easing: easeOut});
  const lookDown = interpolate(frame, [writeAt - 6, writeAt - 1], [0, 1], {...clamp, easing: easeInOut});
  const pose: RitaPose = {
    t: sec,
    lean,
    phoneToEar: 1,
    binoculars: 0,
    pen: 1,
    penAt,
    browRaise: brow,
    browAsym: 0.3,
    squint: 0.28 - 0.1 * (brow / 0.55),
    lookX: 0.35 + 0.25 * lookDown,
    lookY: 0.05 + 0.6 * lookDown,
    mouthOpen: mouthFor(R09, sec),
    blink: blinkAt(frame, lf(21.8)),
    grip: 0.25,
    light: 'night',
  };

  // 22.0: a headlight reflection slides across the dash (the cabin's own dash sweep plus a soft band on the dash only).
  const hl = lf(S11.headlight);
  const dash = interpolate(frame, [hl, hl + 16], [0, 1], {...clamp, easing: Easing.bezier(0.45, 0.05, 0.55, 0.95)});
  // the AI's voice in the phone band: a teal breath at the phone while it speaks
  const voice = AI02.words.some((w) => sec >= w.start - 0.05 && sec <= w.end + 0.05) ? 0.55 + 0.45 * mouthFor(AI02, sec, 1) : 0;

  return (
    <AbsoluteFill style={{background: NIGHT.ink}}>
      <CabinLayers camera={camera} pose={pose} sec={sec} padAt={S11_PAD} dashSweep={dash} voice={voice} />
    </AbsoluteFill>
  );
};

// ─── S13 · "Just a few hours, cash?" ───────────────────────────────────────

const FACE: P = [463, 757];
const S13_SCALE = 1.92;
/** Where the dive aims, phone-local px (long axis vertical, top at −y): the middle of the phone's back, above her fingers. */
const SPEAKER_LOCAL: P = [2, -22];

export const S13Shot: React.FC<{frame: number}> = ({frame}) => {
  const sec = secOf(frame);
  const f0 = frame - S13_AT;
  const n = END_AT - S13_AT;
  // slow 3% push
  const k = interpolate(f0, [0, n], [0, 1], clamp);
  const hh = handheld(frame, 1.2, 0.4, 's13');
  const base = camOn(FACE, S13_SCALE * (1 + 0.03 * k), [528 + hh.x, 742 + hh.y], 0.12);

  // The trap: the half-smile builds through "hours,", the eyes slide to camera before "cash?", the glint lands on it.
  const glintAt = lf(S13.glint.t);
  const smirk = interpolate(sec, [27.12, 27.55], [0.25, 0.85], {...clamp, easing: easeOut});
  const glanceAt = glintAt - 5;
  const glance = interpolate(frame, [glanceAt, glanceAt + 4], [0, 1], {...clamp, easing: easeInOut});
  const glint = c01((frame - glintAt + 0.5) / S13.glint.frames);
  const pose: RitaPose = {
    t: sec,
    phoneToEar: 1,
    binoculars: 0,
    smirk,
    browRaise: 0.18 + 0.22 * glance,
    browAsym: 0.15,
    squint: 0.35 * glance,
    lookX: 0.3 - 1.3 * glance,
    lookY: -0.05,
    headTilt: -2 * glance,
    mouthOpen: mouthFor(R10, sec, 0.26),
    grip: 0.4,
    glint,
    light: 'night',
  };

  // 28.35: the camera dives toward the phone's speaker (exponential whip, zoom ghosts as the radial blur).
  const pts = ritaAPoints(pose);
  const a = (pts.phoneDeg * Math.PI) / 180;
  const speakerRest = {x: pts.phone[0] + SPEAKER_LOCAL[0] * Math.cos(a) - SPEAKER_LOCAL[1] * Math.sin(a), y: pts.phone[1] + SPEAKER_LOCAL[0] * Math.sin(a) + SPEAKER_LOCAL[1] * Math.cos(a)};
  const speaker = carToFrame(speakerRest, base);
  const diveAt = lf(S13.dive);
  const dp = c01((frame - diveAt + 1) / (n - (diveAt - S13_AT) + 1));
  const zoom = dp > 0 ? Math.pow(9, Math.pow(dp, 1.15)) : 1;
  // the speaker glides toward the frame point where S14's grille opens (505, 880)
  const glide = interpolate(dp, [0, 1], [0, 1], {easing: Easing.in(Easing.quad)});
  const target = {x: speaker.x + (505 - speaker.x) * glide, y: speaker.y + (880 - speaker.y) * glide};
  const dive = (z: number): CarCamera => {
    const c = pushCamera(base, z, speaker.x, speaker.y);
    return {...c, x: c.x + (target.x - speaker.x), y: c.y + (target.y - speaker.y)};
  };
  const camera = dp > 0 ? dive(zoom) : base;

  const lens = carToFrame({x: pts.lensNear[0], y: pts.lensNear[1]}, camera);
  const glintPeak = glint > 0 && glint < 1 ? Math.sin(glint * Math.PI) : 0;

  return (
    <AbsoluteFill style={{background: NIGHT.ink}}>
      <CabinLayers camera={camera} pose={pose} sec={sec} />
      {dp > 0 ? (
        <>
          {/* zoom ghosts (where the frame was a moment ago): a cheap radial blur */}
          <CabinLayers camera={dive(zoom / 1.18)} pose={pose} sec={sec} opacity={0.26} />
          <CabinLayers camera={dive(zoom / 1.4)} pose={pose} sec={sec} opacity={0.16} />
        </>
      ) : null}
      {glintPeak > 0 ? <LensGlint x={lens.x + 10} y={lens.y - 8} size={46 * glintPeak + 14} intensity={glintPeak} rotate={-14} halo={NIGHT.tealSoft} /> : null}
      {dp > 0 ? <DiveGlow at={target} p={dp} /> : null}
    </AbsoluteFill>
  );
};

/** The voice leaking out of the speaker: a teal bloom at the dive point and the frame closing to ink around it (S14 opens on ink). */
const DiveGlow: React.FC<{at: {x: number; y: number}; p: number}> = ({at, p}) => {
  const r = 200 + 1000 * p;
  return (
    <svg width={1080} height={1920} viewBox="0 0 1080 1920" style={{position: 'absolute', inset: 0}}>
      <defs>
        <radialGradient id="int-dive-glow" cx={at.x} cy={at.y} r={r} gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={NIGHT.tealSoft} stopOpacity={0.55 * p} />
          <stop offset="0.35" stopColor={NIGHT.teal} stopOpacity={0.22 * p} />
          <stop offset="1" stopColor={NIGHT.teal} stopOpacity={0} />
        </radialGradient>
        <radialGradient id="int-dive-close" cx={at.x} cy={at.y} r={1400 - 800 * p} gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={NIGHT.ink} stopOpacity={0.35 * p} />
          <stop offset="0.3" stopColor={NIGHT.ink} stopOpacity={0.45 * p} />
          <stop offset="1" stopColor={NIGHT.ink} stopOpacity={Math.min(1, 1.3 * p)} />
        </radialGradient>
      </defs>
      <rect width={1080} height={1920} fill="url(#int-dive-close)" />
      <rect width={1080} height={1920} fill="url(#int-dive-glow)" style={{mixBlendMode: 'screen'}} />
    </svg>
  );
};
