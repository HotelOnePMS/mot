// Stakeout (S04, 7.0–9.0): the match-cut out of Rita's binocular POV.
//   7.0      frame 0 = S03's two circles, now the objective lenses of her
//            binoculars (teal lobby reflection, rims, the black surround).
//   7.0–7.8  dolly-out 180% → 100% (ease-out) through the lenses; the lens
//            discs settle onto the real objectives by ~7.55 and hand over to
//            the rig's own lens art; the surround opens on the car.
//   7.45     "Rita." rises from a mask; "Rita’s Motor Inn" follows.
//   8.1–8.7  her far hand stroke-draws tonight's fifth circled "20s".
//   9.0      hard cut.
// Breathing (±2 px at 0.25 Hz) comes from the rig's `t`. Lip movement follows
// R04's measured words. The 1 Hz missed-call glow pulses in the mirror.
// Captions are drawn globally (R04 in the band y 1200–1300).
import React from 'react';
import {AbsoluteFill, Easing, interpolate, useCurrentFrame} from 'remotion';
import type {SceneProps} from './types.ts';
import {CarInterior, stenoPenTip, type CarCamera} from '../set/CarInterior.tsx';
import {RitaA, padToRest, ritaAPoints, type RitaPose} from '../char/Rita.tsx';
import {LOBBY, LobbyArt, SAM_NUMBER, cropTransform, lobbyToFrame, HOOK_ORIGIN, type Crop} from '../set/Lobby.tsx';
import {BINO} from '../fx/Binoculars.tsx';
import {handheld} from '../fx/noise.ts';
import {S04, missedPulse} from '../marks.ts';
import {FPS, cue, f, local, scene} from '../timeline.ts';
import {NIGHT} from '../theme.ts';
import {LensMatchCut, type LensDisc} from './stakeout/LensMatchCut.tsx';
import {StakeoutTitle} from './stakeout/Title.tsx';

const SCENE = 'Stakeout';
const FROM = scene(SCENE).from;
const clamp = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;
const lf = (sec: number) => local(SCENE, sec);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// ─── Continuity with S03 (Binoculars) ───────────────────────────────────────
// S03's last frame: the teal lobby at S03_CROP, pushed 1.04 about the phone,
// then zoomed out 0.9 about the lens midpoint; the same handheld seed.
// (Mirrors src/scenes/Binoculars.tsx; it does not export these.)
const S03_CROP: Crop = {scale: 0.8, x: -40, y: -130};
const LENS_MID = {x: (BINO.S03.centers[0].x + BINO.S03.centers[1].x) / 2, y: BINO.S03.centers[0].y};
const HAND_SEED = 'rita-binoculars';
const zoomAbout = (c: Crop, k: number, at: {x: number; y: number}): Crop => {
  const ox = c.ox ?? HOOK_ORIGIN.x;
  const oy = c.oy ?? HOOK_ORIGIN.y;
  return {scale: c.scale * k, x: at.x - ox + k * (ox + c.x - at.x), y: at.y - oy + k * (oy + c.y - at.y), ox, oy};
};
const S03_END: Crop = zoomAbout(zoomAbout(S03_CROP, 1.04, lobbyToFrame(LOBBY.screenCenter, S03_CROP)), 0.9, LENS_MID);
const BINO_FROM = scene('Binoculars').from;

// ─── Timing ─────────────────────────────────────────────────────────────────
/** The lens discs land on the real objectives a little before the dolly settles. */
const LENS_LAND = 7.6;
/** Lens morph: a slow start that continues S03's accelerating zoom-out, a fast fall-away, a soft landing. */
const LENS_EASE = Easing.bezier(0.42, 0, 0.2, 1);
/**
 * Rest framing, 70 px left of the cabin's identity camera: the set's dash clock
 * ("2:14", the clue) sits at x 904–1016, under the IG right rail; this brings it
 * to x ≈ 834–946 and Rita to x ≈ 110–570.
 */
const REST_X = -70;
const TITLE_IN = 7.45;
const PEN = S04.pen[0];
const R04 = cue('R04');

/** Binocular objective geometry in the rig (Rita.tsx BinocularsArt at 0.95): lens rx 12 / ry 38 per barrel scale. */
const OBJ = {rx: 12 * 0.95, ry: 38 * 0.95, far: 0.92};
const LOCAL_NEAR = [179 * 0.95, 1 * 0.95];
const LOCAL_FAR = [(48 + 178 * 0.92) * 0.95, (-10 + 0.92) * 0.95];
const LOCAL_DEG = (Math.atan2(LOCAL_FAR[1] - LOCAL_NEAR[1], LOCAL_FAR[0] - LOCAL_NEAR[0]) * 180) / Math.PI;

/** Lips: a soft open/close per measured word of R04. */
const mouthAt = (sec: number) => {
  for (const w of R04.words) {
    if (sec >= w.start && sec <= w.end) {
      const k = (sec - w.start) / Math.max(0.05, w.end - w.start);
      return 0.42 * Math.sin(Math.PI * k) ** 0.7;
    }
  }
  return 0;
};

const frameOf = (p: readonly [number, number], c: Crop) => {
  const ox = c.ox ?? 540;
  const oy = c.oy ?? 960;
  return {x: ox + (p[0] - ox) * c.scale + c.x, y: oy + (p[1] - oy) * c.scale + c.y};
};

const poseAt = (frame: number): RitaPose => {
  const sec = (FROM + frame) / FPS;
  const write = interpolate(frame, [lf(PEN.t), lf(PEN.t + PEN.dur)], [0, 1], clamp);
  // pen poised above the pad, touches down at 8.1, lifts after 8.7
  const lift = frame < lf(PEN.t)
    ? interpolate(frame, [lf(7.85), lf(PEN.t)], [16, 0], {...clamp, easing: Easing.inOut(Easing.cubic)})
    : interpolate(frame, [lf(PEN.t + PEN.dur), lf(PEN.t + PEN.dur) + 5], [0, 12], {...clamp, easing: Easing.out(Easing.cubic)});
  const tip = padToRest(stenoPenTip({tonight: Math.max(0.0005, write)}));
  return {
    t: sec,
    binoculars: 1,
    binocularHand: 'near',
    pen: 1,
    penAt: [tip[0] + lift * 0.3, tip[1] - lift],
    squint: 0.3,
    browRaise: interpolate(sec, [R04.words[2]?.start ?? 8.05, (R04.words[2]?.start ?? 8.05) + 0.25], [0.05, 0.35], clamp),
    mouthOpen: mouthAt(sec),
  };
};

export const Stakeout: React.FC<SceneProps> = () => {
  const frame = useCurrentFrame();
  const sec = (FROM + frame) / FPS;
  const pose = poseAt(frame);

  // camera: 180% → 100%, ease-out, the objectives travelling from S03's lens midpoint to their rest place
  const eCam = interpolate(frame, [lf(S04.dolly.start), lf(S04.dolly.end)], [0, 1], {...clamp, easing: Easing.out(Easing.quad)});
  const mid0 = (() => {
    const o = ritaAPoints(poseAt(0)).objectives;
    return {x: (o[0][0] + o[1][0]) / 2, y: (o[0][1] + o[1][1]) / 2};
  })();
  const camera: CarCamera = {scale: lerp(1.8, 1, eCam), ox: mid0.x, oy: mid0.y, x: lerp(LENS_MID.x - mid0.x, REST_X, eCam), y: (1 - eCam) * (LENS_MID.y - mid0.y)};

  // the lens discs: S03's circles → the binocular objectives under the moving camera
  const eLens = interpolate(frame, [lf(S04.dolly.start), lf(LENS_LAND)], [0, 1], {...clamp, easing: LENS_EASE});
  const obj = ritaAPoints(pose).objectives.map((p) => frameOf(p, camera));
  const deg = (Math.atan2(obj[1].y - obj[0].y, obj[1].x - obj[0].x) * 180) / Math.PI - LOCAL_DEG;
  const binoFrame = f(sec) - BINO_FROM;
  const hm = handheld(binoFrame, 2.5, 0.6, HAND_SEED);
  const him = handheld(binoFrame, 2.5 * 1.6, 0.6, `${HAND_SEED}-img`);
  // a zoom: radii shrink geometrically, centres converge in step with the scale
  const r0 = BINO.S03.r;
  const kEnd = (OBJ.ry * camera.scale) / r0;
  const kNow = kEnd ** eLens;
  const w = (1 - kNow) / (1 - kEnd);
  const drift = 1 - w;
  const discs = BINO.S03.centers.map((c, i): LensDisc => {
    const bs = i === 0 ? 1 : OBJ.far;
    return {
      cx: lerp(c.x + hm.x * drift, obj[i].x, w),
      cy: lerp(c.y + hm.y * drift, obj[i].y, w),
      rx: r0 * ((OBJ.rx * bs * camera.scale) / r0) ** eLens,
      ry: r0 * ((OBJ.ry * bs * camera.scale) / r0) ** eLens,
      rot: deg * w,
    };
  }) as [LensDisc, LensDisc];
  // the reflection recedes with the lenses (continuing S03's zoom-out)
  const midNow = {x: (discs[0].cx + discs[1].cx) / 2, y: (discs[0].cy + discs[1].cy) / 2};
  const imgT = `translate(${(midNow.x + (hm.x + him.x) * drift).toFixed(2)} ${(midNow.y + (hm.y + him.y) * drift).toFixed(2)}) rotate(${(him.rot * drift).toFixed(3)}) scale(${kNow.toFixed(4)}) translate(${-LENS_MID.x} ${-LENS_MID.y})`;
  const lensOpacity = interpolate(eLens, [0.76, 0.98], [1, 0], {...clamp, easing: Easing.in(Easing.quad)});
  // S03's black holds while the lenses recede, then the car comes up round them
  const dark = interpolate(eLens, [0, 0.3, 0.85], [1, 0.92, 0], {...clamp, easing: Easing.inOut(Easing.quad)});
  const rim = interpolate(frame, [0, 5], [0.3, 1], {...clamp, easing: Easing.out(Easing.quad)});

  return (
    <AbsoluteFill style={{background: NIGHT.ink}}>
      <CarInterior layer="back" camera={camera} clock="2:14" mirrorPulse={missedPulse(sec)} time={sec} />
      <RitaA layer="body" camera={camera} {...pose} />
      <CarInterior layer="front" camera={camera} pad={{nights: 4, tonight: interpolate(frame, [lf(PEN.t), lf(PEN.t + PEN.dur)], [0, 1], clamp)}} time={sec} />
      <RitaA layer="front" camera={camera} {...pose} />
      <LensMatchCut discs={discs} dark={dark} opacity={lensOpacity} rim={rim} streaks={0.1 * (1 - eLens)} streakDx={him.x * 0.5}>
        <svg width={1080} height={1920} viewBox="0 0 1080 1920" style={{position: 'absolute', inset: 0}}>
          <rect width={1080} height={1920} fill={NIGHT.ink} />
          <g transform={imgT}>
            <g transform={cropTransform(S03_END)}>
              <LobbyArt tint="teal" phoneState="dark" screenNumber={SAM_NUMBER} dust={sec} />
            </g>
          </g>
        </svg>
      </LensMatchCut>
      <StakeoutTitle frame={frame} at={lf(TITLE_IN)} />
    </AbsoluteFill>
  );
};
