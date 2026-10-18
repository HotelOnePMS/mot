// S26 · EndCard · 54.5–60.0. Ivory light-theme card in two beats, then the LogoMark keyhole
// irises open onto S27. Frame 0 = 54.5. Captions (AI05) are drawn globally; this draws the orb
// to their left.
import React from 'react';
import {AbsoluteFill, Easing, interpolate, useCurrentFrame} from 'remotion';
import {cue, f, FPS, scene} from '../../timeline.ts';
import {EASE_POP, FONT, INTER_FEATURES, LIGHT} from '../../theme.ts';
import {S26} from '../../marks.ts';
import {Button, Icon, LogoMark, VoiceOrb, Wordmark, alpha} from '../../hotelone/index.ts';
import {KeyholeIris, LOGO_GEOMETRY} from '../../fx/KeyholeIris.tsx';
import {AI05_LEVEL} from './voiceLevel.ts';
import {captionLeft} from './captionEdge.ts';
import {BEAT_B, COL, FINE_PRINT, HEADLINE, LOGO, MARK_ORIGIN, ORB, bandTop} from './layout.ts';

const FROM = scene('EndCard').from;
/** Local frame of an absolute second. */
const at = (sec: number) => f(sec) - FROM;
const ease = Easing.bezier(...EASE_POP);
const clamp = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;

/** Board: "Elements fade up from y 10 to 0". Opacity leads, the 10 px settle trails on EASE_POP. */
const rise = (frame: number, start: number, dur = 12, dy = 10): React.CSSProperties => {
  const p = interpolate(frame, [start, start + dur], [0, 1], {
    ...clamp,
    easing: ease,
  });
  const o = interpolate(frame, [start, start + dur * 0.6], [0, 1], {
    ...clamp,
    easing: Easing.out(Easing.quad),
  });
  return {
    opacity: o,
    transform: `translateY(${(dy * (1 - p)).toFixed(2)}px)`,
  };
};

const AI05 = cue('AI05');

/** Voice level 0..1 at absolute time t, from the measured clip; the band sweep opens it up (phone → room). */
const voiceLevel = (t: number) => {
  const i = Math.floor((t - AI05.at) * FPS);
  if (i < 0 || i >= AI05_LEVEL.length) return 0;
  const gain = interpolate(t, [S26.bandSweep.start, S26.bandSweep.end], [0.72, 1], clamp);
  return AI05_LEVEL[i] * gain;
};

const textBase: React.CSSProperties = {
  position: 'absolute',
  left: COL.left,
  width: COL.width,
  textAlign: 'center',
  whiteSpace: 'nowrap',
};

export type EndCardArtProps = {
  placement: 'organic' | 'paid';
  /** What the keyhole iris opens onto (the film passes S27's first frame). */
  through: React.ReactNode;
};

export const EndCardArt: React.FC<EndCardArtProps> = ({placement, through}) => {
  const frame = useCurrentFrame();
  const t = (FROM + frame) / FPS;

  // ── persistent ──────────────────────────────────────────────
  const logo = rise(frame, at(S26.logo));
  const bar = interpolate(frame, [at(S26.bar.t), at(S26.bar.t) + S26.bar.frames], [0, 1], {...clamp, easing: Easing.out(Easing.cubic)});
  const head1 = rise(frame, at(S26.headline), 14);
  const head2 = rise(frame, at(S26.headline) + 2, 14);
  const fine = rise(frame, at(S26.finePrint), 14, 8);

  // ── orb (Beat A) ────────────────────────────────────────────
  const orbIn = interpolate(frame, [at(S26.orb), at(S26.orb) + 10], [0, 1], {
    ...clamp,
    easing: ease,
  });
  const orbOut = interpolate(frame, [at(S26.orbOut), at(S26.orbOut) + 8], [1, 0], {...clamp, easing: Easing.in(Easing.quad)});
  const orbOpacity = Math.min(orbIn, orbOut);
  const ping = (t - S26.iWill) / 0.8;
  const top = bandTop(placement);
  const orbX = captionLeft(t) - ORB.gap - ORB.size;
  const orbY = top + 50 - ORB.size / 2;

  // ── Beat B ──────────────────────────────────────────────────
  const [bLine, bButton, bUrl] = S26.beatB.map(at);
  const line = rise(frame, bLine, 10);
  const btnP = interpolate(frame, [bButton, bButton + 12], [0, 1], {
    ...clamp,
    easing: ease,
  });
  const btnO = interpolate(frame, [bButton, bButton + 6], [0, 1], clamp);
  // breathes 1→1.02 over 1 s (and back), once it has landed
  const breathe = 0.01 * (1 - Math.cos((Math.max(0, frame - (bButton + 12)) / FPS) * Math.PI));
  const btnScale = (0.94 + 0.06 * btnP) * (1 + breathe);
  const sheen = interpolate(frame, [bButton + 10, bButton + 26], [-0.3, 1.3], {
    ...clamp,
    easing: Easing.inOut(Easing.cubic),
  });
  const url = rise(frame, bUrl, 10);
  const underline = interpolate(frame, [bUrl + 6, bUrl + 6 + S26.bar.frames], [0, 1], {...clamp, easing: Easing.out(Easing.cubic)});

  // ── iris 59.75–60.0 ─────────────────────────────────────────
  // Opens from the white keyhole; reaches 1 on the cut (60.0), so the last end-card frame
  // shows the keyhole at ≈ 40× (the board's number) with the card around it, then S27.
  const irisStart = at(S26.iris.start);
  const iris = interpolate(frame, [irisStart - 1, at(S26.iris.end)], [0, 1], clamp);
  // a small dolly into the keyhole: the card pushes 1→1.08 about the bow centre
  const bow = {
    x: MARK_ORIGIN.x + (LOGO_GEOMETRY.bow.cx * LOGO.mark) / 32,
    y: MARK_ORIGIN.y + (LOGO_GEOMETRY.bow.cy * LOGO.mark) / 32,
  };
  const push = 1 + 0.08 * iris * iris;
  const irisOrigin = {
    x: bow.x + (MARK_ORIGIN.x - bow.x) * push,
    y: bow.y + (MARK_ORIGIN.y - bow.y) * push,
  };
  const arrowNudge = 5 * Math.sin(Math.PI * Math.max(0, Math.min(1, (sheen + 0.3) / 1.6)));

  const fineTop = FINE_PRINT.top[placement];

  return (
    <AbsoluteFill style={{background: LIGHT.background, overflow: 'hidden'}}>
      <AbsoluteFill
        style={{
          transform: push !== 1 ? `scale(${push.toFixed(4)})` : undefined,
          transformOrigin: `${bow.x}px ${bow.y}px`,
        }}
      >
        {/* paper: a soft white lift behind the lockup, a warmer floor under the fine print */}
        <svg width={1080} height={1920} style={{position: 'absolute', inset: 0}}>
          <defs>
            <radialGradient id="ec-lift" cx={COL.x} cy={620} r={1050} gradientUnits="userSpaceOnUse">
              <stop offset="0" stopColor={LIGHT.surface} stopOpacity={0.95} />
              <stop offset="0.5" stopColor={LIGHT.surface} stopOpacity={0.35} />
              <stop offset="1" stopColor={LIGHT.surface} stopOpacity={0} />
            </radialGradient>
            <linearGradient id="ec-floor" x1={0} y1={1150} x2={0} y2={1920} gradientUnits="userSpaceOnUse">
              <stop offset="0" stopColor={LIGHT.surfaceSunken} stopOpacity={0} />
              <stop offset="1" stopColor={LIGHT.muted} stopOpacity={1} />
            </linearGradient>
          </defs>
          <rect width={1080} height={1920} fill="url(#ec-floor)" />
          <rect width={1080} height={1920} fill="url(#ec-lift)" />
        </svg>

        {/* logo lockup, y 330–400 */}
        <div
          style={{
            position: 'absolute',
            left: MARK_ORIGIN.x,
            top: LOGO.top,
            height: LOGO.mark,
            display: 'flex',
            alignItems: 'center',
            gap: LOGO.gap,
            ...logo,
          }}
        >
          <LogoMark size={LOGO.mark} mode="light" threshold={bar} />
          <Wordmark size={LOGO.word} mode="light" color={LIGHT.foreground} style={{transform: 'translateY(-2px)'}} />
        </div>

        {/* headline, y 450–610 */}
        {HEADLINE.lines.map((text, i) => (
          <div
            key={text}
            style={{
              ...textBase,
              top: HEADLINE.top + i * HEADLINE.size * HEADLINE.leading,
              fontFamily: FONT.display,
              fontWeight: 400,
              fontSize: HEADLINE.size,
              lineHeight: HEADLINE.leading,
              letterSpacing: '-0.02em',
              color: LIGHT.foreground,
              ...(i === 0 ? head1 : head2),
            }}
          >
            {text}
          </div>
        ))}

        {/* Beat B: line, button, URL */}
        <div
          style={{
            ...textBase,
            top: BEAT_B.line.top,
            height: BEAT_B.line.height,
            fontFamily: FONT.ui,
            fontFeatureSettings: INTER_FEATURES,
            fontWeight: 600,
            fontSize: BEAT_B.line.size,
            lineHeight: `${BEAT_B.line.height}px`,
            letterSpacing: '-0.01em',
            color: LIGHT.foreground,
            ...line,
          }}
        >
          {BEAT_B.line.text}
        </div>

        <div
          style={{
            position: 'absolute',
            left: COL.left,
            width: COL.width,
            top: BEAT_B.button.top,
            height: BEAT_B.button.height,
            display: 'flex',
            justifyContent: 'center',
            opacity: btnO,
          }}
        >
          <div
            style={{
              transform: `translateY(${(10 * (1 - btnP)).toFixed(2)}px) scale(${btnScale.toFixed(4)})`,
            }}
          >
            <Button
              mode="light"
              size="lg"
              style={{
                position: 'relative',
                overflow: 'hidden',
                height: BEAT_B.button.height,
                padding: `0 ${BEAT_B.button.padX}px`,
                borderRadius: BEAT_B.button.radius,
                fontSize: BEAT_B.button.size,
                lineHeight: '48px',
                fontWeight: 600,
                letterSpacing: '-0.01em',
                fontFeatureSettings: INTER_FEATURES,
                gap: 14,
                boxShadow: `0 1px 2px ${alpha(LIGHT.foreground, 0.08)}, 0 18px 36px -14px ${alpha(LIGHT.primary, 0.55)}, inset 0 1px 0 ${alpha(LIGHT.primaryForeground, 0.14)}`,
              }}
            >
              <span
                style={{
                  position: 'absolute',
                  top: 0,
                  bottom: 0,
                  left: `${(sheen * 100).toFixed(1)}%`,
                  width: 120,
                  marginLeft: -60,
                  transform: 'skewX(-18deg)',
                  background: `linear-gradient(90deg, ${alpha(LIGHT.primaryForeground, 0)}, ${alpha(LIGHT.primaryForeground, 0.22)}, ${alpha(LIGHT.primaryForeground, 0)})`,
                  opacity: sheen > -0.3 && sheen < 1.3 ? 1 : 0,
                }}
              />
              <span style={{position: 'relative'}}>{BEAT_B.button.label}</span>
              <span
                style={{
                  position: 'relative',
                  display: 'flex',
                  transform: `translateX(${arrowNudge.toFixed(2)}px)`,
                }}
              >
                <Icon name="arrow-right" size={40} />
              </span>
            </Button>
          </div>
        </div>

        <div
          style={{
            ...textBase,
            top: BEAT_B.url.top,
            height: BEAT_B.url.height,
            fontFamily: FONT.ui,
            fontFeatureSettings: INTER_FEATURES,
            fontWeight: 600,
            fontSize: BEAT_B.url.size,
            lineHeight: `${BEAT_B.url.height}px`,
            letterSpacing: '-0.02em',
            color: LIGHT.primary,
            ...url,
          }}
        >
          <span style={{position: 'relative', display: 'inline-block'}}>
            {BEAT_B.url.text}
            {/* the logo's brass threshold bar, reused as the link underline */}
            <span
              style={{
                position: 'absolute',
                left: 0,
                bottom: 2,
                height: 4,
                borderRadius: 2,
                width: `${(underline * 100).toFixed(2)}%`,
                background: LIGHT.highlight,
              }}
            />
          </span>
        </div>

        {/* VoiceOrb, left of the AI caption (Beat A). The only violet on the card. */}
        {orbOpacity > 0 ? (
          <div
            style={{
              position: 'absolute',
              left: orbX,
              top: orbY,
              width: ORB.size,
              height: ORB.size,
              opacity: orbOpacity,
              transform: `scale(${(0.85 + 0.15 * orbIn).toFixed(4)})`,
            }}
          >
            <VoiceOrb
              size={ORB.size}
              mode="light"
              level={voiceLevel(t)}
              speaking={ping >= 0 && ping < 1}
              ping={Math.max(0, Math.min(0.999, ping))}
              phase={0.5 + 0.5 * Math.sin((t - S26.orb) * 1.6)}
            />
          </div>
        ) : null}

        {/* fine print, y 1350–1475 (paid: 1100–1225), from 54.9 to the iris */}
        <div
          style={{
            ...textBase,
            top: fineTop,
            fontFamily: FONT.ui,
            fontFeatureSettings: INTER_FEATURES,
            fontWeight: 400,
            fontSize: FINE_PRINT.size,
            lineHeight: FINE_PRINT.leading,
            color: LIGHT.mutedForeground,
            ...fine,
          }}
        >
          {FINE_PRINT.lines.map((l) => (
            <div key={l}>{l}</div>
          ))}
        </div>
      </AbsoluteFill>

      {/* 59.75–60.0: the keyhole irises open onto S27 */}
      <KeyholeIris progress={iris} origin={irisOrigin} size={LOGO.mark * push}>
        {through}
      </KeyholeIris>
    </AbsoluteFill>
  );
};
