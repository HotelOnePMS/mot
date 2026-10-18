// S17's steam curl off the thermos cup: three ivory wisps that rise, sway and
// fade, in the coordinates of whatever <g> they are drawn in (Rita's rest px
// under her camera). Each wisp loops on its own clock and is invisible at the
// loop point, so there is no pop. Deterministic: driven by `t` (seconds) only.
import React from 'react';
import {useUid} from '../../set/parts.tsx';
import {NIGHT} from '../../theme.ts';

export const SteamCurl: React.FC<{x: number; y: number; t: number; amount?: number; height?: number; lean?: number}> = ({x, y, t, amount = 1, height = 150, lean = 56}) => {
  const uid = useUid('steam');
  if (amount <= 0.001) return null;
  return (
    <g transform={`translate(${x} ${y})`} fill="none" strokeLinecap="round">
      <defs>
        <linearGradient id={`${uid}f`} x1="0" y1="0" x2="0" y2={-height} gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={NIGHT.ivory} stopOpacity={0} />
          <stop offset="0.12" stopColor={NIGHT.ivory} stopOpacity={0.9} />
          <stop offset="0.55" stopColor={NIGHT.ivory} stopOpacity={0.45} />
          <stop offset="1" stopColor={NIGHT.ivory} stopOpacity={0} />
        </linearGradient>
      </defs>
      {[0, 1, 2].map((i) => {
        const r = (t * 0.55 + i * 0.37) % 1; // 0..1 along this wisp's loop
        const ph = t * (1.5 + i * 0.35) + i * 2.1;
        const y0 = -r * 26;
        const h = height * (0.7 + 0.3 * r);
        const sway = 10 + 10 * r;
        // the curl leans away from her face (toward +x, the dark windshield side) as it climbs
        const d = `M${-8 + i * 8} ${y0} C ${-6 + i * 6 + lean * 0.3 + Math.sin(ph) * sway} ${y0 - h * 0.33}, ${14 + i * 6 + lean * 0.65 + Math.sin(ph + 1.4) * sway * 1.4} ${y0 - h * 0.62}, ${2 + i * 7 + lean + Math.sin(ph + 2.3) * sway * 1.8} ${y0 - h}`;
        const fade = Math.sin(r * Math.PI);
        return <path key={i} d={d} stroke={`url(#${uid}f)`} strokeWidth={6 - i * 1.3} opacity={amount * fade * (0.62 - i * 0.12)} />;
      })}
    </g>
  );
};
