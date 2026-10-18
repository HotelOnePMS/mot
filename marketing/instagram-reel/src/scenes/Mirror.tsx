// Mirror (S17, 37.0–38.5): the beat too long.
//   37.0      Rita, close in the lower-left foreground, settles back into her
//             seat with the thermos cup already rising; the rearview mirror
//             hangs above her (x 300–780, y 520–760) holding her own motel
//             across the road, reversed: the red arrow sign and a dark lobby
//             window with one small white glow.
//   37.1      the cup reaches her lips (sip + lid clink); her eyes close,
//             savouring it. "Rita missed one thing." rises (y 300–380).
//   37.0–38.5 slow push 100% → 240% (ease in-out) into the mirror, which
//             grows to fill y ≈ 420–1100. Rita is nearer the lens, so she
//             slides out of frame faster than the cabin (parallax); the
//             Starlite through the windshield barely moves (depth 0.1, dimmed).
//   37.5/38.5 the glow peaks (missedPulse, 1 Hz soft fade): a missed call, not a ring.
//   38.5      hard cut (S18).
// No one speaks in this shot, so nothing sits in the caption band by design.
import React from 'react';
import {AbsoluteFill, Easing, interpolate, useCurrentFrame} from 'remotion';
import {glintEnvelope, LensGlint} from '../fx/LensGlint.tsx';
import {RitaA, ritaAPoints, type RitaPose} from '../char/Rita.tsx';
import {S17, missedPulse} from '../marks.ts';
import {CAR, CarInterior, MIRROR_GLOW, carToFrame, mirrorCamera, pushCamera} from '../set/CarInterior.tsx';
import type {Crop} from '../set/Lobby.tsx';
import {useUid} from '../set/parts.tsx';
import {FPS, local, scene} from '../timeline.ts';
import {NIGHT} from '../theme.ts';
import {SteamCurl} from './mirror/SteamCurl.tsx';
import {MirrorTitle} from './mirror/Title.tsx';
import type {SceneProps} from './types.ts';

const SCENE = 'Mirror';
const FROM = scene(SCENE).from;
const lf = (sec: number) => local(SCENE, sec);
const clamp = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** The push: 100% → 240% over the whole shot, ease in-out, about a point that carries the mirror's centre from y 640 down to y ≈ 760. */
const PUSH = {from: 1, to: 2.4, fx: 540, fy: 556} as const;
const PUSH_EASE = Easing.bezier(0.45, 0, 0.55, 1);
/** Base framing: the mirror at frame x 300–780, y 520–760; the world outside nearly fixed (depth 0.1). */
const BASE = mirrorCamera(300, 520, 480, 0.1);

/** Rita's foreground plate: her mouth at this frame point and scale at 100%; she is nearer the lens, so her push is k^PARALLAX. */
const RITA_FG = {mouth: {x: 540, y: 1150}, scale: 1.3, parallax: 1.35, settle: {x: 26, y: -14}} as const;

/** The cup's rim relative to her near wrist (rest px) while the cup is at her lips. */
const CUP_RIM = {x: -6, y: -94} as const;

/** The missed-call glow in the mirror, in rest-framing px (the mirror hangs at CAR.mirror, scaled). */
const GLOW_REST = {x: CAR.mirror.x + MIRROR_GLOW.x * CAR.mirror.scale, y: CAR.mirror.y + MIRROR_GLOW.y * CAR.mirror.scale};

export const Mirror: React.FC<SceneProps> = () => {
  const frame = useCurrentFrame();
  const uid = useUid('mir');
  const sec = (FROM + frame) / FPS;
  const last = scene(SCENE).durationInFrames - 1;

  // camera
  const e = interpolate(frame, [0, last], [0, 1], {...clamp, easing: PUSH_EASE});
  const k = lerp(PUSH.from, PUSH.to, e);
  const camera = pushCamera(BASE, k, PUSH.fx, PUSH.fy);

  // Rita: settles back (0–9), the cup reaches her lips on the sip (37.1), eyes close a beat later
  const sipAt = lf(S17.sip);
  const settle = interpolate(frame, [0, 10], [0, 1], {...clamp, easing: Easing.out(Easing.cubic)});
  const sip = interpolate(frame, [0, sipAt + 1], [0.7, 1], {...clamp, easing: Easing.out(Easing.quad)});
  const blink = interpolate(frame, [sipAt + 2, sipAt + 8], [0, 0.88], {...clamp, easing: Easing.inOut(Easing.quad)});
  const pose: RitaPose = {
    t: sec,
    sip,
    blink,
    smirk: interpolate(frame, [sipAt + 4, sipAt + 12], [0.15, 0.55], clamp),
    headTilt: lerp(5, -3, settle),
    lookX: 0.4,
    browRaise: 0.1,
  };
  const pts = ritaAPoints(pose);
  const mouth = pts.mouth;
  const tx = RITA_FG.mouth.x + RITA_FG.settle.x * (1 - settle);
  const ty = RITA_FG.mouth.y + RITA_FG.settle.y * (1 - settle);
  const ritaBase: Crop = {scale: RITA_FG.scale, ox: 0, oy: 0, x: tx - RITA_FG.scale * mouth[0], y: ty - RITA_FG.scale * mouth[1]};
  const ritaCam = pushCamera(ritaBase, k ** RITA_FG.parallax, PUSH.fx, PUSH.fy);

  // the steam curl leaves the cup's rim (≈ 94 rest px above her wrist with the cup upright at her lips)
  const rim = {x: pts.nearHand[0] + CUP_RIM.x, y: pts.nearHand[1] + CUP_RIM.y};
  const steam = interpolate(frame, [0, sipAt + 2], [0.8, 1], clamp);
  // the lid clink: a 2-frame glint on the cup's steel lip, on the sip mark
  const clink = glintEnvelope(frame, sipAt, 2);
  const lip = carToFrame({x: rim.x + 15, y: rim.y + 2}, ritaCam);
  // as she slides out of frame toward the lens she falls out of the light (a cheap shallow-focus stand-in)
  const fgDark = interpolate(e, [0.12, 0.6], [0, 1], {...clamp, easing: Easing.inOut(Easing.quad)});

  // glow: missedPulse peaks at 37.5 and 38.5; a soft frame-space bloom helps it read at phone size
  const pulse = missedPulse(sec);
  const glow = carToFrame(GLOW_REST, camera);
  const mirrorPx = camera.scale * CAR.mirror.scale; // frame px per mirror unit
  const bloomR = 26 * mirrorPx;

  return (
    <AbsoluteFill style={{background: NIGHT.ink}}>
      <CarInterior layer="back" camera={camera} clock="2:14" office={{clock: '2:22'}} outsideDim={0.7} thermos={false} mirrorPulse={pulse} time={sec} />
      <svg width={1080} height={1920} viewBox="0 0 1080 1920" style={{position: 'absolute', inset: 0}}>
        <defs>
          <radialGradient id={`${uid}bloom`}>
            <stop offset="0" stopColor={NIGHT.phoneBloom} stopOpacity={0.55} />
            <stop offset="0.35" stopColor={NIGHT.phoneBloom} stopOpacity={0.16} />
            <stop offset="1" stopColor={NIGHT.phoneBloom} stopOpacity={0} />
          </radialGradient>
        </defs>
        <circle cx={glow.x} cy={glow.y} r={bloomR} fill={`url(#${uid}bloom)`} opacity={0.2 + 0.8 * pulse} />
      </svg>
      <RitaA layer="all" camera={ritaCam} {...pose} />
      <svg width={1080} height={1920} viewBox="0 0 1080 1920" style={{position: 'absolute', inset: 0}}>
        <g transform={`translate(${ritaCam.x} ${ritaCam.y}) scale(${ritaCam.scale})`}>
          <SteamCurl x={rim.x} y={rim.y} t={sec} amount={steam} />
        </g>
      </svg>
      <svg width={1080} height={1920} viewBox="0 0 1080 1920" style={{position: 'absolute', inset: 0}}>
        <defs>
          <linearGradient id={`${uid}floor`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={NIGHT.ink} stopOpacity={0} />
            <stop offset="1" stopColor={NIGHT.ink} stopOpacity={0.6} />
          </linearGradient>
          <linearGradient id={`${uid}fg`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={NIGHT.ink} stopOpacity={0} />
            <stop offset="0.45" stopColor={NIGHT.ink} stopOpacity={0.45} />
            <stop offset="1" stopColor={NIGHT.ink} stopOpacity={0.8} />
          </linearGradient>
        </defs>
        <rect x={0} y={1380} width={1080} height={540} fill={`url(#${uid}floor)`} />
        <rect x={0} y={1060} width={1080} height={860} fill={`url(#${uid}fg)`} opacity={fgDark} />
      </svg>
      <LensGlint x={lip.x} y={lip.y} size={26} intensity={clink * 0.9} rotate={12} />
      <MirrorTitle frame={frame} at={lf(S17.text)} />
    </AbsoluteFill>
  );
};
