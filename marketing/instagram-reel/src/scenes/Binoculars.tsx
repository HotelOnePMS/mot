// Binoculars (S02 3.0–5.5, S03 5.5–7.0): Rita's binocular POV from her car in
// the Starlite lot, through Gus's office plate glass.
//   S02: the counter's hero shot. Gus's FRONT DESK phone rings (chimes at
//        3.0/4.0/4.5/4.875), the giant counter jump-cuts 0:01 → 0:20, a felt
//        heartbeat throb on every jump; at 5.00 the screen snaps black in one
//        frame, the counter holds 0:20 in teal; 5.10 "Then it stops." rises.
//   S03: a tighter cut-in (r 440, where S04's objective lenses sit), the phone
//        dark, the empty chair, dust motes; a linear 100→104% push, a distant
//        car's light passing over the glass at 6.0, and from 6.6 an ease-in
//        zoom-out (1→0.9) that S04's dolly continues.
// Every time comes from marks.ts / timeline.ts. Captions are drawn globally.
import React from 'react';
import {AbsoluteFill, Easing, interpolate, useCurrentFrame} from 'remotion';
import type {SceneProps} from './types.ts';
import {BINO, Binoculars as BinocularPOV} from '../fx/Binoculars.tsx';
import {HeadlightSweep, sweepProgress} from '../fx/HeadlightSweep.tsx';
import {HOOK_ORIGIN, LOBBY, Lobby, SAM_NUMBER, buzzOffset, lobbyToFrame, type Crop} from '../set/Lobby.tsx';
import {Counter} from '../ui/Counter.tsx';
import {S02, S03, activeStep, framesSince} from '../marks.ts';
import {FPS, local, scene} from '../timeline.ts';
import {EASE_POP, FONT, INTER_FEATURES, NIGHT} from '../theme.ts';

const SCENE = 'Binoculars';
const FROM = scene(SCENE).from;
/** First local frame of S03 (the cut-in). */
const S03_AT = local(SCENE, 5.5);
const popEase = Easing.bezier(...EASE_POP);
const clamp = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;

/** Same hands across the cut: one handheld seed for the whole scene. */
const HAND_SEED = 'rita-binoculars';

/**
 * Extra zoom `k` about a FRAME point, folded into a Lobby crop (keeps the SVG
 * crisp: no CSS scale on the rasterised layer).
 */
const zoomAbout = (c: Crop, k: number, at: {x: number; y: number}): Crop => {
  const ox = c.ox ?? HOOK_ORIGIN.x;
  const oy = c.oy ?? HOOK_ORIGIN.y;
  return {scale: c.scale * k, x: at.x - ox + k * (ox + c.x - at.x), y: at.y - oy + k * (oy + c.y - at.y), ox, oy};
};

// ─── Framing ────────────────────────────────────────────────────────────────

/** S02: the phone at x 450–560, y 820–1050 (board) = the set at 0.56, nudged down. */
const S02_CROP: Crop = {scale: 0.56, x: 0, y: 23};
/** S03: tighter (×1.43): the dark phone centre-left, the empty chair in the right lens; the counter edge at y ≈ 945 tucks the
 *  OFFICE HOURS card on the counter front under the "Then it stops." plate, then reveals it above the caption band at 6.0. */
const S03_CROP: Crop = {scale: 0.8, x: -40, y: -130};
/** The dolly centre S04 continues: midway between S03's two lenses. */
const LENS_MID = {x: (BINO.S03.centers[0].x + BINO.S03.centers[1].x) / 2, y: BINO.S03.centers[0].y};

// ─── Small pieces ───────────────────────────────────────────────────────────

/** "Across the Street · Ep. 1": the series bug, top-left on the black. */
const SeriesBug: React.FC = () => (
  <div
    style={{
      position: 'absolute',
      left: 90,
      top: 300,
      height: 36,
      lineHeight: '36px',
      fontFamily: FONT.ui,
      fontFeatureSettings: INTER_FEATURES,
      fontWeight: 500,
      fontSize: 26,
      letterSpacing: '0.005em',
      color: NIGHT.grey,
      whiteSpace: 'nowrap',
    }}
  >
    Across the Street · Ep. 1
  </div>
);

/** "Then it stops." on an ink plate: rises out of a mask over 12 frames, fades at 6.0. */
const ThenItStops: React.FC<{frame: number; top: number}> = ({frame, top}) => {
  const since = framesSince(frame, S02.thenItStops.t, SCENE);
  if (since < 0) return null;
  const rise = interpolate(since, [0, S02.thenItStops.frames], [1, 0], {...clamp, easing: popEase});
  const plateIn = interpolate(since, [0, 5], [0, 1], {...clamp, easing: Easing.out(Easing.quad)});
  const out = interpolate(framesSince(frame, S03.thenItStopsOut, SCENE), [0, 6], [1, 0], {...clamp, easing: Easing.in(Easing.quad)});
  if (out <= 0) return null;
  const LH = 70;
  return (
    <div style={{position: 'absolute', left: 105, width: 800, top: top - 12, display: 'flex', justifyContent: 'center', opacity: out}}>
      <div
        style={{
          position: 'relative',
          padding: '12px 30px',
          borderRadius: 14,
          background: `rgba(7, 9, 13, ${(0.74 * plateIn).toFixed(3)})`,
          boxShadow: `0 10px 40px rgba(0, 0, 0, ${(0.35 * plateIn).toFixed(3)})`,
          transform: `scaleX(${(0.94 + 0.06 * plateIn).toFixed(4)})`,
        }}
      >
        <div style={{height: LH, overflow: 'hidden'}}>
          <div
            style={{
              fontFamily: FONT.ui,
              fontFeatureSettings: INTER_FEATURES,
              fontWeight: 600,
              fontSize: 60,
              lineHeight: `${LH}px`,
              letterSpacing: '-0.015em',
              color: NIGHT.ivory,
              whiteSpace: 'nowrap',
              transform: `translateY(${(rise * LH * 1.05).toFixed(2)}px)`,
              opacity: interpolate(since, [0, 4], [0.2, 1], clamp),
            }}
          >
            Then it stops.
          </div>
        </div>
      </div>
    </div>
  );
};

/** Gus's chime envelope at an absolute second (1 on the hit, decaying; cut dead at 5.00). */
const chimeEnv = (sec: number): number => {
  let env = 0;
  for (const c of S02.chimes) {
    const d = sec - c;
    if (d >= 0 && d < 0.5 && sec < S02.chimeCut) env = Math.max(env, 1 - 0.55 * (d / 0.5));
  }
  return env;
};

/** The felt heartbeat: a tiny image throb on every counter jump before 0:20 (decays over ~5 frames). */
const throb = (frame: number): number => {
  let k = 0;
  for (const t of S02.heartbeat) {
    const since = framesSince(frame, t, SCENE);
    if (since >= 0 && since < 8) k = Math.max(k, Math.exp(-since / 2.2));
  }
  return k;
};

// ─── Shots ──────────────────────────────────────────────────────────────────

const S02Shot: React.FC<{frame: number; placement: SceneProps['placement']}> = ({frame, placement}) => {
  const sec = (FROM + frame) / FPS;
  const stopped = framesSince(frame, S02.stop, SCENE) >= 0;
  const env = stopped ? 0 : chimeEnv(sec);
  const screenAt = lobbyToFrame(LOBBY.screenCenter, S02_CROP);
  const crop = zoomAbout(S02_CROP, 1 + 0.009 * throb(frame), screenAt);
  const step = activeStep(S02.counter, frame, SCENE);
  const textTop = placement === 'paid' ? 1130 : 1080;
  return (
    <BinocularPOV
      centers={BINO.S02.centers}
      r={BINO.S02.r}
      feather={18}
      rim="redCyan"
      drift={2.5}
      driftHz={0.6}
      seed={HAND_SEED}
      streaks={0.12}
      streakColor={NIGHT.teal}
      overlay={
        <>
          <SeriesBug />
          {step ? (
            <div style={{position: 'absolute', left: 105, width: 800, top: 370, display: 'flex', justifyContent: 'center'}}>
              <Counter
                value={step.step.label}
                label="RINGING"
                since={step.since}
                variant={step.step.label === '0:20' ? 'teal' : 'ivory'}
                size={200}
                labelSize={30}
                gap={14}
              />
            </div>
          ) : null}
          <ThenItStops frame={frame} top={textTop} />
        </>
      }
    >
      <Lobby
        tint="teal"
        crop={crop}
        phoneState={stopped ? 'dark' : 'ringing'}
        screenNumber={SAM_NUMBER}
        ringPulse={env}
        buzz={buzzOffset(frame, env, 4)}
      />
    </BinocularPOV>
  );
};

const S03Shot: React.FC<{frame: number; placement: SceneProps['placement']}> = ({frame, placement}) => {
  const sec = (FROM + frame) / FPS;
  // 100→104% linear over the whole shot, about the dark phone
  const push = interpolate(sec, [S03.push.start, S03.push.end], [1, 1.04], clamp);
  // from 6.6 the image falls away (1→0.9), accelerating into S04's ease-out dolly
  const out = interpolate(sec, [S03.zoomOut.start, S03.zoomOut.end], [1, 0.9], {...clamp, easing: Easing.in(Easing.quad)});
  const phoneAt = lobbyToFrame(LOBBY.screenCenter, S03_CROP);
  const crop = zoomAbout(zoomAbout(S03_CROP, push, phoneAt), out, LENS_MID);
  // one distant car passes behind Rita at 6.0: its light slides L→R over Gus's glass
  const carFrom = local(SCENE, S03.carPass);
  const car = sweepProgress(frame, carFrom, 26);
  const textTop = placement === 'paid' ? 1130 : 1080;
  return (
    <BinocularPOV
      centers={BINO.S03.centers}
      r={BINO.S03.r}
      feather={18}
      rim="redCyan"
      drift={2.5}
      driftHz={0.6}
      seed={HAND_SEED}
      streaks={0.1}
      streakColor={NIGHT.teal}
      overlay={
        <>
          <SeriesBug />
          <ThenItStops frame={frame} top={textTop} />
        </>
      }
    >
      <Lobby tint="teal" crop={crop} phoneState="dark" screenNumber={SAM_NUMBER} dust={sec} />
      <HeadlightSweep progress={car} direction="ltr" angle={-14} width={70} bloom={300} intensity={0.34} y={840} />
    </BinocularPOV>
  );
};

/** Binoculars (S02, S03). */
export const Binoculars: React.FC<SceneProps> = ({placement}) => {
  const frame = useCurrentFrame();
  return <AbsoluteFill style={{background: '#000'}}>{frame < S03_AT ? <S02Shot frame={frame} placement={placement} /> : <S03Shot frame={frame} placement={placement} />}</AbsoluteFill>;
};
