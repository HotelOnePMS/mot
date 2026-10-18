// Dev preview for src/fx/*. 30-frame sections:
//   f0–29     S02 Binoculars (red/cyan fringe, drift, teal streaks) over the teal Lobby, series bug
//   f30–59    S27-style Gus lenses (teal fringe, 1 px drift) over the red Lobby + LensGlint (6-frame hold from f40)
//   f60–89    Grade split (x) + HeadlightSweep right→left
//   f90–119   Grade night→light flip sweeping up (progress over the section)
//   f120–149  RedString + MarkerCircles on an ink board
//   f150–179  ParticleDive (21 frames from f150)
//   f180–209  KeyholeIris from a 64 px LogoMark on ivory (8 frames from f190)
//   f210–239  GlobalFx on gradients, and a 4× magnified patch
import React from 'react';
import {AbsoluteFill, interpolate, useCurrentFrame} from 'remotion';
import {loadFonts} from '../fonts.ts';
import {DARK, FONT, LIGHT, NIGHT} from '../theme.ts';
import {Lobby} from '../set/Lobby.tsx';
import {LogoMark} from '../hotelone/Logo.tsx';
import {BINO, Binoculars} from '../fx/Binoculars.tsx';
import {Grade} from '../fx/Grade.tsx';
import {HeadlightSweep} from '../fx/HeadlightSweep.tsx';
import {glintEnvelope, LensGlint} from '../fx/LensGlint.tsx';
import {MarkerCircle, RedString} from '../fx/RedString.tsx';
import {ParticleDive} from '../fx/ParticleDive.tsx';
import {KeyholeIris} from '../fx/KeyholeIris.tsx';
import {Dither} from '../fx/Dither.tsx';
import {Grain} from '../fx/Grain.tsx';
import {GlobalFx} from '../fx/GlobalFx.tsx';

loadFonts();

const Tag: React.FC<{text: string}> = ({text}) => (
  <div style={{position: 'absolute', left: 24, bottom: 24, fontFamily: FONT.mono, fontSize: 24, color: NIGHT.brass, background: 'rgba(7,9,13,0.75)', padding: '6px 12px', borderRadius: 8}}>{text}</div>
);

const Bug: React.FC = () => (
  <div style={{position: 'absolute', left: 80, top: 300, fontFamily: FONT.ui, fontWeight: 500, fontSize: 26, color: DARK.mutedForeground}}>Across the Street · Ep. 1</div>
);

const FxPreviewComp: React.FC = () => {
  const frame = useCurrentFrame();
  const sec = Math.floor(frame / 30);
  const t = frame % 30;
  if (sec === 0)
    return (
      <AbsoluteFill>
        <Binoculars centers={BINO.S02.centers} r={BINO.S02.r} rim="redCyan" drift={3} streaks={0.12} seed="s02" overlay={<Bug />}>
          <Lobby tint="teal" phoneState="ringing" ringPulse={t < 10 ? 1 : 0.4} crop={{scale: 1.15, x: 0, y: 0, ox: 505, oy: 935}} />
        </Binoculars>
        <Tag text={`Binoculars S02 f${frame}`} />
      </AbsoluteFill>
    );
  if (sec === 1)
    return (
      <AbsoluteFill>
        <Binoculars centers={BINO.S03.centers} r={BINO.S03.r} rim="teal" drift={1} seed="s27">
          <Lobby tint="red" phoneState="ringing" crop={{scale: 1.1, x: 0, y: 0, ox: 505, oy: 935}} />
        </Binoculars>
        <LensGlint x={700} y={760} size={40} intensity={glintEnvelope(frame, 40, 6)} halo={NIGHT.redSoft} />
        <Tag text={`Binoculars teal + glint f${frame}`} />
      </AbsoluteFill>
    );
  if (sec === 2)
    return (
      <AbsoluteFill>
        <Lobby tint="red" phoneState="ringing" />
        <Grade look="split" axis="x" red="start" amount={1} />
        <HeadlightSweep progress={interpolate(t, [2, 26], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'})} y={700} />
        <Tag text={`Grade split + headlight f${frame}`} />
      </AbsoluteFill>
    );
  if (sec === 3)
    return (
      <AbsoluteFill>
        <Lobby tint="teal" phoneState="dark" />
        <Grade look="teal" flip={t / 29} />
        <Tag text={`Grade flip ${(t / 29).toFixed(2)}`} />
      </AbsoluteFill>
    );
  if (sec === 4) {
    const a = {x: 640, y: 720};
    const b = {x: 470, y: 1265};
    return (
      <AbsoluteFill style={{background: NIGHT.wall}}>
        <div style={{position: 'absolute', left: 120, top: 560, width: 800, height: 320, borderRadius: 32, background: DARK.surface, border: `1px solid ${DARK.border}`}} />
        <div style={{position: 'absolute', left: 480, top: 690, fontFamily: FONT.mono, fontSize: 40, color: NIGHT.ivory}}>(928) 555-0147</div>
        <div style={{position: 'absolute', left: 120, top: 960, width: 800, height: 520, borderRadius: 32, background: DARK.surface, border: `1px solid ${DARK.border}`}} />
        <div style={{position: 'absolute', left: 290, top: 1245, fontFamily: FONT.ui, fontSize: 34, fontWeight: 500, color: DARK.primary}}>+1 (928) 555-0147</div>
        <MarkerCircle cx={640} cy={716} rx={190} ry={52} progress={t / 8} seed="m1" />
        <MarkerCircle cx={430} cy={1265} rx={190} ry={48} progress={(t - 5) / 8} seed="m2" tilt={4} />
        <RedString from={a} to={b} progress={(t - 12) / 14} sag={36} />
        <MarkerCircle cx={760} cy={1420} rx={120} ry={120} progress={(t - 10) / 12} seed="ring" color={NIGHT.ivory} width={3} wobble={0.05} />
        <Tag text={`RedString f${frame}`} />
      </AbsoluteFill>
    );
  }
  if (sec === 5)
    return (
      <AbsoluteFill style={{background: DARK.background}}>
        <div style={{position: 'absolute', left: 80, top: 640, width: 860, height: 460, borderRadius: 36, background: DARK.surface, border: `1px solid ${DARK.border}`, opacity: interpolate(t, [12, 20], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'})}} />
        <ParticleDive progress={t / 21} />
        <Tag text={`ParticleDive ${(t / 21).toFixed(2)}`} />
      </AbsoluteFill>
    );
  if (sec === 6)
    return (
      <AbsoluteFill style={{background: LIGHT.background}}>
        <LogoMark size={64} mode="light" style={{position: 'absolute', left: 300, top: 333}} />
        <div style={{position: 'absolute', left: 105, width: 800, top: 450, fontFamily: FONT.display, fontSize: 68, lineHeight: 1.08, color: LIGHT.foreground, textAlign: 'center'}}>
          If nobody picks up
          <br />
          in 20 seconds, it does.
        </div>
        <KeyholeIris progress={(t - 10) / 8} origin={{x: 300, y: 333}} size={64}>
          <Lobby tint="red" phoneState="ringing" />
        </KeyholeIris>
        <Tag text={`KeyholeIris ${((t - 10) / 8).toFixed(2)}`} />
      </AbsoluteFill>
    );
  // sec 7: GlobalFx test
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{background: `linear-gradient(180deg, ${NIGHT.ink} 0%, ${NIGHT.wall} 30%, ${NIGHT.wallLow} 45%, #808080 70%, ${LIGHT.background} 100%)`}} />
      <GlobalFx />
      <div style={{position: 'absolute', left: 540, top: 300, width: 400, height: 400, overflow: 'hidden', border: `2px solid ${NIGHT.brass}`}}>
        <div style={{position: 'absolute', left: 0, top: 0, width: 1080, height: 1920, transform: 'scale(4)', transformOrigin: '0 0', isolation: 'isolate'}}>
          <AbsoluteFill style={{background: `linear-gradient(90deg, ${NIGHT.wall}, ${NIGHT.wallLow} 20%, #808080 25%)`}} />
          <Dither amount={0.07} />
          <Grain amount={0.12} />
        </div>
      </div>
      <Tag text={`GlobalFx f${frame}`} />
    </AbsoluteFill>
  );
};

export const preview = {id: 'FxPreview', component: FxPreviewComp, durationInFrames: 240};
