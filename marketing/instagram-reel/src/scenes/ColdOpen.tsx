// S01 · ColdOpen · 0:00.0–0:03.0. Rita's red lobby, misread as the Starlite.
// Frame 0 is clean and settled (it is the autoplay still and the loop landing).
// The headline IS Rita's R01 caption: a brass bar travels under each word as she
// says it (cue('R01').words). The hook question pops at 1.25.
import React from 'react';
import {Easing, interpolate, useCurrentFrame} from 'remotion';
import type {SceneProps} from './types.ts';
import {HookFrame, underlinesAt} from './coldopen/HookFrame.tsx';
import {glintEnvelope} from '../fx/LensGlint.tsx';
import {S01} from '../marks.ts';
import {f, scene} from '../timeline.ts';
import {HOOK_CROP} from '../set/Lobby.tsx';

export {HookFrame, HookText, HookQuestion, InkPlate, HOOK_TEXT, ringAt, trillAt, underlinesAt} from './coldopen/HookFrame.tsx';

const FROM = scene('ColdOpen').from;
const clamp = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;

/** Window neon dip f22–24: 60% → 100%. */
export const neonDip = (frame: number, at: number) => interpolate(frame, [at - 1, at, at + 3], [1, 0.6, 1], clamp);

export const ColdOpen: React.FC<SceneProps> = () => {
  const frame = useCurrentFrame();
  const abs = frame + FROM;
  const sec = abs / 30;
  // 100% → 106% over the whole shot, anchored on the phone screen (HOOK_ORIGIN 505,935)
  const push = interpolate(abs, [f(S01.push.start), f(S01.push.end)], [1, 1.06], {...clamp, easing: Easing.inOut(Easing.cubic)});
  const crop = push === 1 ? HOOK_CROP : {scale: push, x: 0, y: 0};
  return (
    <HookFrame
      crop={crop}
      sec={sec}
      windowNeon={neonDip(abs, f(S01.neonDip.t))}
      glint={glintEnvelope(abs, f(S01.glint.t), S01.glint.frames)}
      underlines={underlinesAt(sec)}
      question={abs - f(S01.question.t)}
    />
  );
};
