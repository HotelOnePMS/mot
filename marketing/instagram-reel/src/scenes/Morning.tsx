// Morning 46.5–54.5: S21 dawn time-lapse in Rita's car (the night→light flip), S22 Gus at his desk and the push
// into his phone (HotelOne console, light), S23 over his shoulder: "Hi, Rita." with a mug raised to her sedan,
// S24 Mark done on Rita's row, S25 Sam's booking request: marker on the quoted total, Copy booking link, the toast,
// and the truthful line "Not booked yet: Gus confirms, sends the link, and Sam books." Captions are global (G01).
import React from 'react';
import {AbsoluteFill, Easing, interpolate, spring, useCurrentFrame} from 'remotion';
import type {SceneProps} from './types.ts';
import {FPS, f, scene} from '../timeline.ts';
import {S21, S22, S23, S24, S25} from '../marks.ts';
import {EASE_POP, FONT, INTER_FEATURES, LIGHT, NIGHT, COLUMN_X} from '../theme.ts';
import {CarInterior, PAD_ON_FLOOR, type CarCamera} from '../set/CarInterior.tsx';
import {RitaA} from '../char/Rita.tsx';
import {GUS_DESK, GusDesk, GusSilhouette, gusSilhouetteMug} from '../char/Gus.tsx';
import {Glint, mix, alpha} from '../set/parts.tsx';
import {NightLightWipe} from '../fx/Grade.tsx';
import {LAYOUT_SPRING} from '../hotelone/index.ts';
import {Office} from './morning/Office.tsx';
import {CSS_W, MorningPhone, MorningScreen, Thumb, morningRequests, phoneToFrame} from './morning/Phone.tsx';

const FROM = scene('Morning').from;
/** Absolute seconds -> scene-local frame. */
const L = (sec: number) => f(sec) - FROM;
const clamp = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;
const c01 = (x: number) => Math.max(0, Math.min(1, x));
const pop = Easing.bezier(...EASE_POP);
const inOut = Easing.inOut(Easing.cubic);

const CUT = {s22: L(48.0), s23: L(50.0), s24: L(51.0), s25: L(51.5), end: L(54.5)};

// ─── S21 · dawn time-lapse in the car ───────────────────────────────────────

const PAD_NOTES = {nights: 4, tonight: 1, fri: 1, price: 1, underline: 1, margin: 1};

const Cabin: React.FC<{dawn: number; cam: CarCamera; neon: number; clock: string; t: number}> = ({dawn, cam, neon, clock, t}) => {
  const car = {camera: cam, dawn, neon, clock, office: {clock, phoneState: 'dark' as const}, mirrorPulse: 0, pad: PAD_NOTES, padAt: PAD_ON_FLOOR};
  const rita = {camera: cam, t, asleep: 1, dawn};
  return (
    <AbsoluteFill>
      <CarInterior layer="back" {...car} />
      <RitaA layer="body" {...rita} />
      <CarInterior layer="front" {...car} />
      <RitaA layer="front" {...rita} />
    </AbsoluteFill>
  );
};

/** The Starlite sign: lit, then a 3-frame stutter off at 47.0, then dead for good. */
const neonAt = (frame: number) => {
  const k = frame - L(S21.signOff.t);
  if (k < 0) return 1;
  return [0.12, 0.85, 0.04][k] ?? 0;
};

const TimeLabel: React.FC<{frame: number}> = ({frame}) => {
  const a = pop(c01((frame - L(S21.label)) / 8));
  const c = inOut(c01((frame - L(47.1)) / (L(47.5) - L(47.1))));
  if (a <= 0) return null;
  return (
    <div style={{position: 'absolute', top: 300, left: 0, width: COLUMN_X * 2, display: 'flex', justifyContent: 'center', opacity: a, transform: `translateY(${(1 - a) * 12}px)`}}>
      <div
        style={{
          height: 80,
          padding: '0 34px',
          borderRadius: 40,
          display: 'flex',
          alignItems: 'center',
          background: mix(NIGHT.ink, LIGHT.background, c),
          boxShadow: `0 0 0 1.5px ${mix(alpha(NIGHT.ivory, 0.14), LIGHT.border, c)}, 0 10px 30px ${alpha(NIGHT.ink, 0.22 - 0.12 * c)}`,
          fontFamily: FONT.mono,
          fontWeight: 500,
          fontSize: 72,
          lineHeight: 1,
          letterSpacing: '-0.01em',
          color: mix(NIGHT.ivory, LIGHT.foreground, c),
        }}
      >
        6:52 AM
      </div>
    </div>
  );
};

const Dawn: React.FC<{frame: number}> = ({frame}) => {
  const t = (frame + FROM) / FPS;
  const p = inOut(interpolate(frame, [L(S21.grade.start), L(S21.grade.end)], [0, 1], clamp));
  // a 1.5% push over the shot, centred on Rita's head
  const k = frame / (CUT.s22 - 1);
  const cam: CarCamera = {scale: 1 + 0.015 * k, x: 0, y: 0, ox: 400, oy: 720, depth: 0.45};
  const neon = neonAt(frame);
  // the dash clock runs the time-lapse (5:40 → 6:52), then holds
  const mins = Math.round(340 + 72 * interpolate(frame, [0, L(S21.grade.end)], [0, 1], clamp));
  const clock = `${Math.floor(mins / 60)}:${String(mins % 60).padStart(2, '0')}`;
  const lift = interpolate(p, [0.55, 1], [0, 1], clamp);
  return (
    <AbsoluteFill style={{background: NIGHT.ink}}>
      {p <= 0 || p >= 1 ? (
        <Cabin dawn={p >= 1 ? 1 : 0} cam={cam} neon={neon} clock={clock} t={t} />
      ) : (
        <NightLightWipe
          progress={p}
          feather={520}
          night={<Cabin dawn={0.5 * p} cam={cam} neon={neon} clock={clock} t={t} />}
          day={<Cabin dawn={Math.min(1, 0.5 + 0.5 * p)} cam={cam} neon={neon} clock={clock} t={t} />}
        />
      )}
      {/* morning light fills the cabin from the windshield: the palette lands on the light tokens */}
      {lift > 0 ? (
        <AbsoluteFill
          style={{
            background: `radial-gradient(120% 80% at 80% 22%, ${alpha(LIGHT.background, 0.34)}, ${alpha(LIGHT.highlightSoft, 0.12)} 55%, ${alpha(LIGHT.highlightSoft, 0.04)})`,
            mixBlendMode: 'screen',
            opacity: lift,
          }}
        />
      ) : null}
      <TimeLabel frame={frame} />
    </AbsoluteFill>
  );
};

// ─── S22 · Gus at the desk, push into his phone ─────────────────────────────

/** Settled crop: the 380 CSS px console at an effective 3x (text-sm 42 px), screen left edge at x −30. */
const SETTLE = {zoom: 3, x: -30, y: -86};
const SCR = GUS_DESK.screen;
const S_END = (CSS_W * SETTLE.zoom) / SCR.w;
// the push is a pure zoom about the end transform's fixed point
const Q = {x: (SETTLE.x - S_END * SCR.x) / (1 - S_END), y: (SETTLE.y - S_END * SCR.y) / (1 - S_END)};
const S22_SCROLL = 125;

const Desk: React.FC<{frame: number}> = ({frame}) => {
  const t = (frame + FROM) / FPS;
  const k = Easing.bezier(...EASE_POP)(c01((frame - L(S22.push.start)) / (L(S22.push.end) - L(S22.push.start))));
  const S = Math.pow(S_END, k); // log-space zoom: an even push
  const cam = {scale: S, x: 0, y: 0, ox: Q.x, oy: Q.y};
  const off = {scale: S, x: Q.x * (1 - S), y: Q.y * (1 - S)};
  const SL = 1 + (S - 1) * 0.6;
  const lotCam = {scale: SL, x: Q.x * (1 - SL), y: Q.y * (1 - SL)};
  const mug = interpolate(frame, [L(S22.push.start), L(S22.push.end)], [1, 0.3], {...clamp, easing: inOut});
  const focus = interpolate(frame, [L(S22.focusRing), L(S22.focusRing) + 6], [0, 1], clamp);
  const drift = 1 + 0.01 * inOut(interpolate(frame, [L(S22.push.end), CUT.s23], [0, 1], clamp));
  const rect = {x: S * (SCR.x - Q.x) + Q.x, y: S * (SCR.y - Q.y) + Q.y, w: SCR.w * S};
  const zoomPx = CSS_W * SETTLE.zoom;
  const front = interpolate(S, [2.2, 3.2], [1, 0], clamp);
  return (
    <AbsoluteFill style={{background: LIGHT.accent, transform: `scale(${drift})`, transformOrigin: '505px 760px'}}>
      <Office open={{x: 140, y: 220, w: 860, h: 900}} lot={{scale: 0.62, x: 700, y: 268}} camera={off} lotCamera={lotCam} mullionX={570} desk={1330} t={t} clock="6:53" />
      <GusDesk layer="back" camera={cam} t={t} mugRaise={mug} smile={interpolate(frame, [L(49.0), L(49.3)], [0, 0.5], clamp)} />
      <div style={{position: 'absolute', left: 0, top: 0, transformOrigin: '0 0', transform: `translate(${rect.x}px, ${rect.y}px) scale(${rect.w / zoomPx})`}}>
        <MorningScreen zoom={SETTLE.zoom} radius={(SCR.r * zoomPx) / SCR.w} requests={morningRequests(false)} scroll={S22_SCROLL} fx={{rita: {focus}}} />
      </div>
      {front > 0 ? <GusDesk layer="front" camera={cam} t={t} mugRaise={mug} style={{opacity: front}} /> : null}
    </AbsoluteFill>
  );
};

// ─── S23 · over his shoulder: "Hi, Rita." ───────────────────────────────────

const SIL = {x: 905, y: 1430, scale: 1.4};

const Window: React.FC<{frame: number}> = ({frame}) => {
  const t = (frame + FROM) / FPS;
  const k = inOut(c01((frame - CUT.s23) / (CUT.s24 - CUT.s23)));
  const push = (amt: number) => {
    const s = 1 + amt * k;
    return {scale: s, x: 540 * (1 - s), y: 1000 * (1 - s)};
  };
  const raise = interpolate(frame, [L(S23.mug.start), L(S23.mug.end)], [0, 1], {...clamp, easing: Easing.out(Easing.cubic)});
  // the clink: the mug taps the glass on the cut (51.0), a 2-frame nudge forward
  const nudge = interpolate(frame, [CUT.s24 - 3, CUT.s24 - 1], [0, 1], clamp);
  const smile = interpolate(frame, [L(50.0), L(50.3)], [0.15, 0.7], clamp);
  const gp = push(0.022);
  const rim = gusSilhouetteMug(raise, SIL);
  const rimF = {x: gp.scale * (rim.x - 14 * nudge) + gp.x, y: gp.scale * (rim.y - 8 * nudge) + gp.y};
  return (
    <AbsoluteFill style={{background: LIGHT.background}}>
      <Office open={{x: 70, y: 170, w: 1100, h: 1440}} lot={{scale: 1, x: 0, y: 0}} camera={push(0.015)} lotCamera={push(0.006)} mullionX={668} transomY={560} blinds={88} t={t} />
      <AbsoluteFill style={{transformOrigin: '540px 1000px', transform: `scale(${gp.scale}) translate(${-14 * nudge}px, ${-8 * nudge}px)`}}>
        <GusSilhouette {...SIL} t={t} mugRaise={raise} smile={smile} light="dawn" face="left" />
      </AbsoluteFill>
      {nudge >= 1 ? (
        <svg width={1080} height={1920} style={{position: 'absolute', inset: 0}}>
          <g transform={`translate(${rimF.x - 70} ${rimF.y + 6})`}>
            <Glint size={34} amount={0.9} color={LIGHT.surface} />
          </g>
        </svg>
      ) : null}
    </AbsoluteFill>
  );
};

// ─── S24 · Mark done ────────────────────────────────────────────────────────

const P24 = {x: 60, y: 70, width: 960};
const S24_SCROLL = 172;
/** Rita's "Mark done" (console CSS px, measured on the 380 px layout at S24_SCROLL). */
const MARK_DONE = {x: 80, y: 274};

const MarkDone: React.FC<{frame: number}> = ({frame}) => {
  const tap = L(S24.tap);
  const press = interpolate(frame, [tap - 1, tap, tap + 1, tap + 3], [0, 1, 1, 0], clamp);
  const slide = interpolate(frame, [L(S24.slide.start), L(S24.slide.end)], [0, 1], {...clamp, easing: Easing.in(Easing.cubic)});
  const seg = spring({frame: frame - L(S24.segment), fps: FPS, config: LAYOUT_SPRING});
  const close = frame >= L(S24.close.start) ? spring({frame: frame - L(S24.close.start), fps: FPS, config: {damping: 16, stiffness: 300, mass: 0.6}, durationInFrames: L(S24.close.end) - L(S24.close.start)}) : 0;
  const updated = frame >= L(S24.segment);
  const tip = phoneToFrame(MARK_DONE, P24);
  // the thumb lands on the tap and pulls back down-right, out of the row's way
  const away = interpolate(frame, [CUT.s24, tap, tap + 1, tap + 7], [70, 0, 0, 820], {...clamp, easing: Easing.inOut(Easing.quad)});
  const ang = (-38 * Math.PI) / 180;
  return (
    <AbsoluteFill style={{background: LIGHT.background}}>
      <MorningPhone
        {...P24}
        requests={morningRequests(false)}
        scroll={S24_SCROLL}
        segment={{
          options: updated ? ['To handle · 1', 'Done · 1'] : ['To handle · 2', 'Done · 0'],
          value: 0,
          from: updated ? {options: ['To handle · 2', 'Done · 0'], progress: seg} : undefined,
        }}
        fx={{rita: {markDone: {pressed: press, hover: press}, x: -50 * slide, opacity: 1 - slide, collapse: close}}}
      />
      {away < 800 ? <Thumb tip={{x: tip.x - Math.sin(ang) * away, y: tip.y + Math.cos(ang) * away}} angle={-38} w={200} press={press} /> : null}
    </AbsoluteFill>
  );
};

// ─── S25 · Sam's request, the copy tap, the truthful line ───────────────────

const P25 = {x: 20, y: 380, width: 1040};
const S25_SCROLL = 236;
/** "Copy booking link" (console CSS px at S25_SCROLL). */
const COPY = {x: 104, y: 312};

const Headline: React.FC<{frame: number; at: number; top: number; children: React.ReactNode; plate?: boolean}> = ({frame, at, top, children, plate}) => {
  const a = pop(c01((frame - L(at)) / 9));
  if (a <= 0) return null;
  return (
    <div style={{position: 'absolute', top, left: 0, width: COLUMN_X * 2, display: 'flex', justifyContent: 'center', opacity: a, transform: `translateY(${(1 - a) * 18}px)`}}>
      <div
        style={{
          fontFamily: FONT.ui,
          fontFeatureSettings: INTER_FEATURES,
          fontWeight: 600,
          fontSize: plate ? 36 : 38,
          lineHeight: plate ? '43px' : '50px',
          letterSpacing: '-0.012em',
          color: LIGHT.foreground,
          textAlign: 'center',
          whiteSpace: 'nowrap',
          ...(plate
            ? {width: 820, boxSizing: 'border-box', background: LIGHT.background, padding: '50px 30px', borderRadius: 26, boxShadow: `0 0 0 1.5px ${LIGHT.border}, 0 18px 40px rgba(${LIGHT.shadow}, 0.16), 0 4px 10px rgba(${LIGHT.shadow}, 0.08)`}
            : {}),
        }}
      >
        {children}
      </div>
    </div>
  );
};

const Sam: React.FC<{frame: number}> = ({frame}) => {
  const marker = interpolate(frame, [L(S25.marker.start), L(S25.marker.end)], [0, 1], {...clamp, easing: inOut});
  const tap = L(S25.copyTap);
  const press = interpolate(frame, [tap - 1, tap, tap + 1, tap + 3], [0, 1, 1, 0], clamp);
  const toast = c01((frame - L(S25.toast)) / 12);
  const away = interpolate(frame, [tap - 8, tap, tap + 1, tap + 9], [520, 0, 0, 640], {...clamp, easing: Easing.inOut(Easing.quad)});
  const ang = (-30 * Math.PI) / 180;
  const tip = phoneToFrame(COPY, P25);
  const out = interpolate(frame, [L(S25.out.start), CUT.end - 1], [0, 1], {...clamp, easing: inOut});
  return (
    <AbsoluteFill style={{background: LIGHT.background}}>
      <AbsoluteFill style={{opacity: 1 - out, transform: `scale(${1 - 0.08 * out})`, transformOrigin: '540px 960px'}}>
        <MorningPhone
          {...P25}
          requests={morningRequests(true)}
          scroll={S25_SCROLL}
          segment={{options: ['To handle · 1', 'Done · 1'], value: 0}}
          fx={{sam: {total: {marker}, copy: {pressed: press}}}}
          toast={toast}
        />
        {away < 600 ? <Thumb tip={{x: tip.x - Math.sin(ang) * away, y: tip.y + Math.cos(ang) * away}} angle={-30} w={200} press={press} /> : null}
        <Headline frame={frame} at={S25.text1} top={290}>
          2:14 AM caller. Total already quoted.
        </Headline>
        <Headline frame={frame} at={S25.text2} top={1168} plate>
          Not booked yet: Gus confirms,
          <br />
          sends the link, and Sam books.
        </Headline>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/** Morning (S21, S22, S23, S24, S25). */
export const Morning: React.FC<SceneProps> = () => {
  const frame = useCurrentFrame();
  if (frame < CUT.s22) return <Dawn frame={frame} />;
  if (frame < CUT.s23) return <Desk frame={frame} />;
  if (frame < CUT.s24) return <Window frame={frame} />;
  if (frame < CUT.s25) return <MarkDone frame={frame} />;
  return <Sam frame={frame} />;
};
