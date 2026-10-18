// Dev preview for src/char/Gus.tsx.
//   f0    S22 wide: desk rig at dawn, a placeholder screen, mug down
//   f30   mug raise 0→1 (sip)
//   f60   smile 0→1, 2× on his head
//   f90   S22 push toward the phone (scale 1→3.4)
//   f120  night desk
//   f150  S23 silhouette at the bright window, mug toast 0→1
//   f180  night silhouette with binoculars
import React from 'react';
import {AbsoluteFill, Easing, interpolate, useCurrentFrame} from 'remotion';
import {loadFonts} from '../fonts.ts';
import {FONT, LIGHT, NIGHT} from '../theme.ts';
import {GUS_DESK, GusDesk, GusSilhouette} from '../char/Gus.tsx';

loadFonts();

const Label: React.FC<{text: string}> = ({text}) => (
  <div style={{position: 'absolute', left: 24, bottom: 24, fontFamily: FONT.mono, fontSize: 26, color: NIGHT.brass, background: 'rgba(7,9,13,0.7)', padding: '6px 12px', borderRadius: 8}}>{text}</div>
);

/** Morning office stand-in: a bright window ahead of him, a wall, the desk edge. */
const Office: React.FC<{night?: boolean}> = ({night}) => (
  <AbsoluteFill style={{background: night ? NIGHT.wall : LIGHT.accent}}>
    <div style={{position: 'absolute', left: 140, top: 220, width: 860, height: 900, background: night ? NIGHT.tealDeep : `linear-gradient(180deg, ${LIGHT.background}, ${LIGHT.highlightSoft})`, border: `14px solid ${night ? NIGHT.ink : LIGHT.borderStrong}`}} />
    <div style={{position: 'absolute', left: 0, right: 0, top: 1330, bottom: 0, background: night ? NIGHT.ink : LIGHT.highlightSoftForeground}} />
  </AbsoluteFill>
);

const Screen: React.FC = () => {
  const S = GUS_DESK.screen;
  return (
    <g>
      <rect x={S.x} y={S.y} width={S.w} height={S.h} rx={S.r} fill={LIGHT.background} />
      <rect x={S.x + 16} y={S.y + 60} width={S.w - 32} height={36} rx={18} fill={LIGHT.muted} />
      <rect x={S.x + 16} y={S.y + 120} width={S.w - 32} height={150} rx={12} fill={LIGHT.card} stroke={LIGHT.border} strokeWidth={2} />
      <rect x={S.x + 30} y={S.y + 140} width={60} height={12} rx={4} fill={LIGHT.foreground} />
      <rect x={S.x + 30} y={S.y + 170} width={150} height={10} rx={4} fill={LIGHT.mutedForeground} />
      <rect x={S.x + 30} y={S.y + 230} width={120} height={22} rx={6} fill={LIGHT.primarySoft} />
    </g>
  );
};

const GusPreviewComp: React.FC = () => {
  const frame = useCurrentFrame();
  const seg = Math.floor(frame / 30);
  const lf = frame % 30;
  const k = lf / 29;
  const t = frame / 30;
  if (seg === 0) return (<AbsoluteFill><Office /><GusDesk t={t} screen={<Screen />} /><Label text="S22 desk, dawn" /></AbsoluteFill>);
  if (seg === 1) return (<AbsoluteFill><Office /><GusDesk t={t} mugRaise={k} screen={<Screen />} /><Label text={`mugRaise ${k.toFixed(2)}`} /></AbsoluteFill>);
  if (seg === 2) {
    const cam = {scale: 2, x: 505 - 540 - (360 - 540) * 2, y: 760 - 960 - (800 - 960) * 2};
    return (<AbsoluteFill><Office /><GusDesk t={t} smile={k} camera={cam} screen={<Screen />} /><Label text={`smile ${k.toFixed(2)} at 2×`} /></AbsoluteFill>);
  }
  if (seg === 3) {
    const s = interpolate(k, [0, 1], [1, 3.4], {easing: Easing.bezier(0.22, 1, 0.36, 1)});
    const c = {x: 640, y: 1060};
    const cam = {scale: s, x: 540 - 540 - (c.x - 540) * s + (c.x - 540) * (1 - Math.min(1, (s - 1) / 2.4)) * 0, y: 960 - 960 - (c.y - 960) * s};
    return (<AbsoluteFill><Office /><GusDesk t={t} camera={cam} screen={<Screen />} /><Label text={`push ${s.toFixed(2)}`} /></AbsoluteFill>);
  }
  if (seg === 4) return (<AbsoluteFill><Office night /><GusDesk t={t} light="night" mugRaise={0.3} screen={<Screen />} /><Label text="night desk" /></AbsoluteFill>);
  if (seg === 5) {
    return (
      <AbsoluteFill style={{background: LIGHT.background}}>
        <AbsoluteFill style={{background: `radial-gradient(ellipse at 45% 45%, ${LIGHT.background}, ${LIGHT.highlightSoft})`}} />
        <GusSilhouette t={t} mugRaise={interpolate(lf, [2, 12], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic)})} smile={0.6} />
        <Label text="S23 silhouette, mug toast" />
      </AbsoluteFill>
    );
  }
  return (
    <AbsoluteFill style={{background: NIGHT.wall}}>
      <AbsoluteFill style={{background: `radial-gradient(ellipse at 45% 45%, ${NIGHT.redDeep}, ${NIGHT.ink})`}} />
      <GusSilhouette t={t} light="night" hold="binoculars" />
      <Label text="night silhouette, binoculars" />
    </AbsoluteFill>
  );
};

export const preview = {id: 'GusPreview', component: GusPreviewComp, durationInFrames: 210};
