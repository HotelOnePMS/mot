import React from 'react';
import {AbsoluteFill} from 'remotion';
import type {SceneProps} from './types.ts';

/** Mirror (S17). Placeholder until the scene is built. */
export const Mirror: React.FC<SceneProps> = () => (
  <AbsoluteFill style={{background: '#1a1a1a', color: '#888', fontSize: 64, fontFamily: 'Inter', justifyContent: 'center', alignItems: 'center'}}>
    Mirror · S17
  </AbsoluteFill>
);
