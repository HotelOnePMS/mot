import React from 'react';
import {AbsoluteFill} from 'remotion';
import type {SceneProps} from './types.ts';

/** Twist (S18, S19). Placeholder until the scene is built. */
export const Twist: React.FC<SceneProps> = () => (
  <AbsoluteFill style={{background: '#1a1a1a', color: '#888', fontSize: 64, fontFamily: 'Inter', justifyContent: 'center', alignItems: 'center'}}>
    Twist · S18, S19
  </AbsoluteFill>
);
