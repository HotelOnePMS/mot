// Gus's phone in the morning: the HotelOne console (light, narrow 380 CSS px layout) under a phone status bar,
// and a soft, flat thumb for the S24/S25 taps.
import React from 'react';
import {AbsoluteFill} from 'remotion';
import {COPY_TOAST, Screen, SonnerToast, ToastViewport, VoiceMessagesPage, inbox, type GuestRequest, type RowFx} from '../../hotelone/index.ts';
import {GenericPhone, PHONE} from '../../ui/GenericPhone.tsx';
import {LIGHT, NIGHT} from '../../theme.ts';
import {alpha, mix, useUid} from '../../set/parts.tsx';

/** Status-bar height of the custom phone screen (CSS px); the console starts below it. */
export const STATUS_H = 52;
export const CSS_W = PHONE.screen.w; // 380
export const PHONE_TIME = '6:53';

/** The morning inbox: Rita's row done (S24 after the tap) or still open. */
export const morningRequests = (ritaDone: boolean): GuestRequest[] =>
  inbox('morning').map((r) => (r.id === 'rita' && ritaDone ? {...r, status: 'DONE' as const} : r));

export type ConsoleState = {
  requests: GuestRequest[];
  fx?: Record<string, RowFx | undefined>;
  segment?: React.ComponentProps<typeof VoiceMessagesPage>['segment'];
  /** Page scroll in CSS px (the console header stays pinned). */
  scroll: number;
  /** 0..1 the sonner toast's entry (S25). */
  toast?: number;
};

/** The 380 x 800 CSS px screen content: status bar (drawn by GenericPhone) + the console below it. */
const Content: React.FC<ConsoleState> = ({requests, fx, segment, scroll, toast = 0}) => (
  <div style={{position: 'absolute', top: STATUS_H, left: 0}}>
    <Screen mode="light" width={CSS_W} height={PHONE.screen.h - STATUS_H}>
      <VoiceMessagesPage mode="light" requests={requests} fx={fx} segment={segment} openCount={2} scrollY={scroll} clip />
      {toast > 0 ? (
        <ToastViewport enter={toast}>
          <SonnerToast title={COPY_TOAST} />
        </ToastViewport>
      ) : null}
    </Screen>
  </div>
);

/** The whole phone (body + bezel) `width` px wide at (x, y). */
export const MorningPhone: React.FC<ConsoleState & {x: number; y: number; width: number}> = ({x, y, width, ...state}) => (
  <div style={{position: 'absolute', left: x, top: y}}>
    <GenericPhone width={width} screen="custom" theme="light" time={PHONE_TIME} screenBg={LIGHT.background} rim={LIGHT.border} rimAmount={0.6}>
      <Content {...state} />
    </GenericPhone>
  </div>
);

/** Only the screen (no body), laid out at `zoom` frame px per CSS px, rounded like Gus's phone screen. */
export const MorningScreen: React.FC<ConsoleState & {zoom: number; radius: number}> = ({zoom, radius, ...state}) => (
  <div style={{position: 'relative', width: CSS_W * zoom, height: PHONE.screen.h * zoom, borderRadius: radius, overflow: 'hidden', background: LIGHT.background}}>
    <GenericPhone width={CSS_W * zoom} screen="custom" theme="light" time={PHONE_TIME} screenBg={LIGHT.background} frame={false}>
      <Content {...state} />
    </GenericPhone>
  </div>
);

/** Console CSS point (inside the console Screen, below the status bar) -> frame px for a MorningPhone. */
export const phoneToFrame = (p: {x: number; y: number}, at: {x: number; y: number; width: number}) => {
  const k = at.width / PHONE.w;
  return {x: at.x + (PHONE.bezel + p.x) * k, y: at.y + (PHONE.bezel + STATUS_H + p.y) * k};
};

// ─── Thumb ──────────────────────────────────────────────────────────────────

const SKIN = mix(mix(NIGHT.tape, NIGHT.redSoft, 0.32), LIGHT.highlightSoftForeground, 0.14);
const SKIN_EDGE = mix(SKIN, LIGHT.highlightSoftForeground, 0.38);
const SKIN_HI = mix(SKIN, LIGHT.surface, 0.3);

/**
 * Gus's thumb from the bottom-right, as one soft flat shape (no detailed hand). `tip` = the pad's contact point
 * (frame px), `angle` = the direction from the base to the tip (deg, 0 = straight up, negative = toward the left),
 * `w` = width. `press` 0..1 pushes the pad down onto the glass (the shadow tightens under it).
 */
export const Thumb: React.FC<{tip: {x: number; y: number}; angle?: number; w?: number; press?: number; opacity?: number}> = ({tip, angle = -38, w = 210, press = 0, opacity = 1}) => {
  const uid = useUid('th');
  if (opacity <= 0) return null;
  const L = 1500;
  const r = w / 2;
  // local: tip pad centre at (0, 0) a little below the very end; the thumb runs down +y
  const body = `M${-r} ${-r * 0.2} Q${-r} ${-r * 1.25} 0 ${-r * 1.3} Q${r} ${-r * 1.25} ${r} ${-r * 0.2} L${r * 1.18} ${L} L${-r * 1.18} ${L} Z`;
  const lift = 1 - press;
  return (
    <AbsoluteFill style={{pointerEvents: 'none', opacity}}>
      <svg width={1080} height={1920} viewBox="0 0 1080 1920" style={{position: 'absolute', inset: 0, overflow: 'visible'}}>
        <defs>
          <linearGradient id={`${uid}s`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor={SKIN_EDGE} />
            <stop offset="0.3" stopColor={SKIN} />
            <stop offset="0.62" stopColor={SKIN_HI} />
            <stop offset="1" stopColor={SKIN_EDGE} />
          </linearGradient>
          <radialGradient id={`${uid}sh`}>
            <stop offset="0" stopColor={NIGHT.ink} stopOpacity={0.3 + 0.12 * press} />
            <stop offset="1" stopColor={NIGHT.ink} stopOpacity={0} />
          </radialGradient>
          <linearGradient id={`${uid}n`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={mix(SKIN_HI, LIGHT.surface, 0.35)} />
            <stop offset="1" stopColor={mix(SKIN, NIGHT.redSoft, 0.2)} />
          </linearGradient>
        </defs>
        <g transform={`translate(${tip.x} ${tip.y}) rotate(${angle})`}>
          {/* soft shadow on the glass, offset away from the light, tightening as the pad lands */}
          <g transform={`translate(${18 + 30 * lift} ${30 + 40 * lift})`}>
            <ellipse cx={0} cy={r * 1.6} rx={r * (1.5 + 0.4 * lift)} ry={r * 3.2} fill={`url(#${uid}sh)`} />
          </g>
          <g transform={`scale(${1 + 0.035 * lift})`}>
            <path d={body} fill={`url(#${uid}s)`} />
            {/* nail */}
            <path d={`M${-r * 0.56} ${r * 0.2} Q${-r * 0.6} ${-r * 0.92} 0 ${-r * 0.98} Q${r * 0.6} ${-r * 0.92} ${r * 0.56} ${r * 0.2} Q0 ${r * 0.42} ${-r * 0.56} ${r * 0.2} Z`} fill={`url(#${uid}n)`} />
            <path d={`M${-r * 0.36} ${-r * 0.66} Q0 ${-r * 0.86} ${r * 0.3} ${-r * 0.7}`} fill="none" stroke={alpha(LIGHT.surface, 0.75)} strokeWidth={r * 0.07} strokeLinecap="round" />
            {/* knuckle creases */}
            <path d={`M${-r * 0.5} ${r * 1.5} Q0 ${r * 1.36} ${r * 0.5} ${r * 1.5} M${-r * 0.36} ${r * 1.7} Q0 ${r * 1.6} ${r * 0.4} ${r * 1.72}`} fill="none" stroke={alpha(SKIN_EDGE, 0.8)} strokeWidth={3} strokeLinecap="round" />
          </g>
        </g>
      </svg>
    </AbsoluteFill>
  );
};
