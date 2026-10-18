// Dev preview for src/set/CarInterior.tsx.
//   f0–29    S04 rest framing, all layers, tonight's "20s" stroke-drawing with the pen
//   f30–59   S12 top-down pad (StenoPad): "Fri 23", "$119?!", underline, "(I’m $129)" drawing, light bands
//   f60–89   S17: push into the rearview mirror (mirrorCamera), 1 Hz glow, thermos steam
//   f90–119  S21 dawn ramp through the windshield, sign switching off
//   f120–149 back + front layers split (a stand-in block where Rita sits)
import React from 'react';
import {AbsoluteFill, Easing, interpolate, useCurrentFrame} from 'remotion';
import {loadFonts} from '../fonts.ts';
import {CarInterior, StenoPad, mirrorCamera} from '../set/CarInterior.tsx';
import {FONT, NIGHT} from '../theme.ts';

loadFonts();

const pulse = (sec: number) => 0.5 + 0.5 * Math.cos(2 * Math.PI * (sec - 0.5));
const Label: React.FC<{text: string}> = ({text}) => (
  <div style={{position: 'absolute', left: 24, bottom: 24, fontFamily: FONT.mono, fontSize: 26, color: NIGHT.brass, background: 'rgba(7,9,13,0.7)', padding: '6px 12px', borderRadius: 8}}>{text}</div>
);

const CarPreviewComp: React.FC = () => {
  const frame = useCurrentFrame();
  const seg = Math.floor(frame / 30);
  const lf = frame % 30;
  if (seg === 0) {
    const p = interpolate(lf, [3, 21], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
    return (<AbsoluteFill><CarInterior pad={{tonight: p}} pen={p > 0 && p < 1} mirrorPulse={pulse(7 + lf / 30)} /><Label text={`S04 · tonight ${p.toFixed(2)}`} /></AbsoluteFill>);
  }
  if (seg === 1) {
    const t = lf / 29;
    const notes = {tonight: 1, fri: 1, price: interpolate(t, [0, 0.45], [0, 1], {extrapolateRight: 'clamp'}), underline: interpolate(t, [0.45, 0.6], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}), margin: interpolate(t, [0.6, 1], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'})};
    return (
      <AbsoluteFill style={{background: NIGHT.ink}}>
        <StenoPad x={120} y={470} width={840} notes={notes} pen bands={0.8} bandShift={lf * 3} exposure={0.92} lightAmount={0.16} />
        <Label text={`S12 pad · t ${t.toFixed(2)}`} />
      </AbsoluteFill>
    );
  }
  if (seg === 2) {
    const k = interpolate(lf, [0, 29], [0, 1], {easing: Easing.inOut(Easing.cubic)});
    const base = mirrorCamera(300, 520, 480);
    const cam = {...base, scale: base.scale * (1 + 1.4 * k), x: base.x * (1 + 1.4 * k) + (540 - 540 * (1 + 1.4 * k)) * 0, y: base.y};
    // grow about the mirror's centre (540, 640)
    const s = 1 + 1.4 * k;
    const camera = {scale: base.scale * s, ox: 0, oy: 0, x: 540 - (540 - base.x) * s, y: 640 - (640 - base.y) * s};
    void cam;
    return (<AbsoluteFill><CarInterior camera={camera} mirrorPulse={pulse(37 + lf / 20)} steam={1} time={lf / 30} /><Label text={`S17 mirror push ${s.toFixed(2)}`} /></AbsoluteFill>);
  }
  if (seg === 3) {
    const d = lf / 29;
    return (<AbsoluteFill><CarInterior dawn={d} neon={lf > 15 ? 0 : 1} clock="6:52" pad={false} /><Label text={`S21 dawn ${d.toFixed(2)}`} /></AbsoluteFill>);
  }
  return (
    <AbsoluteFill>
      <CarInterior layer="back" />
      <svg width={1080} height={1920} style={{position: 'absolute', inset: 0}}>
        <path d="M180 1180 L240 820 Q300 640 470 640 Q600 650 610 760 L600 900 L640 1180 Z" fill="#1a1013" />
      </svg>
      <CarInterior layer="front" pad={{tonight: 1}} />
      <Label text="back / Rita stand-in / front" />
    </AbsoluteFill>
  );
};

export const preview = {id: 'CarPreview', component: CarPreviewComp, durationInFrames: 150};
