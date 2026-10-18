// S20 TOP panel: a print of Rita's FRONT DESK phone lying on her counter, lock
// screen lit: big "2:14", the missed-call card "Missed call / (928) 555-0147 /
// 2:13 AM". Generic OS, in the same visual language as ui/GenericPhone (red
// wallpaper, ivory notification card), re-laid out large so the number reads
// at phone size inside the 840 x 320 crop. Panel-local px.
import React from 'react';
import {Icon} from '../../hotelone/index.ts';
import {PHONE_BEZEL} from '../../ui/GenericPhone.tsx';
import {alpha, mix} from '../../set/parts.tsx';
import {DARK, FONT, INTER_FEATURES, LIGHT, NIGHT} from '../../theme.ts';
import {TOP} from './layout.ts';

/** The phone in the crop (panel-local). It runs off the bottom of the print. */
export const PHONE_BOX = {x: 150, y: 10, w: 560, bezel: 13, radius: 66};
const SCREEN = {x: PHONE_BOX.x + PHONE_BOX.bezel, y: PHONE_BOX.y + PHONE_BOX.bezel, w: PHONE_BOX.w - PHONE_BOX.bezel * 2};
/** The notification card, screen-local. */
const CARD = {left: 16, top: 176, h: 106, r: 26};
const TILE = 58;

/**
 * "(928) 555-0147" on the card, panel-local: measured on the render (glyph box x 277–547, y 259–288, re-measured
 * in the film), padded so the hand-drawn loop (radius wobble and a 3% inward start) clears the glyph corners and
 * runs between the title line and the card's bottom edge.
 */
export const LOCK_NUMBER = {cx: 412, cy: 274, rx: 186, ry: 27};

const UI: React.CSSProperties = {fontFamily: FONT.ui, fontFeatureSettings: INTER_FEATURES, WebkitFontSmoothing: 'antialiased'};

/** Brass call bell seen from above, cropped by the print's left edge. */
const Bell: React.FC<{x: number; y: number; r: number}> = ({x, y, r}) => (
  <svg width={TOP.w} height={TOP.h} style={{position: 'absolute', inset: 0}} aria-hidden>
    <defs>
      <radialGradient id="knot-bell" cx={x - r * 0.3} cy={y - r * 0.35} r={r * 1.2} gradientUnits="userSpaceOnUse">
        <stop offset="0" stopColor={NIGHT.brassLight} />
        <stop offset="0.35" stopColor={NIGHT.brass} />
        <stop offset="0.85" stopColor={mix(NIGHT.brass, NIGHT.ink, 0.7)} />
        <stop offset="1" stopColor={NIGHT.ink} />
      </radialGradient>
    </defs>
    <ellipse cx={x + 10} cy={y + 14} rx={r * 1.18} ry={r * 1.08} fill={NIGHT.ink} opacity={0.6} />
    <circle cx={x} cy={y} r={r * 1.12} fill={mix(NIGHT.ink, NIGHT.redDeep, 0.5)} stroke={alpha(NIGHT.red, 0.35)} strokeWidth={2} />
    <circle cx={x} cy={y} r={r} fill="url(#knot-bell)" />
    <path d={`M${x + r * 0.25} ${y - r * 0.95} A ${r} ${r} 0 0 1 ${x + r * 0.97} ${y + r * 0.1}`} fill="none" stroke={NIGHT.redSoft} strokeOpacity={0.55} strokeWidth={3} strokeLinecap="round" />
    <circle cx={x} cy={y} r={r * 0.2} fill={mix(NIGHT.brass, NIGHT.ink, 0.5)} />
    <circle cx={x - r * 0.05} cy={y - r * 0.06} r={r * 0.12} fill={NIGHT.brassLight} />
  </svg>
);

export const LockPanel: React.FC<{glow?: number}> = ({glow = 0}) => {
  const sw = SCREEN.w;
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        overflow: 'hidden',
        borderRadius: 18,
        background: `radial-gradient(70% 120% at 92% -10%, ${alpha(NIGHT.red, 0.3)} 0%, ${alpha(NIGHT.red, 0)} 70%), linear-gradient(172deg, ${mix(NIGHT.redDeep, NIGHT.ink, 0.25)} 0%, ${mix(NIGHT.redDeep, NIGHT.ink, 0.7)} 55%, ${NIGHT.ink} 100%)`,
      }}
    >
      {/* counter laminate: a few long, faint grain lines */}
      <svg width={TOP.w} height={TOP.h} style={{position: 'absolute', inset: 0}} aria-hidden>
        {[38, 96, 141, 203, 251, 297].map((y, i) => (
          <path key={y} d={`M0 ${y} C 280 ${y + (i % 2 ? 6 : -5)} 560 ${y + (i % 2 ? -4 : 7)} ${TOP.w} ${y + 2}`} fill="none" stroke={NIGHT.redSoft} strokeOpacity={0.05} strokeWidth={1.4} />
        ))}
      </svg>
      <Bell x={46} y={250} r={56} />

      {/* the phone: body, then the lit screen (it runs off the bottom of the print) */}
      <div
        style={{
          position: 'absolute',
          left: PHONE_BOX.x,
          top: PHONE_BOX.y,
          width: PHONE_BOX.w,
          height: 640,
          borderRadius: PHONE_BOX.radius,
          background: `linear-gradient(115deg, ${alpha(NIGHT.red, 0.18)} 0%, ${PHONE_BEZEL} 20%, ${PHONE_BEZEL} 80%, ${alpha(NIGHT.red, 0.3)} 100%), ${PHONE_BEZEL}`,
          boxShadow: `inset 0 0 0 2px ${alpha(NIGHT.red, 0.42)}, inset 0 0 0 5px ${PHONE_BEZEL}, inset 0 0 0 6px ${alpha(NIGHT.ink, 0.9)}, 18px 26px 40px -10px ${alpha(NIGHT.ink, 0.95)}, 0 0 ${60 + 40 * glow}px ${alpha(NIGHT.phoneGlow, 0.06 + 0.1 * glow)}`,
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: SCREEN.x,
          top: SCREEN.y,
          width: sw,
          height: 640,
          borderRadius: PHONE_BOX.radius - PHONE_BOX.bezel,
          overflow: 'hidden',
          background: `radial-gradient(120% 70% at 50% 0%, ${NIGHT.redDeep} 0%, ${DARK.background} 58%, ${NIGHT.ink} 100%)`,
          ...UI,
        }}
      >
        {/* punch-hole camera + status icons */}
        <div style={{position: 'absolute', left: sw / 2 - 9, top: 13, width: 18, height: 18, borderRadius: '50%', background: `radial-gradient(circle at 40% 38%, ${DARK.accent} 0%, ${NIGHT.ink} 60%)`}} />
        <div style={{position: 'absolute', right: 34, top: 14, display: 'flex', gap: 8, alignItems: 'center', opacity: 0.85}}>
          <svg width={22} height={15} viewBox="0 0 18 12" aria-hidden>
            {[0, 1, 2, 3].map((i) => (
              <rect key={i} x={i * 4.6} y={9 - i * 3} width={3.2} height={3 + i * 3} rx={0.8} fill={NIGHT.ivory} />
            ))}
          </svg>
          <svg width={32} height={16} viewBox="0 0 27 13" aria-hidden>
            <rect x={0.75} y={0.75} width={22} height={11.5} rx={3.2} fill="none" stroke={NIGHT.ivory} strokeOpacity={0.5} strokeWidth={1.5} />
            <rect x={3} y={3} width={13} height={7} rx={1.6} fill={NIGHT.ivory} />
            <rect x={24} y={4.2} width={2} height={4.6} rx={1} fill={NIGHT.ivory} opacity={0.5} />
          </svg>
        </div>
        {/* lock glyph and the big time */}
        <div style={{position: 'absolute', left: 0, right: 0, top: 30, display: 'flex', justifyContent: 'center'}}>
          <Icon name="lock" size={24} color={NIGHT.ivory} strokeWidth={2.2} />
        </div>
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: 52,
            textAlign: 'center',
            fontSize: 126,
            lineHeight: 1,
            fontWeight: 500,
            letterSpacing: '-0.05em',
            color: NIGHT.ivory,
            fontVariantNumeric: 'tabular-nums',
            textShadow: `0 4px 30px ${alpha(NIGHT.ink, 0.5)}`,
          }}
        >
          2:14
        </div>
        {/* the missed-call card */}
        <div
          style={{
            position: 'absolute',
            left: CARD.left,
            right: CARD.left,
            top: CARD.top,
            height: CARD.h,
            borderRadius: CARD.r,
            background: alpha(NIGHT.ivory, 0.97),
            boxShadow: `0 14px 34px -12px ${alpha(NIGHT.ink, 0.85)}, 0 0 ${44 * glow}px ${alpha(NIGHT.ivory, 0.3 * glow)}`,
            display: 'flex',
            alignItems: 'center',
            gap: 18,
            padding: '0 24px 0 18px',
            boxSizing: 'border-box',
          }}
        >
          <div style={{width: TILE, height: TILE, borderRadius: 16, background: LIGHT.destructive, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0}}>
            <Icon name="phone-missed" size={30} color={NIGHT.ivory} strokeWidth={2.2} />
          </div>
          <div style={{flex: 1, minWidth: 0}}>
            <div style={{display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10}}>
              <span style={{fontSize: 30, lineHeight: '36px', fontWeight: 600, color: LIGHT.foreground}}>Missed call</span>
              <span style={{fontSize: 24, lineHeight: '30px', fontWeight: 500, color: LIGHT.mutedForeground, whiteSpace: 'nowrap'}}>2:13 AM</span>
            </div>
            <div style={{marginTop: 8, fontSize: 34, lineHeight: '40px', fontWeight: 500, color: LIGHT.foreground, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap'}}>(928) 555-0147</div>
          </div>
        </div>
        {/* glass sheen */}
        <div style={{position: 'absolute', inset: 0, background: `linear-gradient(118deg, ${alpha(NIGHT.ivory, 0.07)} 0%, transparent 30%, transparent 100%)`}} />
      </div>
      {/* print edge: a hairline sheen so the photo reads as an object on the board */}
      <div style={{position: 'absolute', inset: 0, borderRadius: 18, boxShadow: `inset 0 0 0 1.5px ${alpha(NIGHT.redSoft, 0.22)}, inset 0 -40px 60px -30px ${alpha(NIGHT.ink, 0.7)}`}} />
    </div>
  );
};
