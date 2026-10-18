// S14 ConsoleDive 28.5–31.5. The dive into the speaker grille of Rita's phone breaks into teal particles that
// resolve into ONE field of the HotelOne staff console (dark): the film's first brand mark, a crop of the real
// "How it sounds" card with House rules lit, the "day-use" highlight on the measured word, the Queen Room · Fri
// rate cell docking with a spring, then a whip-pan right into S15. Captions are drawn globally (AI03).
import React from 'react';
import {AbsoluteFill, Easing, interpolate, useCurrentFrame} from 'remotion';
import type {SceneProps} from './types.ts';
import {ParticleDive} from '../fx/ParticleDive.tsx';
import {NIGHT} from '../theme.ts';
import {DIVE_CENTER, PARTICLE_ROWS, PARTICLE_TARGET, T} from './consoledive/layout.ts';
import {Backdrop, HouseRulesCard, Headline, Lockup, RateCellDock, SubLine, WhipStreaks, c01, springIn} from './consoledive/parts.tsx';

const clamp = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;
const DIVE_FRAMES = T.resolve; // 21 frames: 28.5 → 29.2
const sweepEase = Easing.bezier(0.45, 0, 0.3, 1);

/** Everything in the shot at scene-local `frame` (the whip renders it several times as motion-blur copies). */
const World: React.FC<{frame: number}> = ({frame}) => {
  const dive = c01(frame / DIVE_FRAMES);
  const resolve = c01((frame - T.diveEnd) / (T.resolve - T.diveEnd));

  // slow 2.5% push on the console once it has resolved (keeps the still alive under the voice)
  const push = 1 + 0.025 * Easing.inOut(Easing.sin)(c01((frame - T.resolve) / (T.whip - T.resolve)));

  const card = {
    enter: c01((frame - (T.diveEnd + 1)) / (T.resolve - T.diveEnd - 1)),
    lit: interpolate(frame, [T.tick - 1, T.tick + 1], [0, 1], clamp),
    flash: interpolate(frame, [T.tick - 1, T.tick + 1, T.tick + 11], [0, 1, 0], clamp),
    glow: interpolate(frame, [T.diveEnd + 2, T.resolve, T.resolve + 18], [0, 1, 0], clamp),
    first: interpolate(frame, [T.tick, T.tick + 6], [0.8, 1], clamp),
    rest: interpolate(frame, [T.tick, T.tick + 9], [0.8, 0.4], clamp),
    // first sliver on the measured onset of "day-use", full width 10 frames later
    highlight: sweepEase(c01((frame - (T.highlight - 1)) / T.highlightFrames)),
  };
  const lockup = c01((frame - (T.diveEnd + 4)) / 12);
  const sill = Easing.out(Easing.cubic)(c01((frame - (T.tick + 1)) / 8));
  const cell = springIn(frame - T.cellStart, T.cellDock - T.cellStart);
  const tock = interpolate(frame, [T.cellDock - 1, T.cellDock, T.cellDock + 6], [0, 1, 0], clamp);

  return (
    <AbsoluteFill>
      <Backdrop frame={frame} resolve={resolve} />
      {dive < 1 ? <ParticleDive progress={dive} layer="grille" background="transparent" center={DIVE_CENTER} target={PARTICLE_TARGET} rows={PARTICLE_ROWS} /> : null}
      <AbsoluteFill style={{transform: `scale(${push})`, transformOrigin: '505px 880px'}}>
        {frame > T.diveEnd ? <HouseRulesCard {...card} /> : null}
        {lockup > 0 ? <Lockup t={lockup} sill={sill} /> : null}
        <RateCellDock s={cell} tock={tock} />
        <Headline frame={frame} at={T.headline} />
        <SubLine frame={frame} at={T.subLine} />
      </AbsoluteFill>
      {dive < 1 ? <ParticleDive progress={dive} layer="particles" center={DIVE_CENTER} target={PARTICLE_TARGET} rows={PARTICLE_ROWS} /> : null}
    </AbsoluteFill>
  );
};

// Whip-pan right (31.3 → 31.5, into S15): the world slides left, accelerating; motion blur = averaged copies
// along the shutter (copy i at opacity 1/(i+1) gives an equal-weight average of opaque layers).
const WHIP_DIST = 1500;
const whipX = (t: number) => -WHIP_DIST * Math.pow(c01(t), 2.4);
const COPIES = 10;
const SHUTTER = 1; // frames (a 360° shutter: the copies tile the frame-to-frame travel)

export const ConsoleDive: React.FC<SceneProps> = () => {
  const frame = useCurrentFrame();
  if (frame < T.whip) return <World frame={frame} />;

  const span = T.end - T.whip; // 6 frames
  const t = (frame - T.whip) / span;
  const x = whipX(t);
  const v = c01((whipX(t - 1 / span) - x) / 420); // px per frame, normalised
  return (
    <AbsoluteFill style={{background: NIGHT.ink}}>
      {Array.from({length: COPIES}, (_, i) => {
        const tt = t - (i / (COPIES - 1)) * (SHUTTER / span);
        return (
          <AbsoluteFill key={i} style={{transform: `translateX(${whipX(tt)}px)`, opacity: 1 / (i + 1)}}>
            <World frame={frame} />
          </AbsoluteFill>
        );
      })}
      <WhipStreaks v={v} travel={-x} />
    </AbsoluteFill>
  );
};
