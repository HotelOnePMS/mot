// S17's line: "Rita missed one thing." (Fraunces 600, 72 px, ivory #f5f3f0,
// y 300–380), centred on the text column (x 505). It rises out of a mask at
// 37.1 with the board's pop ease, then holds dead still into the hard cut.
import React from 'react';
import {Easing, interpolate} from 'remotion';
import {COLUMN_X, EASE_POP, FONT, NIGHT} from '../../theme.ts';

const pop = Easing.bezier(...EASE_POP);
const clamp = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;
const SHADOW = '0 2px 20px rgba(7, 9, 13, 0.85), 0 0 3px rgba(7, 9, 13, 0.7)';

/** Box of the line: y 300–380, column x 90–920 centred on x 505. */
export const MIRROR_TITLE = {top: 300, height: 80, width: 830, cx: COLUMN_X} as const;

export const MirrorTitle: React.FC<{frame: number; at: number}> = ({frame, at}) => {
  const a = interpolate(frame, [at, at + 12], [0, 1], {...clamp, easing: pop});
  if (a <= 0) return null;
  const T = MIRROR_TITLE;
  return (
    // the mask box runs a little past the line box so the descender of "g" and the shadow are not clipped
    <div style={{position: 'absolute', left: T.cx - T.width / 2, width: T.width, top: T.top - 10, height: T.height + 34, overflow: 'hidden'}}>
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: 10,
          height: T.height,
          textAlign: 'center',
          whiteSpace: 'nowrap',
          fontFamily: FONT.display,
          fontWeight: 600,
          fontSize: 72,
          lineHeight: `${T.height}px`,
          letterSpacing: '-0.012em',
          color: NIGHT.ivory,
          fontVariationSettings: "'opsz' 72, 'SOFT' 0, 'WONK' 0",
          textShadow: SHADOW,
          opacity: interpolate(a, [0, 0.35], [0, 1], clamp),
          transform: `translateY(${((1 - a) * (T.height + 20)).toFixed(2)}px)`,
        }}
      >
        Rita missed one thing.
      </div>
    </div>
  );
};
