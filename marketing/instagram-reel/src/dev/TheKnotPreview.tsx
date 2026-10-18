// Dev preview for S20 TheKnot: both prints unrotated at their board positions, no
// motion, for measuring the marker-circle anchors (frame 0) and checking the UI crop.
import React from 'react';
import {AbsoluteFill} from 'remotion';
import {loadFonts} from '../fonts.ts';
import {BoardBackground, BOARD} from '../scenes/theknot/Board.tsx';
import {LockPanel} from '../scenes/theknot/LockPanel.tsx';
import {InboxPanel} from '../scenes/theknot/InboxPanel.tsx';
import {BOT, TOP} from '../scenes/theknot/layout.ts';

loadFonts();

const Flat: React.FC = () => (
  <AbsoluteFill style={{background: BOARD}}>
    <BoardBackground />
    <div style={{position: 'absolute', left: TOP.x, top: TOP.y, width: TOP.w, height: TOP.h}}>
      <LockPanel />
    </div>
    <div style={{position: 'absolute', left: BOT.x, top: BOT.y, width: BOT.w, height: BOT.h}}>
      <InboxPanel />
    </div>
  </AbsoluteFill>
);

export const preview = {id: 'TheKnotPreview', component: Flat, durationInFrames: 1};
