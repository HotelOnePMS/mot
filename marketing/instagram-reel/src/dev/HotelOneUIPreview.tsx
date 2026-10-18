// Dev preview for src/hotelone/: the faithful UI rebuilds placed roughly where
// the board's shots put them (scenes own the final composition).
//   f0–29    S14  dark: lockup, How it sounds card cropped to House rules at 2.6x, rate cell, eyebrow (highlight sweeps)
//   f30–59   S20  dark inbox at 1.8x (~490 CSS px): Rita's strip at 30%, Sam's row dimmed except the total, marker circles
//   f60–89   S22  light page at 3x: To handle · 2 | Done · 0, Rita's row (focus ring), Sam's top edge
//   f90–119  S24  2.4x: Mark done tap, row slides out, pill springs to To handle · 1 | Done · 1, list closes up
//   f120–149 S25  2.6x: Sam's row first, brass marker, Copy booking link tap, sonner toast
//   f150–179 S26  end-card pieces: Logo 64/56, lg button, VoiceOrb 56, URL
//   f180–209 fidelity: the whole voice Messages page (light) and the How it sounds card (dark) at 1.35x
//   f210–239 parts sheet: badges, buttons, segmented controls, rate cells, toasts at 2x
import React from 'react';
import {AbsoluteFill, Easing, interpolate, spring, useCurrentFrame} from 'remotion';
import {loadFonts} from '../fonts.ts';
import {
  Badge,
  Button,
  COPY_TOAST,
  HowItSoundsCard,
  HOUSE_RULES,
  inbox,
  LAYOUT_SPRING,
  Logo,
  MessagesList,
  RateCell,
  QUEEN_FRI,
  SAVED_TOAST,
  Screen,
  SegmentedControl,
  SonnerToast,
  ToastViewport,
  VoiceMessagesPage,
  VoiceOrb,
} from '../hotelone/index.ts';
import {DARK, FONT, LIGHT, NIGHT} from '../theme.ts';
import {GenericPhone} from '../ui/GenericPhone.tsx';

loadFonts();

const Tag: React.FC<{text: string; light?: boolean}> = ({text, light}) => (
  <div style={{position: 'absolute', left: 24, bottom: 24, fontFamily: FONT.mono, fontSize: 24, color: light ? LIGHT.highlightSoftForeground : NIGHT.brass, background: light ? 'rgba(251,250,248,0.9)' : 'rgba(7,9,13,0.75)', padding: '6px 12px', borderRadius: 8}}>{text}</div>
);

const clamp = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;

// ─── S14 ────────────────────────────────────────────────────────────────────
const S14: React.FC<{lf: number}> = ({lf}) => {
  const hl = interpolate(lf, [4, 14], [0, 1], clamp);
  const dock = spring({frame: lf - 12, fps: 30, config: {damping: 14, stiffness: 160, mass: 0.8}});
  // House rules label sits ~430 CSS px into the card at a 363 px viewport; show from just above Greeting's end.
  const zoom = 2.6;
  const cardW = 331;
  const scroll = 404;
  const visible = 500 / zoom;
  return (
    <AbsoluteFill style={{background: `radial-gradient(90% 60% at 50% 45%, ${DARK.background} 0%, ${NIGHT.ink} 100%)`}}>
      <div style={{position: 'absolute', left: 105, width: 800, top: 300, textAlign: 'center', fontFamily: FONT.display, fontWeight: 600, fontSize: 72, color: NIGHT.ivory, opacity: 0.35}}>Gus typed it once.</div>
      {/* lockup */}
      <div style={{position: 'absolute', left: 80, top: 580, height: 50, display: 'flex', alignItems: 'center', gap: 14}}>
        <Logo mode="dark" markSize={40} wordSize={30} gap={12} color={NIGHT.ivory} keyhole={DARK.background} />
        <span style={{fontFamily: FONT.ui, fontWeight: 500, fontSize: 24, color: DARK.mutedForeground}}>· Voice front desk</span>
      </div>
      {/* the card, cropped: faded in from above (Greeting's tail) and out below (the hint) */}
      <div style={{position: 'absolute', left: 80, top: 640, width: cardW * zoom, height: 500, maskImage: 'linear-gradient(to bottom, transparent 0px, #000 120px, #000 440px, transparent 500px)', WebkitMaskImage: 'linear-gradient(to bottom, transparent 0px, #000 120px, #000 440px, transparent 500px)'}}>
        <Screen mode="dark" zoom={zoom} width={cardW} height={visible} scrollY={scroll} background={false}>
          <HowItSoundsCard
            mode="dark"
            shadowKind="float"
            hintOpacity={0.2}
            hintBlur={1.2}
            lines={[{text: HOUSE_RULES[0], highlight: hl}, {text: HOUSE_RULES[1], opacity: 0.4}, {text: HOUSE_RULES[2], opacity: 0.4}]}
          />
        </Screen>
      </div>
      {/* eyebrow + rate cell docking at the card's top-right corner */}
      <div style={{position: 'absolute', right: 140, top: 530, fontFamily: FONT.ui, fontWeight: 500, fontSize: 20, lineHeight: '22px', color: DARK.mutedForeground, opacity: dock}}>Queen Room · Fri</div>
      <div style={{position: 'absolute', left: 772 + (1 - dock) * 260, top: 560, opacity: interpolate(dock, [0, 0.3], [0, 1], clamp)}}>
        <Screen mode="dark" zoom={1.82} width={92} background={false}>
          <RateCell {...QUEEN_FRI} mode="dark" style={{boxShadow: `0 8px 16px -4px rgba(${DARK.shadow},0.5), 0 24px 64px -12px rgba(${DARK.shadow},0.8)`, background: DARK.surfaceRaised}} />
        </Screen>
      </div>
      <Tag text={`S14 · dark · card 2.6x · cell 1.82x · lf ${lf}`} />
    </AbsoluteFill>
  );
};

// ─── S20 ────────────────────────────────────────────────────────────────────
const S20: React.FC<{lf: number}> = ({lf}) => {
  const c1 = interpolate(lf, [2, 10], [0, 1], clamp);
  const c2 = interpolate(lf, [8, 16], [0, 1], clamp);
  const c3 = interpolate(lf, [16, 24], [0, 1], clamp);
  const zoom = 1.8;
  return (
    <AbsoluteFill style={{background: DARK.background}}>
      <div style={{position: 'absolute', left: 64, top: 925, fontFamily: FONT.mono, fontSize: 28, color: NIGHT.tealSoft}}>The Starlite · inbox</div>
      <div style={{position: 'absolute', left: 64, top: 980}}>
        <Screen mode="dark" zoom={zoom} width={490} height={500 / zoom} background={false}>
          <MessagesList
            mode="dark"
            requests={inbox('night')}
            fx={{
              rita: {opacity: 0.3, maxHeight: 70 / zoom},
              sam: {dimMessage: {opacity: 0.4, blur: 1.1}, email: {opacity: 0.4}, phone: {circle: c2}, total: {circle: c3}},
            }}
          />
        </Screen>
      </div>
      <div style={{position: 'absolute', left: 64, top: 700, fontFamily: FONT.ui, color: DARK.mutedForeground, fontSize: 26}}>marker circle (lock screen) {Math.round(c1 * 100)}%</div>
      <Tag text={`S20 · dark · 1.8x · 490 CSS px · lf ${lf}`} />
    </AbsoluteFill>
  );
};

// ─── S22 ────────────────────────────────────────────────────────────────────
const S22: React.FC<{lf: number}> = ({lf}) => {
  const focus = interpolate(lf, [6, 14], [0, 1], clamp);
  return (
    <AbsoluteFill style={{background: LIGHT.background}}>
      <div style={{position: 'absolute', left: 0, top: 300}}>
        <Screen mode="light" zoom={3} width={360} height={1300 / 3}>
          <VoiceMessagesPage mode="light" requests={inbox('morning')} fx={{rita: {focus}}} scrollY={150} />
        </Screen>
      </div>
      <Tag light text={`S22 · light · 3x · 360 CSS px · lf ${lf}`} />
    </AbsoluteFill>
  );
};

// ─── S24 ────────────────────────────────────────────────────────────────────
const S24: React.FC<{lf: number}> = ({lf}) => {
  // lf 0 = 51.0 s
  const press = interpolate(lf, [1.5, 2.5, 4], [0, 1, 0], clamp);
  const slide = interpolate(lf, [3, 10.5], [0, 1], {...clamp, easing: Easing.in(Easing.cubic)});
  const seg = spring({frame: lf - 9, fps: 30, config: LAYOUT_SPRING});
  const close = spring({frame: lf - 10.5, fps: 30, config: {damping: 18, stiffness: 240, mass: 0.6}});
  const updated = lf >= 9;
  const done = lf >= 15;
  const reqs = inbox('morning').map((r) => (r.id === 'rita' && done ? {...r, status: 'DONE' as const} : r));
  return (
    <AbsoluteFill style={{background: LIGHT.background}}>
      <div style={{position: 'absolute', left: 72, top: 330}}>
        <Screen mode="light" zoom={2.4} width={390} height={1150 / 2.4}>
          <VoiceMessagesPage
            mode="light"
            requests={reqs}
            scrollY={178}
            openCount={2}
            clip
            segment={{
              options: updated ? ['To handle · 1', 'Done · 1'] : ['To handle · 2', 'Done · 0'],
              value: 0,
              from: updated && !done ? {options: ['To handle · 2', 'Done · 0'], progress: seg} : undefined,
            }}
            fx={done ? {} : {rita: {markDone: {pressed: press, hover: press}, x: -50 * slide, opacity: 1 - slide, collapse: lf >= 10.5 ? close : 0}}}
          />
        </Screen>
      </div>
      <Tag light text={`S24 · light · 2.4x · t ${(51 + lf / 30).toFixed(2)}`} />
    </AbsoluteFill>
  );
};

// ─── S25 ─────────────────────────────────────────────────────────────────────
const S25: React.FC<{lf: number}> = ({lf}) => {
  // lf 0 = 51.5 s (the preview compresses the shot: marker 0-12, tap 14, toast 16-28)
  const marker = interpolate(lf, [0, 12], [0, 1], {...clamp, easing: Easing.inOut(Easing.cubic)});
  const press = interpolate(lf, [14, 15, 17], [0, 1, 0], clamp);
  const toast = interpolate(lf, [16, 28], [0, 1], clamp);
  // GenericPhone 1040 px wide = 2.6 frame px per CSS px; its 380 x 800 screen hosts the console at 380 CSS px.
  const W = 1040;
  const reqs = inbox('morning').map((r) => (r.id === 'rita' ? {...r, status: 'DONE' as const} : r));
  return (
    <AbsoluteFill style={{background: LIGHT.background}}>
      <div style={{position: 'absolute', left: 20, top: 380}}>
        <GenericPhone width={W} screen="custom" theme="light" time="6:53" screenBg={LIGHT.background}>
          <div style={{position: 'absolute', top: 52, left: 0}}>
            <Screen mode="light" width={380} height={748}>
              <VoiceMessagesPage mode="light" requests={reqs} openCount={2} scrollY={150} fx={{sam: {total: {marker}, copy: {pressed: press}}}} />
              <ToastViewport enter={toast}>
                <SonnerToast title={COPY_TOAST} />
              </ToastViewport>
            </Screen>
          </div>
        </GenericPhone>
      </div>
      <Tag light text={`S25 · phone 2.6x · sticky header · lf ${lf}`} />
    </AbsoluteFill>
  );
};

// ─── S26 ────────────────────────────────────────────────────────────────────
const S26: React.FC<{lf: number}> = ({lf}) => {
  const th = interpolate(lf, [1, 9], [0, 1], clamp);
  const breathe = 1 + 0.02 * Math.sin((lf / 30) * Math.PI);
  return (
    <AbsoluteFill style={{background: LIGHT.background}}>
      <div style={{position: 'absolute', left: 105, width: 800, top: 330, display: 'flex', justifyContent: 'center'}}>
        <Logo mode="light" markSize={64} wordSize={56} gap={20} threshold={th} />
      </div>
      <div style={{position: 'absolute', left: 105, width: 800, top: 450, textAlign: 'center', fontFamily: FONT.display, fontWeight: 400, fontSize: 68, lineHeight: 1.08, color: LIGHT.foreground}}>
        If nobody picks up
        <br />
        in 20 seconds, it does.
      </div>
      <div style={{position: 'absolute', left: 105, width: 800, top: 790, display: 'flex', justifyContent: 'center'}}>
        <div style={{zoom: 100 / 48, transform: `scale(${breathe})`}}>
          <Button size="lg" iconRight="arrow-right" mode="light" style={{fontWeight: 600}}>
            Start free
          </Button>
        </div>
      </div>
      <div style={{position: 'absolute', left: 105, width: 800, top: 930, textAlign: 'center', fontFamily: FONT.ui, fontWeight: 600, fontSize: 60, color: LIGHT.primary}}>hotelone.site</div>
      <div style={{position: 'absolute', left: 105, width: 800, top: 1200, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 24}}>
        <VoiceOrb mode="light" size={56} level={0.35 + 0.25 * Math.sin(lf / 3)} speaking ping={(lf / 30) % 1} phase={lf / 360} />
        <span style={{fontFamily: FONT.ui, fontWeight: 600, fontSize: 52, color: LIGHT.primary}}>I will.</span>
      </div>
      <Tag light text={`S26 · end-card parts · lf ${lf}`} />
    </AbsoluteFill>
  );
};

// ─── Fidelity: the real page and card at 1.35x ─────────────────────────────
const Fidelity: React.FC = () => (
  <AbsoluteFill style={{background: NIGHT.ink}}>
    <div style={{position: 'absolute', left: 6, top: 120}}>
      <Screen mode="light" zoom={1.35} width={390} height={1700 / 1.35}>
        <VoiceMessagesPage mode="light" requests={inbox('morning')} />
      </Screen>
    </div>
    <div style={{position: 'absolute', left: 548, top: 120}}>
      <Screen mode="dark" zoom={1.35} width={390} height={1700 / 1.35}>
        <div style={{padding: '20px 16px'}}>
          <HowItSoundsCard mode="dark" />
          <div style={{height: 24}} />
          <MessagesList mode="dark" requests={inbox('night')} />
        </div>
      </Screen>
    </div>
    <Tag text="fidelity · 390 CSS px · 1.35x" />
  </AbsoluteFill>
);

// ─── Parts sheet ────────────────────────────────────────────────────────────
const Parts: React.FC<{lf: number}> = ({lf}) => {
  const sp = spring({frame: lf - 4, fps: 30, config: {damping: 16, stiffness: 220, mass: 0.7}});
  const sheet = (mode: 'light' | 'dark') => (
    <Screen mode={mode} zoom={2} width={260} style={{padding: 12, borderRadius: 16}}>
      <div style={{display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'flex-start'}}>
        <div style={{display: 'flex', gap: 6, flexWrap: 'wrap'}}>
          <Badge variant="outline" size="sm" icon="phone" color={mode === 'light' ? LIGHT.mutedForeground : DARK.mutedForeground}>
            Phone call
          </Badge>
          <Badge variant="success" size="sm" icon="circle-check">
            Ready
          </Badge>
          <Badge variant="agent">AI</Badge>
        </div>
        <div style={{display: 'flex', gap: 6, flexWrap: 'wrap'}}>
          <Button size="sm">Save</Button>
          <Button size="sm" variant="secondary" icon="check">
            Mark done
          </Button>
          <Button size="sm" variant="ghost" icon="copy" paddingX={8} color={mode === 'light' ? LIGHT.primary : DARK.primary}>
            Copy booking link
          </Button>
          <Button size="sm" variant="outline">
            Add a question
          </Button>
        </div>
        <SegmentedControl size="sm" options={['To handle · 1', 'Done · 1']} value={0} from={{options: ['To handle · 2', 'Done · 0'], progress: sp}} />
        <SegmentedControl size="sm" options={['To handle · 2', 'Done · 0']} value={lf >= 15 ? 1 : 0} from={lf >= 15 ? {value: 0, progress: spring({frame: lf - 15, fps: 30, config: {damping: 16, stiffness: 220, mass: 0.7}})} : undefined} />
        <div style={{display: 'flex', gap: 4}}>
          <RateCell {...QUEEN_FRI} width={76} />
          <RateCell day={24} price={139} sold={11} total={12} isCustom weekend width={76} />
          <RateCell day={25} price={109} sold={2} total={12} width={76} isToday />
        </div>
        <SonnerToast title={mode === 'light' ? COPY_TOAST : SAVED_TOAST} width={236} />
      </div>
    </Screen>
  );
  return (
    <AbsoluteFill style={{background: NIGHT.wall}}>
      <div style={{position: 'absolute', left: 10, top: 120}}>{sheet('light')}</div>
      <div style={{position: 'absolute', left: 10, top: 1000}}>{sheet('dark')}</div>
      <Tag text={`parts · 2x · lf ${lf}`} />
    </AbsoluteFill>
  );
};

const HotelOneUIPreviewComp: React.FC = () => {
  const frame = useCurrentFrame();
  const seg = Math.floor(frame / 30);
  const lf = frame % 30;
  if (seg === 0) return <S14 lf={lf} />;
  if (seg === 1) return <S20 lf={lf} />;
  if (seg === 2) return <S22 lf={lf} />;
  if (seg === 3) return <S24 lf={lf} />;
  if (seg === 4) return <S25 lf={lf} />;
  if (seg === 5) return <S26 lf={lf} />;
  if (seg === 6) return <Fidelity />;
  return <Parts lf={lf} />;
};


export const preview = {id: 'HotelOneUIPreview', component: HotelOneUIPreviewComp, durationInFrames: 240};
