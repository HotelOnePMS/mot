// Dev preview for src/set/Highway.tsx.
//   f0–59   'crane' (S05): crane 1.25/+180 → rest over f0–33, Rita's dip at f21, Starlite's at f42, 1 Hz missed pulse
//   f60–89  'facade' (S27): Rita's Motor Inn from the Starlite, her phone ringing
import React from 'react';
import {AbsoluteFill, Easing, interpolate, useCurrentFrame} from 'remotion';
import {loadFonts} from '../fonts.ts';
import {missedPulse} from '../marks.ts';
import {Highway, HIGHWAY} from '../set/Highway.tsx';
import {buzzOffset} from '../set/Lobby.tsx';
import {FONT, NIGHT} from '../theme.ts';

loadFonts();


const HighwayPreviewComp: React.FC = () => {
  const frame = useCurrentFrame();
  if (frame < 60) {
    const k = interpolate(frame, [0, 33], [0, 1], {extrapolateRight: 'clamp', easing: Easing.bezier(0.22, 1, 0.36, 1)});
    const scale = interpolate(k, [0, 1], [1.25, 1]);
    const y = interpolate(k, [0, 1], [180, 0]);
    return (
      <AbsoluteFill>
        <Highway camera={{scale, x: 0, y}} ritaNeon={frame >= 21 && frame < 24 ? 0.25 : 1} starliteNeon={frame >= 42 && frame < 45 ? 0.25 : 1} missedPulse={missedPulse(9 + frame / 30)} carGlint={0} />
        <svg width={1080} height={1920} style={{position: 'absolute', inset: 0}}>
          {frame >= 33 ? (
            <>
              <path d={`M600 1112 Q${HIGHWAY.sedan.cx - 20} 1150 ${HIGHWAY.sedan.cx} ${HIGHWAY.sedan.y + HIGHWAY.sedan.h + 6}`} fill="none" stroke={NIGHT.ivory} strokeWidth={2} />
              <rect x={330} y={392} width={420} height={2} fill={NIGHT.brass} />
            </>
          ) : null}
        </svg>
        {frame >= 33 ? (
          <>
            <div style={{position: 'absolute', left: 105, width: 870, top: 296, textAlign: 'center', fontFamily: FONT.display, fontWeight: 600, fontSize: 72, color: NIGHT.ivory}}>Across the Street</div>
            <div style={{position: 'absolute', left: 552, top: 1112, fontFamily: FONT.ui, fontWeight: 600, fontSize: 30, color: NIGHT.ivory}}>Rita</div>
          </>
        ) : null}
        <div style={{position: 'absolute', left: 24, bottom: 24, fontFamily: FONT.mono, fontSize: 26, color: NIGHT.brass}}>crane {scale.toFixed(3)} / {y.toFixed(0)}</div>
      </AbsoluteFill>
    );
  }
  const lf = frame - 60;
  return (
    <AbsoluteFill>
      <Highway variant="facade" ritaNeon={1} lobby={{phoneState: 'ringing', ringPulse: lf < 18 ? 1 : 0, buzz: buzzOffset(lf, lf < 18 ? 1 : 0)}} />
      <div style={{position: 'absolute', left: 24, bottom: 24, fontFamily: FONT.mono, fontSize: 26, color: NIGHT.brass}}>facade (S27)</div>
    </AbsoluteFill>
  );
};

export const preview = {id: 'HighwayPreview', component: HighwayPreviewComp, durationInFrames: 90};
