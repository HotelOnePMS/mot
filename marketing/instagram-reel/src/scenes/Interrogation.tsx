import React from 'react';
import {useCurrentFrame} from 'remotion';
import type {SceneProps} from './types.ts';
import {S12_AT, S13_AT} from './interrogation/common.ts';
import {S11Shot, S13Shot} from './interrogation/Cabin.tsx';
import {PadInsert} from './interrogation/PadInsert.tsx';

/**
 * Interrogation (S11–S13, 20.5–28.5). Hard cuts at 24.0 and 27.0.
 *   S11 rig A leaning over the wheel: "Got a room Friday, for two?" / "We do." — "Fri 23" goes on the pad.
 *   S12 top-down on the pad: "$119?!", the double underline, "(I’m $129)".
 *   S13 rig A MCU: the trap ("Just a few hours, cash?"), glint, then the dive into the phone's speaker (→ S14).
 * Captions are drawn globally; paid placement (band y 1000–1100) lifts the written rows above it.
 */
export const Interrogation: React.FC<SceneProps> = ({placement}) => {
  const frame = useCurrentFrame();
  const paid = placement === 'paid';
  if (frame < S12_AT) return <S11Shot frame={frame} paid={paid} />;
  if (frame < S13_AT) return <PadInsert frame={frame} paid={paid} />;
  return <S13Shot frame={frame} />;
};
