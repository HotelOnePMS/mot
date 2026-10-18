// S20 detective board pieces: the ink board with faint fibres, push pins, tape,
// and the pinned mono tags. All static SVG/inline styles, seeded with random().
import React, {useMemo} from 'react';
import {random} from 'remotion';
import {alpha, mix} from '../../set/parts.tsx';
import {FONT, NIGHT} from '../../theme.ts';

const W = 1080;
const H = 1920;

/** Board colour per the board: ink #0c1017 (= NIGHT.wall). */
export const BOARD = NIGHT.wall;

/**
 * The board itself: flat ink, a soft overhead light, colour-coded spill behind each panel
 * (red = Rita, teal = Gus), felt fibres and a few old pin holes. Drawn once; nothing animates.
 */
export const BoardBackground: React.FC = () => {
  const fibres = useMemo(() => {
    const out: {d: string; w: number; o: number; c: string}[] = [];
    for (let i = 0; i < 900; i++) {
      const x = -40 + random(`knot-fx${i}`) * (W + 80);
      const y = -40 + random(`knot-fy${i}`) * (H + 80);
      const len = 5 + random(`knot-fl${i}`) ** 2 * 26;
      const a = random(`knot-fa${i}`) * Math.PI * 2;
      const bend = (random(`knot-fb${i}`) - 0.5) * len * 0.35;
      const x2 = x + Math.cos(a) * len;
      const y2 = y + Math.sin(a) * len;
      const mx = (x + x2) / 2 - Math.sin(a) * bend;
      const my = (y + y2) / 2 + Math.cos(a) * bend;
      const light = random(`knot-fc${i}`) > 0.28;
      out.push({
        d: `M${x.toFixed(1)} ${y.toFixed(1)}Q${mx.toFixed(1)} ${my.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}`,
        w: 0.6 + random(`knot-fw${i}`) * 0.8,
        o: light ? 0.025 + random(`knot-fo${i}`) * 0.04 : 0.2 + random(`knot-fo${i}`) * 0.2,
        c: light ? NIGHT.grey : NIGHT.ink,
      });
    }
    return out;
  }, []);
  const holes = useMemo(
    () =>
      Array.from({length: 26}, (_, i) => ({
        x: 40 + random(`knot-hx${i}`) * (W - 80),
        y: 60 + random(`knot-hy${i}`) * (H - 120),
        r: 1.6 + random(`knot-hr${i}`) * 1.6,
      })),
    [],
  );
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{position: 'absolute', inset: 0}} aria-hidden>
      <defs>
        <radialGradient id="knot-lamp" cx={505} cy={760} r={1100} gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={NIGHT.wallLow} />
          <stop offset="0.55" stopColor={BOARD} />
          <stop offset="1" stopColor={NIGHT.ink} />
        </radialGradient>
        <radialGradient id="knot-redspill" cx={505} cy={700} r={520} gradientUnits="userSpaceOnUse" gradientTransform="translate(505 700) scale(1.1 0.55) translate(-505 -700)">
          <stop offset="0" stopColor={NIGHT.red} stopOpacity={0.16} />
          <stop offset="1" stopColor={NIGHT.red} stopOpacity={0} />
        </radialGradient>
        <radialGradient id="knot-tealspill" cx={505} cy={1240} r={600} gradientUnits="userSpaceOnUse" gradientTransform="translate(505 1240) scale(1.05 0.7) translate(-505 -1240)">
          <stop offset="0" stopColor={NIGHT.teal} stopOpacity={0.13} />
          <stop offset="1" stopColor={NIGHT.teal} stopOpacity={0} />
        </radialGradient>
      </defs>
      <rect width={W} height={H} fill="url(#knot-lamp)" />
      <rect width={W} height={H} fill="url(#knot-redspill)" />
      <rect width={W} height={H} fill="url(#knot-tealspill)" />
      <g fill="none" strokeLinecap="round">
        {fibres.map((f, i) => (
          <path key={i} d={f.d} stroke={f.c} strokeOpacity={f.o} strokeWidth={f.w} />
        ))}
      </g>
      {holes.map((h, i) => (
        <g key={i}>
          <circle cx={h.x} cy={h.y} r={h.r} fill={NIGHT.ink} opacity={0.75} />
          <circle cx={h.x + 0.6} cy={h.y + 0.8} r={h.r * 0.9} fill="none" stroke={NIGHT.grey} strokeOpacity={0.08} strokeWidth={0.8} />
        </g>
      ))}
    </svg>
  );
};

/** A push pin (top-down) in any world colour, shades derived from it. Units: frame px. */
export const BoardPin: React.FC<{x: number; y: number; color: string; r?: number; scale?: number}> = ({x, y, color, r = 10, scale = 1}) => {
  if (scale <= 0) return null;
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      <ellipse cx={4.5} cy={6.5} rx={r * 1.1} ry={r * 0.9} fill={NIGHT.ink} opacity={0.55} />
      <circle r={r} fill={mix(color, NIGHT.ink, 0.55)} />
      <circle r={r * 0.84} cy={-0.8} fill={color} />
      <circle r={r * 0.46} cx={-r * 0.14} cy={-r * 0.24} fill={mix(color, NIGHT.ivory, 0.55)} opacity={0.6} />
      <circle r={r * 0.18} cx={-r * 0.34} cy={-r * 0.4} fill={NIGHT.ivory} opacity={0.9} />
    </g>
  );
};

/** A strip of masking tape across a corner (frame px, centred on x, y). */
export const Tape: React.FC<{x: number; y: number; w?: number; h?: number; rot: number; seed: string}> = ({x, y, w = 120, h = 34, rot, seed}) => {
  // torn ends: a few seeded teeth on each short side
  const teeth = (side: 0 | 1) =>
    Array.from({length: 6}, (_, i) => {
      const yy = (h * i) / 5;
      const xx = (side === 0 ? 0 : w) + (side === 0 ? 1 : -1) * random(`${seed}${side}${i}`) * 5;
      return `${xx.toFixed(1)} ${yy.toFixed(1)}`;
    });
  const left = teeth(0);
  const right = teeth(1).reverse();
  const d = `M${left.join(' L')} L${right.join(' L')} Z`;
  return (
    <g transform={`translate(${x} ${y}) rotate(${rot}) translate(${-w / 2} ${-h / 2})`}>
      <path d={d} fill={NIGHT.ink} opacity={0.35} transform="translate(2 4)" />
      <path d={d} fill={NIGHT.tape} opacity={0.62} />
      <path d={`M2 ${h * 0.3} L${w - 2} ${h * 0.24}`} stroke={NIGHT.ivory} strokeOpacity={0.25} strokeWidth={1.2} />
    </g>
  );
};

/** A pinned mono tag (JetBrains Mono 28 px) on a dark chip, rotated a touch, with its pin at the left end. */
export const PinnedTag: React.FC<{text: string; color: string; x: number; cy: number; rot?: number; pin?: number; align?: 'left' | 'right'}> = ({text, color, x, cy, rot = -1.4, pin = 1, align = 'left'}) => {
  const h = 42;
  const pos: React.CSSProperties = align === 'left' ? {left: x} : {right: W - x};
  return (
    <div style={{position: 'absolute', ...pos, top: cy - h / 2, height: h, transform: `rotate(${rot}deg)`, transformOrigin: align === 'left' ? '0 50%' : '100% 50%'}}>
      <div
        style={{
          height: h,
          display: 'flex',
          alignItems: 'center',
          padding: '0 18px 0 40px',
          borderRadius: 8,
          background: mix(NIGHT.ink, NIGHT.wallLow, 0.6),
          boxShadow: `inset 0 0 0 1.5px ${alpha(color, 0.38)}, 0 10px 22px -10px ${alpha(NIGHT.ink, 0.95)}`,
          fontFamily: FONT.mono,
          fontWeight: 500,
          fontSize: 28,
          letterSpacing: '-0.01em',
          color,
          whiteSpace: 'nowrap',
        }}
      >
        {text}
      </div>
      <svg width={40} height={h} style={{position: 'absolute', left: 0, top: 0, overflow: 'visible'}} aria-hidden>
        <BoardPin x={20} y={h / 2} color={color} r={8.5} scale={pin} />
      </svg>
    </div>
  );
};
