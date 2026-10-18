// src/components/voice/VoiceOrb.tsx (tone 'agent'): a bg-aurora circle with
// shadow-glow, a radial sheen at 32% 26% (agent-gradient-foreground at .32,
// gone by 62%), a white Mic at 38% size, scale 1 + level x 0.3 while live, and
// an animate-ping ring (bg-agent at 30%) while the agent speaks.
import React from 'react';
import {Easing, interpolate} from 'remotion';
import {Icon} from './icons.tsx';
import {LIGHT} from '../theme.ts';
import {aurora, alpha, shadow, useHO, type Mode} from './tokens.ts';

/** --agent-gradient-foreground (#ffffff in both themes). */
const ON_AURORA = LIGHT.primaryForeground;

export type VoiceOrbProps = {
  /** px (the app default is 56; the end card uses 56). */
  size?: number;
  mode?: Mode;
  /** 0..1 voice level; the orb scales 1 -> 1.3. */
  level?: number;
  /**
   * Progress 0..1 through one animate-ping cycle (1 s, cubic-bezier(0,0,.2,1): scale 1 -> 2 and
   * opacity 1 -> 0 by 75%), drawn only while speaking. Pass e.g. ((frame - start) / 30) % 1.
   */
  ping?: number;
  speaking?: boolean;
  /** 0..1 background-position of the aurora (animate-aurora runs 0% -> 100% -> 0% over 12 s). */
  phase?: number;
  /** Whole-orb opacity (the app uses .95 when idle). */
  opacity?: number;
  style?: React.CSSProperties;
};

export const VoiceOrb: React.FC<VoiceOrbProps> = ({size = 56, mode, level = 0, ping = 0, speaking = false, phase = 0, opacity = 1, style}) => {
  const t = useHO(mode);
  const scale = 1 + Math.max(0, Math.min(1, level)) * 0.3;
  const q = ((ping % 1) + 1) % 1;
  const k = interpolate(q, [0, 0.75], [0, 1], {extrapolateRight: 'clamp', easing: Easing.bezier(0, 0, 0.2, 1)});
  const icon = size * 0.38;
  return (
    <span style={{position: 'relative', display: 'inline-flex', flexShrink: 0, alignItems: 'center', justifyContent: 'center', width: size, height: size, opacity, ...style}}>
      {speaking ? <span style={{position: 'absolute', inset: 0, borderRadius: '50%', background: t.agent, opacity: 0.3 * (1 - k), transform: `scale(${1 + k})`}} /> : null}
      <span style={{position: 'absolute', inset: 0, borderRadius: '50%', ...aurora(t, phase), boxShadow: shadow(t, 'glow'), transform: `scale(${scale})`}} />
      <span style={{position: 'absolute', inset: 0, borderRadius: '50%', transform: `scale(${scale})`, background: `radial-gradient(circle at 32% 26%, ${alpha(ON_AURORA, 0.32)}, transparent 62%)`}} />
      <span style={{position: 'relative', color: ON_AURORA, display: 'flex'}}>
        <Icon name="mic" size={icon} />
      </span>
    </span>
  );
};
