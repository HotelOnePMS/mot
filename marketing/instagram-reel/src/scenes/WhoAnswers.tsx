// WhoAnswers (S08 15.5–17.5, S09 17.5–18.5, S10 18.5–20.5): the pickup.
//   S08  hard cut to one tight binocular circle (r 470, centre (505, 800), teal
//        fringe, drift 1 px) on the Starlite counter: Gus's phone dark in its
//        cradle, the chair empty, the key rack still; only dust moves. A linear
//        100→110% push about the dark phone. At 16.0 “Nobody touched the
//        phone.” rises out of a mask on an ink plate (y 330–400).
//   S09  extreme close-up of Rita's reading glasses: the empty teal lobby
//        drifts 12 px L→R in both lenses (60%, barrel bulge), a 6-frame glint
//        crosses the near lens on “How can I help?”, the beaded chain catches
//        the light, a 2% push.
//   S10  rig A medium close-up, phone at her ear, binoculars down: deadpan, one
//        brow up over 6 frames at 18.7, eyes narrowing toward the Starlite at
//        19.1, ±2 px breathing and a 1% push; at 19.6 a passing car's light
//        sweeps the cabin L→R (10 frames, 15% white).
// Every time comes from marks.ts / timeline.ts. Captions (AI01, R08) are drawn
// globally in the band y 1200–1300; this scene keeps that band free of text.
import React from 'react';
import {AbsoluteFill, Easing, interpolate, useCurrentFrame} from 'remotion';
import type {SceneProps} from './types.ts';
import {Binoculars as BinocularPOV} from '../fx/Binoculars.tsx';
import {LOBBY, Lobby, LobbyArt, HOOK_ORIGIN, lobbyToFrame, type Crop} from '../set/Lobby.tsx';
import {CarInterior, type CarCamera} from '../set/CarInterior.tsx';
import {RitaA, RitaGlasses, type LensInfo, type RitaPose} from '../char/Rita.tsx';
import {S08, S09, S10, missedPulse} from '../marks.ts';
import {FPS, cue, local, scene, shot} from '../timeline.ts';
import {EASE_POP, FONT, INTER_FEATURES, NIGHT} from '../theme.ts';

const SCENE = 'WhoAnswers';
const FROM = scene(SCENE).from;
const lf = (sec: number) => local(SCENE, sec);
const clamp = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;
const popEase = Easing.bezier(...EASE_POP);

/** First local frames of S09 and S10. */
const S09_AT = lf(shot('S09').start);
const S10_AT = lf(shot('S10').start);

/** Story clock: Rita called at 2:21. */
const STORY_CLOCK = '2:21';

// ─── S08 · the empty counter ─────────────────────────────────────────────────

/** Board: one circle, r 470, centred (505, 800). */
const S08_LENS = {r: 470, centers: [{x: 505, y: 800}]} as const;
/** The set at 0.85, lifted so the dark phone sits in the middle of the circle; key rack, LED clock and empty chair inside it. */
const S08_CROP: Crop = {scale: 0.85, x: 0, y: -105};
const S08_PHONE = lobbyToFrame(LOBBY.screenCenter, S08_CROP);

/** Extra zoom k about a FRAME point, folded into a Lobby crop (keeps the SVG crisp). */
const zoomAbout = (c: Crop, k: number, at: {x: number; y: number}): Crop => {
  const ox = c.ox ?? HOOK_ORIGIN.x;
  const oy = c.oy ?? HOOK_ORIGIN.y;
  return {scale: c.scale * k, x: at.x - ox + k * (ox + c.x - at.x), y: at.y - oy + k * (oy + c.y - at.y), ox, oy};
};

/** “Nobody touched the phone.”: Inter 600 56 px ivory on an ink plate, its line box at y 330–400; rises out of a mask over 12 frames. */
const NobodyTouched: React.FC<{frame: number}> = ({frame}) => {
  const since = frame - lf(S08.nobodyTouched.t);
  if (since < 0) return null;
  const n = S08.nobodyTouched.frames;
  const rise = interpolate(since, [0, n], [1, 0], {...clamp, easing: popEase});
  const plateIn = interpolate(since, [0, 6], [0, 1], {...clamp, easing: Easing.out(Easing.quad)});
  const LH = 70;
  const TOP = 330;
  const PAD_Y = 10;
  return (
    <div style={{position: 'absolute', left: 105, width: 800, top: TOP - PAD_Y, display: 'flex', justifyContent: 'center'}}>
      <div
        style={{
          padding: `${PAD_Y}px 30px`,
          borderRadius: 14,
          background: `rgba(7, 9, 13, ${(0.8 * plateIn).toFixed(3)})`,
          boxShadow: `0 0 0 1px rgba(142, 215, 235, ${(0.1 * plateIn).toFixed(3)}), 0 12px 40px rgba(0, 0, 0, ${(0.4 * plateIn).toFixed(3)})`,
          transform: `scaleX(${(0.94 + 0.06 * plateIn).toFixed(4)})`,
        }}
      >
        <div style={{height: LH, overflow: 'hidden'}}>
          <div
            style={{
              fontFamily: FONT.ui,
              fontFeatureSettings: INTER_FEATURES,
              fontWeight: 600,
              fontSize: 56,
              lineHeight: `${LH}px`,
              letterSpacing: '-0.015em',
              color: NIGHT.ivory,
              whiteSpace: 'nowrap',
              transform: `translateY(${(rise * LH * 1.05).toFixed(2)}px)`,
              opacity: interpolate(since, [0, 4], [0.2, 1], clamp),
            }}
          >
            Nobody touched the phone.
          </div>
        </div>
      </div>
    </div>
  );
};

const S08Shot: React.FC<{frame: number}> = ({frame}) => {
  const sec = (FROM + frame) / FPS;
  // 100→110% linear over the whole shot, about the dark phone
  const push = interpolate(sec, [S08.push.start, S08.push.end], [1, 1.1], clamp);
  const crop = zoomAbout(S08_CROP, push, S08_PHONE);
  return (
    <BinocularPOV
      centers={S08_LENS.centers}
      r={S08_LENS.r}
      feather={18}
      rim="teal"
      drift={1}
      driftHz={0.6}
      imageDrift={1.2}
      seed="rita-s08"
      streaks={0.08}
      streakColor={NIGHT.teal}
      overlay={<NobodyTouched frame={frame} />}
    >
      <Lobby tint="teal" crop={crop} phoneState="dark" clock={STORY_CLOCK} dust={sec} />
    </BinocularPOV>
  );
};

// ─── S09 · her reading glasses ──────────────────────────────────────────────

/** The empty teal lobby as each lens sees it: mirrored, centred on the dark phone, the far lens foreshortened. */
const LensReflection = (sec: number) => (l: LensInfo) => {
  const sx = l.index === 0 ? -0.46 : -0.36;
  return (
    <g transform={`translate(${l.cx} ${l.cy + 6}) scale(${sx} 0.46) translate(-560 -860)`}>
      <LobbyArt tint="teal" phoneState="dark" clock={STORY_CLOCK} dust={sec} />
    </g>
  );
};

const S09Shot: React.FC<{frame: number}> = ({frame}) => {
  const sec = (FROM + frame) / FPS;
  const k = interpolate(sec, [S09.drift.start, S09.drift.end], [0, 1], clamp);
  const gAt = lf(S09.glint.t);
  const glint = interpolate(frame, [gAt, gAt + S09.glint.frames], [0, 1], clamp);
  // the chain's highlight slides down a few beads over the shot, brightest under the glint
  const chain = interpolate(k, [0, 1], [0.2, 0.55]);
  const push = 1 + 0.02 * k;
  return (
    <AbsoluteFill style={{background: NIGHT.ink}}>
      <AbsoluteFill style={{transform: `scale(${push.toFixed(5)})`, transformOrigin: '515px 880px'}}>
        <RitaGlasses reflection={LensReflection(sec)} reflectionOpacity={0.6} drift={12 * k} glint={glint} chainGlint={chain} lookX={0.1} />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// ─── S10 · “Sure it is, Gus.” ───────────────────────────────────────────────

/** A cabin camera that puts rest point p at frame point `to` at `scale` (about the cabin's (540, 960)). */
const camOn = (p: readonly [number, number], scale: number, to: readonly [number, number]): CarCamera => ({
  scale,
  x: to[0] - 540 - (p[0] - 540) * scale,
  y: to[1] - 960 - (p[1] - 960) * scale,
});
/** Her face (rest px, between the eyes and the mouth) and where it sits in frame: a 1.75× MCU, head and shoulders in the text
 *  column, her nose pointing at the teal windshield (the Starlite) on the right. At y 700 the pad's row of circled “20s”
 *  (tonight's included) lands just above the caption band instead of under it. */
const FACE: readonly [number, number] = [463, 757];
const FACE_AT: readonly [number, number] = [450, 700];
const S10_SCALE = 1.75;
/** Outside-the-glass parallax: far lower than the cabin default so the STARLITE sign stays in the windshield at this scale. */
const S10_DEPTH = 0.08;

const R08 = cue('R08');
/** Lips: a small, deadpan open/close per measured word of R08 (the face otherwise stays still). */
const mouthAt = (sec: number) => {
  for (const w of R08.words) {
    if (sec >= w.start && sec <= w.end) {
      const u = (sec - w.start) / Math.max(0.05, w.end - w.start);
      return 0.3 * Math.sin(Math.PI * u) ** 0.7;
    }
  }
  return 0;
};

const S10Shot: React.FC<{frame: number}> = ({frame}) => {
  const sec = (FROM + frame) / FPS;
  const shotK = interpolate(frame, [S10_AT, S10_AT + 60], [0, 1], clamp);
  // 1% push about her face
  const s = S10_SCALE * (1 + 0.01 * shotK);
  const camera: CarCamera = {...camOn(FACE, s, FACE_AT), depth: S10_DEPTH};
  const brow = interpolate(frame, [lf(S10.eyebrow.t), lf(S10.eyebrow.t) + S10.eyebrow.frames], [0, 1], {...clamp, easing: Easing.out(Easing.cubic)});
  const squint = interpolate(frame, [lf(S10.narrow), lf(S10.narrow) + 5], [0, 0.7], {...clamp, easing: Easing.inOut(Easing.quad)});
  const sweepAt = lf(S10.lightSweep.t);
  const sweep = interpolate(frame, [sweepAt, sweepAt + S10.lightSweep.frames], [0, 1], clamp);
  // the band crosses her face around 40–65% of its travel: her lenses flash with it
  const lensGlint = interpolate(sweep, [0.38, 0.66], [0, 1], clamp);
  const pose: RitaPose = {
    t: sec,
    phoneToEar: 1,
    binoculars: 0,
    browRaise: brow,
    browAsym: 0.2,
    squint,
    lookX: 0.35,
    mouthOpen: mouthAt(sec),
    glint: lensGlint,
    light: 'night',
  };
  return (
    <AbsoluteFill style={{background: NIGHT.ink}}>
      <CarInterior layer="back" camera={camera} clock={STORY_CLOCK} office={{clock: STORY_CLOCK, phoneState: 'dark'}} mirrorPulse={missedPulse(sec)} time={sec} />
      <RitaA layer="body" camera={camera} {...pose} />
      <CarInterior layer="front" camera={camera} pad={{nights: 4, tonight: 1}} time={sec} cabinSweep={sweep} />
      <RitaA layer="front" camera={camera} {...pose} />
    </AbsoluteFill>
  );
};

/** WhoAnswers (S08, S09, S10). */
export const WhoAnswers: React.FC<SceneProps> = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{background: '#000'}}>
      {frame < S09_AT ? <S08Shot frame={frame} /> : frame < S10_AT ? <S09Shot frame={frame} /> : <S10Shot frame={frame} />}
    </AbsoluteFill>
  );
};
