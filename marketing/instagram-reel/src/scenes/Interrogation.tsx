import React from 'react';
import {AbsoluteFill} from 'remotion';
import type {SceneProps} from './types.ts';

/** Interrogation (S11, S12, S13). Placeholder until the scene is built. */
export const Interrogation: React.FC<SceneProps> = () => (
  <AbsoluteFill style={{background: '#1a1a1a', color: '#888', fontSize: 64, fontFamily: 'Inter', justifyContent: 'center', alignItems: 'center'}}>
    Interrogation · S11, S12, S13
  </AbsoluteFill>
);
