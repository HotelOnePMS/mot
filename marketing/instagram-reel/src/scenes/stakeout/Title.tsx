// S04's character title: "Rita." (Fraunces 600, 96 px, ivory, y 300–400) and
// "Rita’s Motor Inn" (Inter 600, 44 px, red-soft #fa9e9e, y 420–470),
// left-aligned at x 92 over the dark headliner, above her head. "Rita." rises
// from a mask with the board's pop ease; the motel line follows 3 frames later.
import React from 'react';
import {Easing, interpolate} from 'remotion';
import {EASE_POP, FONT, INTER_FEATURES, NIGHT} from '../../theme.ts';

/** Left edge of the title block (inside the IG safe area, x ≥ 90). */
export const TITLE_X = 92;

const pop = Easing.bezier(...EASE_POP);
const clamp = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;
const SHADOW = `0 2px 18px rgba(7, 9, 13, 0.75), 0 0 2px rgba(7, 9, 13, 0.6)`;

export const StakeoutTitle: React.FC<{frame: number; at: number}> = ({frame, at}) => {
  const a = interpolate(frame, [at, at + 11], [0, 1], {...clamp, easing: pop});
  const b = interpolate(frame, [at + 3, at + 14], [0, 1], {...clamp, easing: pop});
  if (a <= 0) return null;
  const col = {position: 'absolute' as const, left: TITLE_X, width: 760, textAlign: 'left' as const};
  return (
    <>
      {/* y 300–400 */}
      <div style={{...col, top: 300, height: 100, overflow: 'hidden'}}>
        <div
          style={{
            fontFamily: FONT.display,
            fontWeight: 600,
            fontSize: 96,
            lineHeight: '100px',
            letterSpacing: '-0.015em',
            color: NIGHT.ivory,
            fontVariationSettings: "'opsz' 96, 'SOFT' 0, 'WONK' 0",
            textShadow: SHADOW,
            transform: `translateY(${((1 - a) * 92).toFixed(2)}px)`,
          }}
        >
          Rita.
        </div>
      </div>
      {/* y 420–470 */}
      <div
        style={{
          ...col,
          top: 420,
          height: 50,
          fontFamily: FONT.ui,
          fontWeight: 600,
          fontSize: 44,
          lineHeight: '50px',
          letterSpacing: '0.005em',
          fontFeatureSettings: INTER_FEATURES,
          color: NIGHT.redSoft,
          textShadow: SHADOW,
          opacity: b,
          transform: `translateY(${((1 - b) * 16).toFixed(2)}px)`,
        }}
      >
        Rita’s Motor Inn
      </div>
    </>
  );
};
