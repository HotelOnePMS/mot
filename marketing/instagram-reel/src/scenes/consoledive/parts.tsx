// S14 parts: the backdrop, the brand lockup, the House rules card, the docking rate cell,
// kinetic text and the whip-pan streaks. All driven by props (scene-local frame values).
import React from 'react';
import {Easing, random} from 'remotion';
import {DARK, EASE_POP, FONT, INTER_FEATURES, NIGHT} from '../../theme.ts';
import {Card, HO, HOUSE_RULES, HouseRulesField, Logo, QUEEN_FRI, RateCell, Screen, alpha, shadow} from '../../hotelone/index.ts';
import {CARD, CARD_CSS_W, CELL, EYEBROW, HEAD, LOCKUP, SUB, Z} from './layout.ts';

export const c01 = (v: number) => Math.max(0, Math.min(1, v));
export const pop = Easing.bezier(...EASE_POP);
const ramp = (frame: number, a: number, b: number) => c01((frame - a) / (b - a));

// ─── Backdrop ──────────────────────────────────────────────────────────────

const BOKEH = Array.from({length: 11}, (_, i) => {
  const r = (k: string) => random(`cd-bokeh-${k}-${i}`);
  return {x: 40 + r('x') * 1000, y: 420 + r('y') * 1260, r: 14 + r('r') * 60, a: 0.04 + r('a') * 0.08, vx: (r('vx') - 0.3) * 0.5, vy: -0.25 - r('vy') * 0.45};
});

/** Ink with the console's dark-teal air: a lifted centre behind the card, a teal bloom where the voice came from,
 *  and a few out-of-focus particles left over from the dive (pre-blurred discs, no filters). */
export const Backdrop: React.FC<{frame: number; resolve: number}> = ({frame, resolve}) => {
  const k = c01(resolve);
  return (
    <svg width={1080} height={1920} viewBox="0 0 1080 1920" style={{position: 'absolute', inset: 0, overflow: 'visible'}}>
      <defs>
        <radialGradient id="cd-lift" cx={505} cy={900} r={1080} gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={DARK.surface} />
          <stop offset="0.45" stopColor={DARK.background} />
          <stop offset="1" stopColor={NIGHT.ink} />
        </radialGradient>
        <radialGradient id="cd-bloom" cx={505} cy={880} r={760} gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={NIGHT.teal} stopOpacity={0.2} />
          <stop offset="0.4" stopColor={NIGHT.teal} stopOpacity={0.07} />
          <stop offset="1" stopColor={NIGHT.teal} stopOpacity={0} />
        </radialGradient>
        <radialGradient id="cd-disc">
          <stop offset="0" stopColor={NIGHT.tealSoft} stopOpacity={0.9} />
          <stop offset="0.5" stopColor={NIGHT.teal} stopOpacity={0.45} />
          <stop offset="1" stopColor={NIGHT.teal} stopOpacity={0} />
        </radialGradient>
      </defs>
      <rect x={-1600} width={4280} height={1920} fill={NIGHT.ink} />
      <rect x={-1600} width={4280} height={1920} fill="url(#cd-lift)" opacity={0.85 * k} />
      <rect x={-1600} width={4280} height={1920} fill="url(#cd-bloom)" opacity={0.55 + 0.45 * (1 - k) + 0.25 * k} />
      {BOKEH.map((b, i) => (
        <circle
          key={i}
          cx={b.x + b.vx * frame}
          cy={b.y + b.vy * frame}
          r={b.r * (1 + 0.04 * Math.sin(frame / 9 + i))}
          fill="url(#cd-disc)"
          opacity={b.a * k}
        />
      ))}
    </svg>
  );
};

// ─── Brand lockup ──────────────────────────────────────────────────────────

/** The film's first brand mark: LogoMark 40 (dark: tile #30a7cf, keyhole #0c1017, sill #e1ae47) + Wordmark 30
 *  + "· Voice front desk". `t` 0..1 entrance, `sill` 0..1 draws the brass threshold bar. */
export const Lockup: React.FC<{t: number; sill: number}> = ({t, sill}) => {
  const e = pop(c01(t));
  const sub = pop(c01(t * 1.25 - 0.25));
  return (
    <div style={{position: 'absolute', left: LOCKUP.x, top: LOCKUP.y, height: LOCKUP.mark, display: 'flex', alignItems: 'center', gap: 14, whiteSpace: 'nowrap'}}>
      <div style={{opacity: c01(e * 1.4), transform: `translateY(${(1 - e) * 14}px) scale(${0.86 + 0.14 * e})`, transformOrigin: '20px 20px'}}>
        <Logo mode="dark" markSize={LOCKUP.mark} wordSize={LOCKUP.word} gap={12} keyhole={DARK.background} threshold={sill} color={DARK.foreground} />
      </div>
      <span
        style={{
          fontFamily: FONT.ui,
          fontFeatureSettings: INTER_FEATURES,
          fontWeight: 500,
          fontSize: LOCKUP.sub,
          lineHeight: '30px',
          color: DARK.mutedForeground,
          opacity: sub,
          transform: `translateX(${(1 - sub) * -10}px)`,
          marginTop: 3,
        }}
      >
        · Voice front desk
      </span>
    </div>
  );
};

// ─── House rules card ──────────────────────────────────────────────────────

export type CardState = {
  /** 0..1 card entrance (opacity, y +20 → 0). */
  enter: number;
  /** 0..1 focus ring (the field lights on the UI tick). */
  lit: number;
  /** 0..1 extra flash on the tick, decaying. */
  flash: number;
  /** 0..1 teal edge glow left by the particles, decaying. */
  glow: number;
  /** Opacity of rule 1 and of rules 2–3. */
  first: number;
  rest: number;
  /** 0..1 highlight sweep across rule 1. */
  highlight: number;
};

/** A crop of the real "How it sounds" card: the fields above House rules fade out above the crop, so the
 *  shot never claims House rules is the first field. Narrow layout at Z (2.2x). */
export const HouseRulesCard: React.FC<CardState> = ({enter, lit, flash, glow, first, rest, highlight}) => {
  const e = pop(c01(enter));
  const mask = `linear-gradient(to bottom, transparent ${CARD.fadeFrom - CARD.top + 40}px, #000 ${CARD.fadeTo - CARD.top + 40}px)`;
  const ring = NIGHT.tealBright; // DARK.ring
  const cardShadow = [
    shadow(HO.dark, 'float'),
    `0 0 0 ${0.6 * glow}px ${alpha(NIGHT.tealSoft, 0.6 * glow)}`,
    `0 0 ${30}px ${alpha(NIGHT.teal, 0.28 * glow)}`,
    // a long contact shadow so the card lifts off the lifted backdrop
    `0 40px 80px -20px ${alpha(NIGHT.ink, 0.9)}`,
  ].join(', ');
  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        top: CARD.top - 40,
        width: 1080,
        height: CARD.bottom - CARD.top + 160,
        opacity: c01(e * 1.15),
        transform: `translateY(${(1 - e) * 20}px)`,
        maskImage: mask,
        WebkitMaskImage: mask,
      }}
    >
      <div style={{position: 'absolute', left: CARD.x, top: 40}}>
        <Screen mode="dark" zoom={Z} width={CARD_CSS_W} background={false}>
          <Card mode="dark" shadowKind="float" style={{padding: `0 20px 20px`, boxShadow: cardShadow}}>
            <div style={{height: CARD.padTopCss}} />
            <div style={{position: 'relative'}}>
              <HouseRulesField
                mode="dark"
                tone="sunken"
                borderAlpha={0.5}
                hintOpacity={0.2}
                hintBlur={1.1}
                lines={[
                  {text: HOUSE_RULES[0], opacity: first, highlight},
                  {text: HOUSE_RULES[1], opacity: rest},
                  {text: HOUSE_RULES[2], opacity: rest},
                ]}
              />
              {/* focus-visible: border-ring + ring-[3px] ring-ring/25 — the field lights */}
              {lit > 0 ? (
                <div
                  style={{
                    position: 'absolute',
                    left: 0,
                    right: 0,
                    top: 28,
                    height: 126,
                    borderRadius: 12,
                    border: `1px solid ${ring}`,
                    boxSizing: 'border-box',
                    opacity: lit,
                    boxShadow: `0 0 0 3px ${alpha(ring, 0.25 + 0.2 * flash)}, 0 0 ${8 + 14 * flash}px ${alpha(ring, 0.1 + 0.3 * flash)}`,
                    pointerEvents: 'none',
                  }}
                />
              ) : null}
            </div>
          </Card>
        </Screen>
      </div>
    </div>
  );
};

// ─── Rate cell ─────────────────────────────────────────────────────────────

/** Damped step response that first reaches 1 at `rise` frames (framer-motion bounce .18 → damping ratio .82). */
export const springIn = (t: number, rise: number, bounce = 0.18) => {
  if (t <= 0) return 0;
  const z = 1 - bounce;
  const r = Math.sqrt(1 - z * z);
  const w = (Math.PI - Math.acos(z)) / (r * rise);
  const wd = w * r;
  return 1 - Math.exp(-z * w * t) * (Math.cos(wd * t) + (z / r) * Math.sin(wd * t));
};

/** One rate-calendar cell in its sm+ rendering (bg #191e29, border #2b303b) with the "Queen Room · Fri" eyebrow,
 *  springing in from the right. `s` is the spring value (0 off-frame right → 1 docked). */
export const RateCellDock: React.FC<{s: number; tock: number}> = ({s, tock}) => {
  if (s <= 0) return null;
  const dx = (1 - s) * CELL.travel;
  const rot = (1 - s) * CELL.tilt;
  const eb = c01(s * 1.4 - 0.4);
  return (
    <>
      <div
        style={{
          position: 'absolute',
          left: EYEBROW.right - 400,
          width: 400,
          top: EYEBROW.top,
          textAlign: 'right',
          fontFamily: FONT.ui,
          fontFeatureSettings: INTER_FEATURES,
          fontWeight: 500,
          fontSize: EYEBROW.size,
          lineHeight: `${EYEBROW.lh}px`,
          color: DARK.mutedForeground,
          opacity: eb,
          transform: `translateX(${dx * 0.85}px)`,
          whiteSpace: 'nowrap',
        }}
      >
        Queen Room · Fri
      </div>
      <div style={{position: 'absolute', left: CELL.x, top: CELL.y, transform: `translateX(${dx}px) rotate(${rot}deg) scale(${1 + 0.02 * tock})`, transformOrigin: '50% 100%'}}>
        <Screen mode="dark" zoom={CELL.zoom} width={CELL.cssW} background={false}>
          <RateCell
            {...QUEEN_FRI}
            width={CELL.cssW}
            mode="dark"
            style={{
              background: DARK.surfaceRaised,
              boxShadow: `${shadow(HO.dark, 'float')}, 0 18px 40px -10px ${alpha(NIGHT.ink, 0.95)}, 0 0 ${14 * tock}px ${alpha(NIGHT.teal, 0.35 * tock)}`,
            }}
          />
        </Screen>
      </div>
    </>
  );
};

// ─── Kinetic text ──────────────────────────────────────────────────────────

/** Words rising one after another (y +rise → 0, EASE_POP over `dur` frames, `stagger` frames apart). */
export const RiseWords: React.FC<{
  text: string;
  frame: number;
  at: number;
  stagger?: number;
  dur?: number;
  rise?: number;
  style: React.CSSProperties;
  cx: number;
  top: number;
}> = ({text, frame, at, stagger = 2, dur = 12, rise = 36, style, cx, top}) => {
  const words = text.split(' ');
  if (frame < at) return null;
  return (
    <div style={{position: 'absolute', left: cx - 480, width: 960, top, textAlign: 'center', whiteSpace: 'nowrap', ...style}}>
      {words.map((w, i) => {
        const p = pop(ramp(frame, at + i * stagger, at + i * stagger + dur));
        return (
          <span key={i} style={{display: 'inline-block', opacity: c01(p * 1.5), transform: `translateY(${(1 - p) * rise}px)`, marginRight: i < words.length - 1 ? '0.26em' : 0}}>
            {w}
          </span>
        );
      })}
    </div>
  );
};

export const Headline: React.FC<{frame: number; at: number}> = ({frame, at}) => (
  <RiseWords
    text="Gus typed it once."
    frame={frame}
    at={at}
    stagger={2}
    dur={13}
    rise={40}
    cx={HEAD.cx}
    top={HEAD.top}
    style={{
      fontFamily: FONT.display,
      fontWeight: 600,
      fontSize: HEAD.size,
      lineHeight: `${HEAD.lh}px`,
      letterSpacing: '-0.015em',
      color: NIGHT.ivory,
      textShadow: `0 2px 0 ${NIGHT.ink}, 0 0 28px ${NIGHT.ink}`,
    }}
  />
);

export const SubLine: React.FC<{frame: number; at: number}> = ({frame, at}) => (
  <RiseWords
    text="His prices. His rules."
    frame={frame}
    at={at}
    stagger={2}
    dur={11}
    rise={24}
    cx={SUB.cx}
    top={SUB.top}
    style={{
      fontFamily: FONT.ui,
      fontFeatureSettings: INTER_FEATURES,
      fontWeight: 600,
      fontSize: SUB.size,
      lineHeight: `${SUB.lh}px`,
      letterSpacing: '-0.01em',
      color: DARK.mutedForeground,
    }}
  />
);

// ─── Whip-pan streaks ──────────────────────────────────────────────────────

const STREAKS = Array.from({length: 26}, (_, i) => {
  const r = (k: string) => random(`cd-streak-${k}-${i}`);
  return {y: 120 + r('y') * 1680, len: 260 + r('l') * 900, x: r('x') * 1400 - 200, w: 1 + r('w') * 3.5, a: 0.18 + r('a') * 0.5, teal: r('c') > 0.35};
});

/** Horizontal speed lines for the whip (screen-space, they slide left with the pan). `v` 0..1 velocity. */
export const WhipStreaks: React.FC<{v: number; travel: number}> = ({v, travel}) => {
  if (v <= 0.01) return null;
  return (
    <svg width={1080} height={1920} viewBox="0 0 1080 1920" style={{position: 'absolute', inset: 0}}>
      <defs>
        <linearGradient id="cd-streak-t" x1="0" x2="1">
          <stop offset="0" stopColor={NIGHT.teal} stopOpacity={0} />
          <stop offset="0.6" stopColor={NIGHT.tealSoft} stopOpacity={1} />
          <stop offset="1" stopColor={NIGHT.teal} stopOpacity={0} />
        </linearGradient>
        <linearGradient id="cd-streak-i" x1="0" x2="1">
          <stop offset="0" stopColor={NIGHT.ivory} stopOpacity={0} />
          <stop offset="0.6" stopColor={NIGHT.ivory} stopOpacity={1} />
          <stop offset="1" stopColor={NIGHT.ivory} stopOpacity={0} />
        </linearGradient>
      </defs>
      {STREAKS.map((s, i) => {
        const len = s.len * (0.4 + v);
        const x = ((s.x - travel * (0.6 + 0.8 * (i % 3) / 2)) % 1700 + 1700) % 1700 - 300;
        return <rect key={i} x={x} y={s.y} width={len} height={s.w} rx={s.w / 2} fill={s.teal ? 'url(#cd-streak-t)' : 'url(#cd-streak-i)'} opacity={s.a * v} />;
      })}
    </svg>
  );
};

