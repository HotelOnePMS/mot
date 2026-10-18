// The Reel cover (grid, Reels tab, DM shares), per STORYBOARD.md "Cover frame":
// Rita's binocular POV of Gus's teal lobby with the FRONT DESK phone glowing,
// asking the hook's question. No logo: it reads as an episode, not an ad.
// Everything that matters sits inside the 3:4 grid crop (y 240-1680) and x 90-930.
import React from 'react';
import {AbsoluteFill} from 'remotion';
import {Binoculars as BinocularPOV} from './fx/Binoculars.tsx';
import {GlobalFx} from './fx/GlobalFx.tsx';
import {Lobby, SAM_NUMBER, type Crop} from './set/Lobby.tsx';
import {loadFonts} from './fonts.ts';
import {COLUMN_X, FONT, INTER_FEATURES, NIGHT} from './theme.ts';

loadFonts();

/** A touch tighter than S02 so the glowing phone carries the frame. */
const CROP: Crop = {scale: 0.62, x: 0, y: 70};
const LENSES = [
  {x: 330, y: 1010},
  {x: 690, y: 1010},
] as const;

export const Cover: React.FC = () => (
  <AbsoluteFill style={{background: '#000'}}>
    <BinocularPOV centers={LENSES} r={400} feather={18} rim="redCyan" drift={0} streaks={0.12} streakColor={NIGHT.teal} frame={0}>
      <Lobby tint="teal" crop={CROP} phoneState="ringing" screenNumber={SAM_NUMBER} ringPulse={0.8} />
    </BinocularPOV>
    {/* Rita's world bleeding in at the frame edges */}
    <AbsoluteFill style={{background: `radial-gradient(ellipse 75% 62% at 50% 52%, transparent 62%, ${NIGHT.red}2e 100%)`}} />
    <AbsoluteFill style={{background: `linear-gradient(180deg, ${NIGHT.ink}f2 0%, ${NIGHT.ink}cc 30%, transparent 44%)`}} />
    <div style={{position: 'absolute', left: COLUMN_X - 420, width: 840, top: 330, textAlign: 'center'}}>
      <div style={{fontFamily: FONT.ui, fontFeatureSettings: INTER_FEATURES, fontWeight: 600, fontSize: 30, letterSpacing: '0.12em', color: NIGHT.brass}}>ACROSS THE STREET · EP. 1</div>
      <div style={{marginTop: 44, fontFamily: FONT.display, fontWeight: 600, fontSize: 100, lineHeight: 1.06, letterSpacing: '-0.01em', color: NIGHT.ivory}}>
        WHO PICKS UP
        <br />
        AT <span style={{color: NIGHT.tealSoft}}>0:20</span>?
      </div>
    </div>
    <div style={{position: 'absolute', left: 0, width: COLUMN_X * 2, top: 1440, display: 'flex', justifyContent: 'center'}}>
      <div style={{padding: '18px 48px', borderRadius: 999, background: `${NIGHT.ink}e6`, boxShadow: `0 0 0 2px ${NIGHT.tealDeep}`, fontFamily: FONT.mono, fontWeight: 500, fontSize: 120, lineHeight: 1, color: NIGHT.tealSoft}}>2:13 AM</div>
    </div>
    <GlobalFx />
  </AbsoluteFill>
);
