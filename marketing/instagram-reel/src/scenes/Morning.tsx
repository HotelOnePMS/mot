import React from 'react';
import {AbsoluteFill} from 'remotion';
import type {SceneProps} from './types.ts';

/** Morning (S21, S22, S23, S24, S25). Placeholder until the scene is built. */
export const Morning: React.FC<SceneProps> = () => (
  <AbsoluteFill style={{background: '#1a1a1a', color: '#888', fontSize: 64, fontFamily: 'Inter', justifyContent: 'center', alignItems: 'center'}}>
    Morning · S21, S22, S23, S24, S25
  </AbsoluteFill>
);
