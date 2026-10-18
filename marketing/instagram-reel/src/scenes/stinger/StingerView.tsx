// Stinger (S27, 60.0–62.5): GUS'S binocular POV from the Starlite, across the
// highway at RITA'S MOTOR INN. Roles reversed: her red arrow sign top-left in
// the left lens, her red-lit office in the notch between the lenses, her FRONT
// DESK phone glowing white on the counter. Teal rim fringe, a calm 1 px drift.
//   60.0   "0:17" (counter jump-cuts 0:17 → 0:18 → 0:19, then freezes)
//   60.05–60.4  "Next night · 2:13 AM" types on in 16ths, then holds
//   61.0   the muffled trill: the phone glow pulses and the phone buzzes
//   62.5   no fade-out: the hard cut to frame 0 IS the loop
// Every time comes from marks.ts / timeline.ts. Captions (G02) are drawn globally.
import React from 'react';
import {Easing, interpolate} from 'remotion';
import {Binoculars} from '../../fx/Binoculars.tsx';
import {perlin1} from '../../fx/noise.ts';
import {facadeLobbyPoint, Highway, type HighwayCamera} from '../../set/Highway.tsx';
import {buzzOffset, LOBBY} from '../../set/Lobby.tsx';
import {alpha} from '../../set/parts.tsx';
import {Counter} from '../../ui/Counter.tsx';
import {S27, activeStep, framesSince} from '../../marks.ts';
import {BEAT, FPS, scene} from '../../timeline.ts';
import {COLUMN_X, FONT, NIGHT} from '../../theme.ts';

export const STINGER_SCENE = 'Stinger';
const FROM = scene(STINGER_SCENE).from;
const clamp = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;

// ─── Framing ────────────────────────────────────────────────────────────────

/** Gus's lenses: a touch larger than Rita's S02 pair and set lower, so the counter sits in the notch above them. */
export const BINO_S27 = {r: 420, centers: [{x: 322, y: 950}, {x: 688, y: 950}]} as const;

/** Her phone screen in facade units (the shared Lobby set seen through her plate glass). */
const PHONE = facadeLobbyPoint(LOBBY.screenCenter);
/** Where the phone sits in frame: on the column, just under the lenses' centre line (S02 mirror: x ≈ 505). */
const PHONE_AT = {x: COLUMN_X + 12, y: 1040};
/** Facade scale: wide enough for the arrow sign top-left AND the office window; a slow 0.73 → 0.765 push about the phone. */
const SCALE = {from: 0.73, to: 0.765};

/** Highway camera at a stinger-local frame (extends before 0 so the S26 iris sees the same move). */
export const stingerCamera = (frame: number): HighwayCamera => {
  const k = interpolate(frame, [0, 75], [SCALE.from, SCALE.to], {extrapolateLeft: 'extend', extrapolateRight: 'clamp'});
  return {scale: k, x: PHONE_AT.x - 540 - k * (PHONE.x - 540), y: PHONE_AT.y - 960 - k * (PHONE.y - 960)};
};

// ─── Phone pulse ────────────────────────────────────────────────────────────

/**
 * Ring envelope for the phone across the highway (absolute seconds): a mid-level glow
 * the whole time ("mid-glow" on the last frame), the 61.0 trill pulse (hold, then a
 * 0.1 s release, like every trill), a soft tail, and a slight lean toward the next
 * trill at 62.5 (frame 0's full-level attack).
 */
export const stingerRing = (sec: number): {env: number; after: number; glow: number; since: number} => {
  const [trill] = S27.buzz;
  const d = sec - trill.start;
  const env = d >= 0 && sec < trill.end ? interpolate(d, [0, 0.03, trill.end - trill.start - 0.1, trill.end - trill.start], [0.6, 1, 1, 0], clamp) : 0;
  const tail = d >= trill.end - trill.start ? Math.exp(-(sec - trill.end) / 0.35) * 0.35 : 0;
  const lean = interpolate(sec, [S27.cicadasOnly, S27.loop], [0, 0.25], {...clamp, easing: Easing.in(Easing.quad)});
  const after = tail + lean;
  return {env, after, glow: Math.min(1, 0.3 + 0.7 * env + after), since: Math.max(0, Math.round(d * FPS))};
};

// ─── Text ───────────────────────────────────────────────────────────────────

const LABEL = 'Next night · 2:13 AM';
/** Type-on steps (end index into LABEL), one per 16th across S27.label: "Next" / "night ·" / "2:13" / "AM". */
const LABEL_STEPS = [4, 12, 17, 20];
const LABEL_SIZE = 44;
/** JetBrains Mono advance (0.6 em) + 0.02 em tracking. */
const LABEL_W = LABEL.length * LABEL_SIZE * 0.62;

/** "Next night · 2:13 AM": mono 500 44 px ivory in y 290–340, typed on in 16ths with a block cursor that then blinks on the beat. */
const NextNight: React.FC<{frame: number}> = ({frame}) => {
  const {start, end} = S27.label;
  const step = (end - start) / (LABEL_STEPS.length - 1);
  let shown = 0;
  let lastAt = -1;
  LABEL_STEPS.forEach((n, i) => {
    const since = framesSince(frame, start + i * step, STINGER_SCENE);
    if (since >= 0) {
      shown = n;
      lastAt = since;
    }
  });
  if (shown === 0) return null;
  const typing = shown < LABEL.length;
  const sinceEnd = framesSince(frame, end, STINGER_SCENE);
  // cursor: solid while typing, then blinks on the 120 BPM grid (on for the first half of each beat), softer
  const blinkOn = typing || ((sinceEnd + BEAT) % BEAT) < BEAT / 2;
  const cursorOpacity = typing ? 0.95 : blinkOn ? 0.55 : 0;
  return (
    <div
      style={{
        position: 'absolute',
        left: Math.round(COLUMN_X - LABEL_W / 2),
        top: 290,
        height: 50,
        width: LABEL_W + 40,
        fontFamily: FONT.mono,
        fontWeight: 500,
        fontSize: LABEL_SIZE,
        lineHeight: '50px',
        letterSpacing: '0.02em',
        color: NIGHT.ivory,
        whiteSpace: 'pre',
        textShadow: `0 0 18px ${alpha(NIGHT.ivory, 0.18)}`,
      }}
    >
      {LABEL.split('').map((ch, i) => (
        <span key={i} style={{opacity: i < shown ? (i >= shown - 4 && lastAt === 0 ? 0.75 : 1) : 0}}>
          {ch}
        </span>
      ))}
      {cursorOpacity > 0 ? (
        <span
          style={{
            position: 'absolute',
            left: Math.min(shown, LABEL.length) * LABEL_SIZE * 0.62 + (typing ? 0 : 10),
            top: 9,
            width: Math.round(LABEL_SIZE * 0.5),
            height: 34,
            background: NIGHT.ivory,
            opacity: cursorOpacity,
          }}
        />
      ) : null}
    </div>
  );
};

/** The counter (label "RINGING" mono 26 #fa9e9e in y 380–410, value mono 500 140 px ivory from y ≈ 430), jump-cut with the 2-frame pop. */
const StingerCounter: React.FC<{frame: number}> = ({frame}) => {
  const step = activeStep(S27.counter, frame, STINGER_SCENE);
  if (!step) return null;
  return (
    <div style={{position: 'absolute', left: COLUMN_X - 400, width: 800, top: 382, display: 'flex', justifyContent: 'center'}}>
      <Counter value={step.step.label} label="RINGING" since={step.since} variant="ivory" size={140} labelSize={26} labelColor={NIGHT.redSoft} gap={22} glow={0.8} />
    </div>
  );
};

// ─── View ───────────────────────────────────────────────────────────────────

export type StingerViewProps = {
  /** Stinger-local frame (0 = 60.0 s). Negative frames are valid: the S26 keyhole iris (59.75–60.0) shows this view through the keyhole. */
  frame: number;
  /** Draw the label and counter (off for a clean plate inside the iris). Default true. */
  text?: boolean;
};

/** Gus's binocular POV of Rita's Motor Inn, at a stinger-local frame. Full-frame. */
export const StingerView: React.FC<StingerViewProps> = ({frame, text = true}) => {
  const sec = (FROM + frame) / FPS;
  const cam = stingerCamera(frame);
  const ring = stingerRing(sec);
  // the phone in frame px (for the bloom), following the camera
  const px = 540 + cam.x + cam.scale * (PHONE.x - 540);
  const py = 960 + cam.y + cam.scale * (PHONE.y - 960);
  // her neon hums (never dips: this is the steady recurrence)
  const neon = 0.95 + 0.05 * perlin1('s27-neon', sec * 7);
  const bloomR = 120 + 40 * ring.env;
  return (
    <Binoculars
      centers={BINO_S27.centers}
      r={BINO_S27.r}
      feather={18}
      rim="teal"
      drift={1}
      driftHz={0.45}
      imageDrift={1.2}
      seed="gus-binoculars"
      frame={frame}
      streaks={0.09}
      streakColor={NIGHT.teal}
      overlay={
        text ? (
          <>
            <NextNight frame={frame} />
            <StingerCounter frame={frame} />
          </>
        ) : null
      }
    >
      <Highway
        variant="facade"
        camera={cam}
        ritaNeon={neon}
        lobby={{phoneState: 'ringing', ringPulse: ring.env, buzz: buzzOffset(ring.since, ring.env, 6)}}
      />
      {/* the phone's white glow carrying across the highway: pre-blurred radial bloom, pulsing with the trill */}
      <svg width={1080} height={1920} viewBox="0 0 1080 1920" style={{position: 'absolute', inset: 0, mixBlendMode: 'screen'}}>
        <defs>
          <radialGradient id="s27-bloom">
            <stop offset="0" stopColor={NIGHT.phoneBloom} stopOpacity={0.55} />
            <stop offset="0.35" stopColor={NIGHT.phoneBloom} stopOpacity={0.2} />
            <stop offset="1" stopColor={NIGHT.phoneBloom} stopOpacity={0} />
          </radialGradient>
          <radialGradient id="s27-spill">
            <stop offset="0" stopColor={NIGHT.phoneGlow} stopOpacity={0.35} />
            <stop offset="1" stopColor={NIGHT.phoneGlow} stopOpacity={0} />
          </radialGradient>
        </defs>
        {/* the trill lights the whole office for a beat */}
        <ellipse cx={px} cy={py + 20} rx={300 * cam.scale + 60} ry={190} fill="url(#s27-bloom)" opacity={0.06 + 0.45 * ring.env + 0.35 * ring.after} />
        <ellipse cx={px} cy={py} rx={bloomR} ry={bloomR * 1.25} fill="url(#s27-bloom)" opacity={0.2 + 0.75 * ring.glow} />
        {/* light spill on the counter top under the cradle */}
        <ellipse cx={px} cy={py + 92 * cam.scale} rx={150} ry={22} fill="url(#s27-spill)" opacity={0.3 + 0.6 * ring.env} />
      </svg>
    </Binoculars>
  );
};
