// S18–S19 · Twist · 0:38.5–0:42.5.
// S18 smash-cuts to the EXACT opening frame (the shared HookFrame with the same
// props, so f1155 ≡ f0). The question pops again, the hook dims, a red counter
// runs under the phone; at 0:20 nothing happens and "Nobody." slams in.
// S19 pulls back and pans right to the window: Rita's sedan under the Starlite
// sign, the binocular glint, an ivory ring, "Rita's lobby." and MISSED CALL.
import React from 'react';
import {AbsoluteFill, Easing, interpolate, useCurrentFrame} from 'remotion';
import type {SceneProps} from './types.ts';
import {HookFrame, HOOK_TEXT, InkPlate, rgba} from './coldopen/HookFrame.tsx';
import {glintEnvelope} from '../fx/LensGlint.tsx';
import {MarkerCircle} from '../fx/RedString.tsx';
import {SteppedCounter} from '../ui/Counter.tsx';
import {HOOK_CROP, LOBBY, lobbyToFrame, type Crop} from '../set/Lobby.tsx';
import {S18, S19, TWIST_COUNTER} from '../marks.ts';
import {f, scene} from '../timeline.ts';
import {EASE_POP, FONT, NIGHT} from '../theme.ts';

const SCENE = 'Twist';
const FROM = scene(SCENE).from;
const clamp = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;
const ease = Easing.bezier(...EASE_POP);

/**
 * S19 end framing: pulled back to 92% and panned right. The board says +260 px, but at
 * 260 the LED clock ("2:13", set x 175) leaves frame on the left; 190 keeps the whole
 * clock in the foreground framing and still centres the window/sedan in the column.
 */
export const TWIST_END_CROP: Crop = {scale: 0.92, x: -190, y: 0};

/** The counter band (board: y 1120–1200, nobody speaks so the caption band is free). */
const COUNTER_BAND = {top: 1120, bottom: 1200};

/** A Fraunces slam (scale 1.2 → 1 over 6 frames), red, with an optional 1-frame white flash. */
const Slam: React.FC<{text: string; since: number; top: number; size: number; flash?: boolean; opacity?: number}> = ({text, since, top, size, flash = false, opacity = 1}) => {
  if (since < 0 || opacity <= 0) return null;
  const s = interpolate(since, [0, 6], [1.2, 1], {...clamp, easing: ease});
  const white = flash && since < 1;
  return (
    <div
      style={{
        position: 'absolute',
        left: HOOK_TEXT.x - 450,
        width: 900,
        top,
        height: size * 1.04,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: FONT.display,
        fontWeight: 600,
        fontSize: size,
        lineHeight: 1,
        letterSpacing: '-0.01em',
        whiteSpace: 'nowrap',
        color: white ? NIGHT.phoneGlow : NIGHT.red,
        textShadow: white
          ? `0 0 28px ${rgba(NIGHT.ivory, 0.9)}, 0 0 60px ${rgba(NIGHT.redSoft, 0.6)}`
          : `0 0 26px ${rgba(NIGHT.red, 0.42)}, 0 0 6px ${rgba(NIGHT.red, 0.35)}, 0 2px 14px ${rgba(NIGHT.ink, 0.6)}`,
        transform: `scale(${s})`,
        transformOrigin: '50% 55%',
        opacity,
      }}
    >
      {text}
    </div>
  );
};

/** One-frame white bloom behind a slam (the board's 1-frame white flash). */
const SlamFlash: React.FC<{since: number; top: number; height: number}> = ({since, top, height}) => {
  if (since < 0 || since >= 1) return null;
  return (
    <div
      style={{
        position: 'absolute',
        left: HOOK_TEXT.x - 520,
        width: 1040,
        top: top - 140,
        height: height + 280,
        background: `radial-gradient(closest-side, ${rgba(NIGHT.ivory, 0.32)}, ${rgba(NIGHT.ivory, 0.1)} 55%, ${rgba(NIGHT.ivory, 0)})`,
      }}
    />
  );
};

export const Twist: React.FC<SceneProps> = () => {
  const frame = useCurrentFrame();
  const abs = frame + FROM;
  const sec = abs / 30;

  // S18: no camera move until 40.4; the pull-back/pan runs through S19 to 41.3.
  const k = interpolate(abs, [f(S18.pullBack), f(S19.move.end)], [0, 1], {...clamp, easing: Easing.inOut(Easing.cubic)});
  const crop: Crop = k === 0 ? HOOK_CROP : {scale: 1 + (TWIST_END_CROP.scale - 1) * k, x: TWIST_END_CROP.x * k, y: 0};

  // S18 39.0: eyebrow + headline dim to 25%
  const dim = interpolate(abs, [f(S18.dim), f(S18.dim) + 6], [0, 1], {...clamp, easing: Easing.out(Easing.cubic)});
  // S19 40.6–40.9: the question, "Nobody." and the hook block fade out
  const textOut = interpolate(abs, [f(S19.textOut.start), f(S19.textOut.end)], [1, 0], {...clamp, easing: Easing.in(Easing.quad)});

  // 42.1: the counter freezes into MISSED CALL and the phone glow dies
  const missed = f(S19.missed);
  const screen = interpolate(abs, [missed - 1, missed, missed + 1, missed + 9], [1, 0.5, 0.3, 0], clamp);

  const nobodySince = abs - f(S18.nobody.t);
  const slamSince = abs - f(S19.slam.t);
  const ringP = interpolate(abs, [f(S19.ring.start), f(S19.ring.end)], [0, 1], clamp);
  const counterOn = interpolate(abs, [f(TWIST_COUNTER[0].t) - 1, f(TWIST_COUNTER[0].t)], [0, 1], clamp);
  const sedan = lobbyToFrame({x: LOBBY.sedan.cx, y: LOBBY.sedan.cy}, crop);

  return (
    <HookFrame
      crop={crop}
      sec={sec}
      glint={glintEnvelope(abs, f(S19.glint.t), S19.glint.frames)}
      phoneBlur={3.2 * k}
      screen={screen}
      question={abs - f(S18.question.t)}
      dim={dim}
      opacity={textOut}
    >
      {/* "Nobody." under the question, on its own extension of the ink plate */}
      {/* "Nobody." lands over the phone's top edge and the LED clock (board y 670–770): a denser plate keeps it clean */}
      <InkPlate top={HOOK_TEXT.nobody.top + 4} bottom={HOOK_TEXT.nobody.top + 96} width={420} alpha={0.86} feather={80} opacity={nobodySince >= 0 ? textOut * interpolate(nobodySince, [0, 2], [0.6, 1], clamp) : 0} />
      <Slam text="Nobody." since={nobodySince} top={HOOK_TEXT.nobody.top} size={HOOK_TEXT.nobody.size} opacity={textOut} />

      {/* the ivory ring around Rita's sedan across the road */}
      <MarkerCircle cx={sedan.x + 2} cy={sedan.y - 4} rx={98} ry={50} progress={ringP} color={NIGHT.ivory} width={3} wobble={0.05} tilt={-4} seed="s19ring" opacity={0.92} />

      {/* "Rita's lobby." */}
      <InkPlate top={378} bottom={482} width={700} alpha={0.62} opacity={slamSince >= 0 ? 1 : 0} />
      <SlamFlash since={slamSince} top={380} height={100} />
      <Slam text="Rita’s lobby." since={slamSince} top={380} size={96} flash />

      {/* the red counter under the phone: RINGING 0:18 → 0:41 → MISSED CALL */}
      <AbsoluteFill>
        <InkPlate top={COUNTER_BAND.top + 6} bottom={COUNTER_BAND.bottom - 6} width={600} alpha={0.55} feather={70} opacity={counterOn} />
        <div style={{position: 'absolute', left: HOOK_TEXT.x - 450, width: 900, top: COUNTER_BAND.top, height: COUNTER_BAND.bottom - COUNTER_BAND.top, display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
          <SteppedCounter
            steps={TWIST_COUNTER}
            sceneName={SCENE}
            label="RINGING"
            size={72}
            layout="inline"
            variant="red"
            gap={28}
            flashFor={(step, since) => (step.label === '0:20' ? interpolate(since, [0, 1, 6], [1, 0.85, 0], clamp) : 0)}
          />
        </div>
      </AbsoluteFill>
    </HookFrame>
  );
};
