// TheCall (S06 11.0–12.5, S07 12.5–15.5).
//   S06: macro on Rita's own phone in her left hand: the generic dark contact
//        card "Starlite — front desk", her right thumb (cardigan cuff) hovering
//        over the green Call button during "Neither can I." (a 2% push). 12.0
//        the thumb taps: ripple + a 2-frame flip to "Calling… 00:00"; 12.25 the
//        phone whips up toward her ear (directional motion blur). Cut at 12.5.
//   S07: horizontal split screen with a 10 px ink seam at y 955–965. Top: the
//        binocular POV on the Starlite's empty teal lobby, Gus's FRONT DESK
//        phone lit and ringing (chimes 12.5/13.5/14.5) with Rita's number on it.
//        Bottom: Rita in profile (rig B) on the call, from the passenger seat.
//        On the seam: "RINGING" over the giant jump-cut counter 0:04 → 0:20.
//        13.0 a truck's headlight bar sweeps R→L across both halves (6-frame
//        ±6 px shake); 14.5 her knuckles tighten; 15.375 Gus's screen snaps
//        dark, 2-frame flinch into the 15.48 click; hard cut at 15.5.
// Every time comes from marks.ts / timeline.ts. Captions are drawn globally.
import React from 'react';
import {AbsoluteFill, Easing, interpolate, useCurrentFrame} from 'remotion';
import type {SceneProps} from './types.ts';
import {BINO, Binoculars as BinocularPOV} from '../fx/Binoculars.tsx';
import {HeadlightSweep, sweepProgress} from '../fx/HeadlightSweep.tsx';
import {perlin1} from '../fx/noise.ts';
import {HOOK_ORIGIN, LOBBY, Lobby, RITA_NUMBER, buzzOffset, lobbyToFrame, type Crop} from '../set/Lobby.tsx';
import {useUid} from '../set/parts.tsx';
import {RitaBArt} from '../char/Rita.tsx';
import {GenericPhone, phoneHeight, phonePoint} from '../ui/GenericPhone.tsx';
import {Counter} from '../ui/Counter.tsx';
import {S06, S07, activeStep, framesSince} from '../marks.ts';
import {FPS, cue, local, scene} from '../timeline.ts';
import {NIGHT} from '../theme.ts';
import {LeftFingertips, LeftHandFront, RightHand} from './thecall/Hands.tsx';
import {CabLight, ProfileCabBack, ProfileCabFront, S06Backdrop} from './thecall/Backdrops.tsx';

const SCENE = 'TheCall';
const FROM = scene(SCENE).from;
const L = (sec: number) => local(SCENE, sec);
/** First local frame of S07 (the split screen). */
const S07_AT = L(12.5);
const clamp = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// ─── S06 geometry ───────────────────────────────────────────────────────────

/** Rita's phone: the screen lands at x 260–760, y 560+ (board), body #1b1f27. */
const PHONE_W = 526;
const PHONE_H = phoneHeight(PHONE_W);
const PHONE_X = 247;
const PHONE_Y = 547;
const PHONE_C = {x: PHONE_X + PHONE_W / 2, y: PHONE_Y + PHONE_H / 2};
const CALL_PT = {x: PHONE_X + phonePoint('call', PHONE_W).x, y: PHONE_Y + phonePoint('call', PHONE_W).y};
/** The right thumb points up-left; its pad sits 40 px behind the tip along the axis. */
const THUMB_DEG = -35;
const AX = {x: -Math.sin((THUMB_DEG * Math.PI) / 180), y: Math.cos((THUMB_DEG * Math.PI) / 180)};
const PAD = 40;
const CONTACT_TIP = {x: CALL_PT.x - AX.x * PAD, y: CALL_PT.y - AX.y * PAD};

const TAP = L(S06.tap);
const WHIP0 = L(S06.whip.start);
const WHIP1 = L(S06.whip.end);

const whipAt = (fr: number) => interpolate(fr, [WHIP0, WHIP1], [0, 1], {...clamp, easing: Easing.in(Easing.cubic)});

const S06Shot: React.FC<{frame: number}> = ({frame}) => {
  const fid = useUid('whip');
  const sec = (FROM + frame) / FPS;
  // 11.0–12.0: a 2% push on the call button, then held
  const push = interpolate(frame, [0, TAP], [1, 1.02], {...clamp, easing: Easing.inOut(Easing.sin)});
  const pushT = `translate(${CALL_PT.x}px, ${CALL_PT.y}px) scale(${push}) translate(${-CALL_PT.x}px, ${-CALL_PT.y}px)`;

  // ── the right thumb: drifts in, hovers, a small lift, strikes on 12.0, lets go and drops away
  const approach = interpolate(frame, [0, 24], [1, 0], {...clamp, easing: Easing.out(Easing.cubic)});
  const strike = interpolate(frame, [TAP - 3, TAP], [0, 1], {...clamp, easing: Easing.in(Easing.quad)});
  const lift = interpolate(frame, [TAP - 7, TAP - 3, TAP], [0, 1, 0], clamp);
  const release = interpolate(frame, [TAP + 2, WHIP0 + 2], [0, 1], {...clamp, easing: Easing.in(Easing.cubic)});
  const still = 1 - strike;
  const dx = 5 * perlin1('s06-thumb-x', sec * 0.9) * still;
  const dy = 4 * perlin1('s06-thumb-y', sec * 0.9) * still;
  const hover = {x: CONTACT_TIP.x + 26 + 46 * approach + dx, y: CONTACT_TIP.y + 38 + 80 * approach + dy};
  const tip = {
    x: lerp(hover.x, CONTACT_TIP.x, strike) + 8 * lift + 320 * release,
    y: lerp(hover.y, CONTACT_TIP.y, strike) + 12 * lift + 560 * release,
  };
  const thumbScale = 1 + 0.02 * lift - 0.035 * strike + 0.1 * release;
  const height = Math.min(1, 1 - strike + release + 0.4 * lift);
  const pad = {x: tip.x + AX.x * PAD, y: tip.y + AX.y * PAD};

  // ── the phone: press, ripple, 2-frame flip to Calling…
  const press = interpolate(frame, [TAP - 1, TAP, TAP + 3], [0, 1, 0], clamp);
  const ripple = interpolate(frame, [TAP, TAP + 12], [0, 1], {...clamp, easing: Easing.out(Easing.quad)});
  const calling = interpolate(frame, [TAP, TAP + 2], [0, 1], clamp);
  const flash = frame === TAP + 1 ? 0.12 : 0;
  const tap = ripple > 0 && ripple < 1 ? {at: 'call' as const, progress: ripple} : undefined;

  // ── 12.25–12.5: the whip up to her ear (the camera tilts with it)
  const e = whipAt(frame);
  const v = whipAt(frame) - whipAt(frame - 0.6); // displacement over a 0.6-frame shutter
  const WHIP_Y = 2300;
  const blurY = Math.min(220, WHIP_Y * v * 0.45);
  const whipT = `translate(${(-170 * e).toFixed(2)}px, ${(-WHIP_Y * e).toFixed(2)}px) rotate(${(-16 * e).toFixed(3)}deg) scale(${(1 + 0.12 * e).toFixed(4)})`;
  const bgShift = 300 * e;
  const bgBlur = Math.min(60, 300 * v * 0.5);

  return (
    <AbsoluteFill style={{background: NIGHT.ink, overflow: 'hidden'}}>
      <svg width={0} height={0} style={{position: 'absolute'}} aria-hidden>
        <defs>
          <filter id={`${fid}p`} x="-20%" y="-60%" width="140%" height="220%" colorInterpolationFilters="sRGB">
            <feGaussianBlur stdDeviation={`${(blurY * 0.12).toFixed(2)} ${blurY.toFixed(2)}`} />
          </filter>
          <filter id={`${fid}b`} x="-10%" y="-20%" width="120%" height="140%" colorInterpolationFilters="sRGB">
            <feGaussianBlur stdDeviation={`0 ${bgBlur.toFixed(2)}`} />
          </filter>
        </defs>
      </svg>
      {/* background: the car beyond her hands, out of focus */}
      <svg width={1080} height={1920} viewBox="0 0 1080 1920" style={{position: 'absolute', inset: 0}}>
        <g
          transform={`translate(${CALL_PT.x} ${CALL_PT.y + bgShift}) scale(${1 + (push - 1) * 0.5}) translate(${-CALL_PT.x} ${-CALL_PT.y})`}
          filter={bgBlur > 0.5 ? `url(#${fid}b)` : undefined}
        >
          <S06Backdrop center={PHONE_C} halo={1 - e} />
        </g>
      </svg>
      {/* the phone in her left hand (whips away as one piece) */}
      <AbsoluteFill style={{transform: pushT, transformOrigin: '0 0'}}>
        <AbsoluteFill
          style={{
            transform: whipT,
            transformOrigin: `${PHONE_C.x}px ${PHONE_C.y}px`,
            filter: blurY > 0.5 ? `url(#${fid}p)` : undefined,
          }}
        >
          <svg width={1080} height={1920} viewBox="0 0 1080 1920" style={{position: 'absolute', inset: 0, overflow: 'visible'}}>
            <g transform={`translate(${PHONE_X} ${PHONE_Y})`}>
              <LeftFingertips />
            </g>
          </svg>
          <div style={{position: 'absolute', left: PHONE_X, top: PHONE_Y}}>
            <GenericPhone width={PHONE_W} screen="contact" name="Starlite — front desk" initials="S" avatarColor={NIGHT.teal} time="2:21" press={press} tap={calling < 1 ? tap : undefined} rim={NIGHT.teal} rimAmount={0.85} />
          </div>
          {calling > 0 ? (
            <div style={{position: 'absolute', left: PHONE_X, top: PHONE_Y, opacity: calling}}>
              <GenericPhone width={PHONE_W} screen="calling" name="Starlite — front desk" status="Calling…" elapsed={0} initials="S" avatarColor={NIGHT.teal} time="2:21" tap={tap} rim={NIGHT.teal} rimAmount={0.85} />
            </div>
          ) : null}
          {flash > 0 ? (
            <div style={{position: 'absolute', left: PHONE_X + 13, top: PHONE_Y + 13, width: PHONE_W - 26, height: PHONE_H - 26, borderRadius: 66, background: NIGHT.ivory, opacity: flash}} />
          ) : null}
          <svg width={1080} height={1920} viewBox="0 0 1080 1920" style={{position: 'absolute', inset: 0, overflow: 'visible'}}>
            {/* the hovering thumb's soft shadow on the glass (tightens as it lands) */}
            {release < 1 ? (
              <ThumbShadow x={pad.x - 16 * height} y={pad.y + 26 * height} spread={height} fade={1 - release} />
            ) : null}
            <g transform={`translate(${PHONE_X} ${PHONE_Y})`}>
              <LeftHandFront glow={1 - e} />
            </g>
          </svg>
        </AbsoluteFill>
      </AbsoluteFill>
      {/* the right thumb */}
      {release < 1 ? (
        <AbsoluteFill style={{transform: pushT, transformOrigin: '0 0'}}>
          <svg width={1080} height={1920} viewBox="0 0 1080 1920" style={{position: 'absolute', inset: 0, overflow: 'visible'}}>
            <RightHand tip={[tip.x, tip.y]} deg={THUMB_DEG} scale={thumbScale} glow={1 - 0.4 * release} />
          </svg>
        </AbsoluteFill>
      ) : null}
    </AbsoluteFill>
  );
};

/** Soft occlusion of the hovering thumb on the screen. */
const ThumbShadow: React.FC<{x: number; y: number; spread: number; fade: number}> = ({x, y, spread, fade}) => {
  const id = useUid('tsh');
  const rx = 62 + 34 * spread;
  const ry = 84 + 40 * spread;
  return (
    <g>
      <defs>
        <radialGradient id={id} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor={NIGHT.ink} stopOpacity={1} />
          <stop offset="0.55" stopColor={NIGHT.ink} stopOpacity={0.5} />
          <stop offset="1" stopColor={NIGHT.ink} stopOpacity={0} />
        </radialGradient>
      </defs>
      <ellipse cx={x} cy={y} rx={rx} ry={ry} transform={`rotate(${THUMB_DEG} ${x} ${y})`} fill={`url(#${id})`} opacity={(0.5 - 0.22 * spread) * fade} />
    </g>
  );
};

// ─── S07 geometry ───────────────────────────────────────────────────────────

const SEAM = {top: 955, bottom: 965};
/** Gus's phone centred between the two lenses at ~(505, 592), the set at 0.56 like S02. */
const S07_CROP: Crop = {scale: 0.56, x: 0, y: -312};
/** Rita (rig B): neck pivot and scale that put her head at y 1320–1520, phone 1330–1480, shoulder at the 1540 edge. */
const RITA = {x: 470, y: 1528, scale: 0.68};
/** The bottom half's 3% push centre (her head). */
const BOTTOM_PUSH_AT = {x: 505, y: 1420};
/** 6-frame ±6 px camera shake for the truck. */
const SHAKE: ReadonlyArray<readonly [number, number]> = [
  [6, -3],
  [-5, 4],
  [4, -3],
  [-3, 2],
  [2, -1],
  [-1, 0],
];

/** Extra zoom k about a frame point, folded into a Lobby crop (keeps the SVG crisp). */
const zoomAbout = (c: Crop, k: number, at: {x: number; y: number}): Crop => {
  const ox = c.ox ?? HOOK_ORIGIN.x;
  const oy = c.oy ?? HOOK_ORIGIN.y;
  return {scale: c.scale * k, x: at.x - ox + k * (ox + c.x - at.x), y: at.y - oy + k * (oy + c.y - at.y), ox, oy};
};

/** Gus's glass-muffled chime envelope at an absolute second (1 on each hit, decaying over 0.5 s). */
const chimeEnv = (sec: number): number => {
  let env = 0;
  for (const c of S07.chimes) {
    const d = sec - c;
    if (d >= 0 && d < 0.6) env = Math.max(env, 1 - d / 0.6);
  }
  return env;
};

/** The heartbeat under the riser, felt as a tiny image throb (quarters → 8ths → 16ths). */
const throb = (frame: number): number => {
  let k = 0;
  for (const t of S07.heartbeat) {
    const since = framesSince(frame, t, SCENE);
    if (since >= 0 && since < 6) k = Math.max(k, Math.exp(-since / 1.6));
  }
  return k;
};

/** Talk flaps on R07's measured words. */
const R07_WORDS = cue('R07').words;
const mouthAt = (sec: number): number => {
  for (const w of R07_WORDS) {
    if (sec >= w.start && sec < w.end) return 0.85 * Math.sin((Math.PI * (sec - w.start)) / (w.end - w.start));
  }
  return 0;
};

/** One 3-frame blink at a local frame. */
const blinkAt = (frame: number, at: number) => interpolate(frame, [at, at + 1, at + 3], [0, 1, 0], clamp);

const S07Shot: React.FC<{frame: number}> = ({frame}) => {
  const sec = (FROM + frame) / FPS;
  const dark = framesSince(frame, S07.screenOff, SCENE) >= 0;

  // camera: a 3% push on both halves, the truck's shake
  const push = interpolate(sec, [12.5, 15.5], [1, 1.03], clamp);
  const sh = framesSince(frame, S07.truck.t, SCENE);
  const [shx, shy] = sh >= 0 && sh < S07.truck.frames ? SHAKE[sh] : [0, 0];
  const truck = sweepProgress(frame, L(S07.truck.t - 0.25), 15);

  // top: Gus's phone lights up on the first chime, rings, snaps dark at 0:20
  const lightUp = interpolate(frame, [S07_AT, S07_AT + 2], [0.55, 1], clamp);
  const env = dark ? 0 : chimeEnv(sec);
  const phoneAt = lobbyToFrame(LOBBY.screenCenter, S07_CROP);
  const crop = zoomAbout(S07_CROP, push * (1 + 0.008 * throb(frame)), phoneAt);

  // bottom: Rita on the call
  const grip = interpolate(framesSince(frame, S07.knuckles, SCENE), [0, 4], [0, 1], {...clamp, easing: Easing.out(Easing.cubic)});
  const fl = framesSince(frame, S07.flinch.t, SCENE);
  const jolt = fl === 0 ? {x: -4, y: -3} : fl === 1 ? {x: -2, y: -1} : {x: 0, y: 0};
  const brow = interpolate(sec, [cue('R07').words[3].start - 0.1, cue('R07').words[3].start + 0.15], [0, 0.35], clamp) + (fl >= 0 ? 0.3 : 0);
  const blink = Math.max(blinkAt(frame, L(13.2)), blinkAt(frame, L(14.62)), fl >= 0 ? 0.55 : 0);
  const bpush = `translate(${BOTTOM_PUSH_AT.x + shx} ${BOTTOM_PUSH_AT.y + shy}) scale(${push}) translate(${-BOTTOM_PUSH_AT.x} ${-BOTTOM_PUSH_AT.y})`;

  // the counter on the seam: 0:04 → 0:20 (0:20 lands in Gus's teal, as in S02)
  const step = activeStep(S07.counter, frame, SCENE);

  return (
    <AbsoluteFill style={{background: NIGHT.ink, overflow: 'hidden'}}>
      {/* TOP: the binocular POV on Gus's lobby */}
      <div style={{position: 'absolute', left: 0, top: 0, width: 1080, height: SEAM.top, overflow: 'hidden'}}>
        <AbsoluteFill style={{transform: `translate(${shx}px, ${shy}px)`}}>
          <BinocularPOV centers={BINO.S07.centers} r={BINO.S07.r} feather={18} rim="redCyan" drift={1.6} driftHz={0.6} seed="rita-thecall" streaks={0.1} streakColor={NIGHT.teal}>
            <Lobby
              tint="teal"
              crop={crop}
              phoneState={dark ? 'dark' : 'ringing'}
              screenNumber={RITA_NUMBER}
              clock="2:21"
              ringPulse={env}
              buzz={buzzOffset(frame, env, 3)}
              screen={dark ? 1 : lightUp}
              dust={sec}
            />
            <HeadlightSweep progress={truck} direction="rtl" angle={-10} width={90} bloom={200} intensity={0.5} y={600} />
          </BinocularPOV>
        </AbsoluteFill>
      </div>
      {/* BOTTOM: Rita in the car, phone to her ear */}
      <div style={{position: 'absolute', left: 0, top: SEAM.bottom, width: 1080, height: 1920 - SEAM.bottom, overflow: 'hidden'}}>
        <div style={{position: 'absolute', left: 0, top: -SEAM.bottom, width: 1080, height: 1920}}>
          <svg width={1080} height={1920} viewBox="0 0 1080 1920" style={{position: 'absolute', inset: 0}}>
            <g transform={bpush}>
              <ProfileCabBack gusPhone={dark ? 0 : lightUp} ring={env} t={sec} />
              <g transform={`translate(${RITA.x + jolt.x} ${RITA.y + jolt.y}) scale(${RITA.scale})`}>
                <RitaBArt grip={grip} blink={blink} browRaise={Math.min(1, brow)} mouthOpen={mouthAt(sec)} t={sec} light={1} />
              </g>
              <ProfileCabFront />
              <CabLight />
            </g>
          </svg>
          <HeadlightSweep progress={truck} direction="rtl" angle={-8} width={110} bloom={200} intensity={0.75} y={1400} />
        </div>
      </div>
      {/* the seam */}
      <div style={{position: 'absolute', left: 0, top: SEAM.top, width: 1080, height: SEAM.bottom - SEAM.top, background: NIGHT.ink}} />
      {/* RINGING (y 804–830) over the counter pill (y 856–1064), centred on x 505 */}
      {step ? (
        <div style={{position: 'absolute', left: 105, width: 800, top: 804, display: 'flex', justifyContent: 'center'}}>
          <Counter
            value={step.step.label}
            label="RINGING"
            since={step.since}
            variant={step.step.label === '0:20' ? 'teal' : 'ivory'}
            size={180}
            labelSize={26}
            gap={26}
            pill
            style={{textShadow: `0 2px 12px ${NIGHT.ink}, 0 0 4px ${NIGHT.ink}`}}
          />
        </div>
      ) : null}
    </AbsoluteFill>
  );
};

/** TheCall (S06, S07). */
export const TheCall: React.FC<SceneProps> = () => {
  const frame = useCurrentFrame();
  return <AbsoluteFill style={{background: NIGHT.ink}}>{frame < S07_AT ? <S06Shot frame={frame} /> : <S07Shot frame={frame} />}</AbsoluteFill>;
};
