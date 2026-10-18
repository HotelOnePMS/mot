// Dev preview for src/ui/Counter.tsx at the board's positions.
//   f0–29    S02 hero: label RINGING (30 px teal) over a 200 px ivory value; pop frames at f0/f1; teal hold from f20
//   f30–59   S07 seam: RINGING (26 px) on its own row, 180 px value on an ink pill centred on (505, 960)
//   f60–89   S18/S19 inline red "RINGING 0:20" at 72 px, white flash at 0:20, then MISSED CALL flip from f75
//   f90–119  S27: #fa9e9e label over a 140 px ivory value
import React from 'react';
import {AbsoluteFill, interpolate, useCurrentFrame} from 'remotion';
import {loadFonts} from '../fonts.ts';
import {Counter} from '../ui/Counter.tsx';
import {FONT, NIGHT} from '../theme.ts';

loadFonts();

const Guide: React.FC<{y: number; h: number; label: string}> = ({y, h, label}) => (
  <div style={{position: 'absolute', left: 0, right: 0, top: y, height: h, borderTop: '1px dashed rgba(225,174,71,0.35)', borderBottom: '1px dashed rgba(225,174,71,0.35)'}}>
    <span style={{position: 'absolute', right: 8, top: 2, fontFamily: FONT.mono, fontSize: 16, color: 'rgba(225,174,71,0.6)'}}>{label}</span>
  </div>
);

const Tag: React.FC<{text: string}> = ({text}) => (
  <div style={{position: 'absolute', left: 24, bottom: 24, fontFamily: FONT.mono, fontSize: 24, color: NIGHT.brass, background: 'rgba(7,9,13,0.75)', padding: '6px 12px', borderRadius: 8}}>{text}</div>
);

/** Centre a block on x 505 with its top at y. */
const At: React.FC<{y: number; children: React.ReactNode; cx?: number}> = ({y, children, cx = 505}) => (
  <div style={{position: 'absolute', left: cx - 500, width: 1000, top: y, display: 'flex', justifyContent: 'center'}}>{children}</div>
);

const CounterPreviewComp: React.FC = () => {
  const frame = useCurrentFrame();
  const seg = Math.floor(frame / 30);
  const lf = frame % 30;
  const values = ['0:14', '0:16', '0:18', '0:19', '0:20'];
  if (seg === 0) {
    const i = Math.min(values.length - 1, Math.floor(lf / 5));
    const since = lf % 5;
    const value = lf >= 20 ? '0:20' : values[i];
    return (
      <AbsoluteFill style={{background: NIGHT.ink}}>
        <Guide y={370} h={30} label="label y 370" />
        <Guide y={400} h={160} label="value y 400–560" />
        <At y={366}>
          <Counter label="RINGING" labelSize={30} value={value} since={lf >= 20 ? lf - 20 : since} size={200} variant={lf >= 20 ? 'teal' : 'ivory'} gap={20} />
        </At>
        <Tag text={`S02 · ${value} · since ${lf >= 20 ? lf - 20 : since}`} />
      </AbsoluteFill>
    );
  }
  if (seg === 1) {
    const value = lf < 15 ? '0:13' : '0:16';
    return (
      <AbsoluteFill style={{background: `linear-gradient(180deg, ${NIGHT.tealDeep} 0%, ${NIGHT.wall} 50%, ${NIGHT.ink} 50.5%, ${NIGHT.wall} 100%)`}}>
        <div style={{position: 'absolute', left: 0, right: 0, top: 955, height: 10, background: NIGHT.ink}} />
        <Guide y={800} h={30} label="label y 800–830" />
        <Guide y={856} h={208} label="pill y 856–1064" />
        <At y={800}>
          <span style={{fontFamily: FONT.mono, fontWeight: 500, fontSize: 26, letterSpacing: '0.16em', color: NIGHT.tealSoft}}>RINGING</span>
        </At>
        <At y={856}>
          <Counter value={value} since={lf % 15} size={180} pill />
        </At>
        <Tag text={`S07 · seam · pill · since ${lf % 15}`} />
      </AbsoluteFill>
    );
  }
  if (seg === 2) {
    const steps = [
      {f: 0, v: '0:19'},
      {f: 6, v: '0:20'},
      {f: 12, v: '0:21'},
      {f: 18, v: '0:41'},
      {f: 22, v: 'MISSED CALL'},
    ];
    const cur = [...steps].reverse().find((s) => lf >= s.f)!;
    const since = lf - cur.f;
    const flash = cur.v === '0:20' ? interpolate(since, [0, 1, 4], [1, 1, 0], {extrapolateRight: 'clamp'}) : 0;
    return (
      <AbsoluteFill style={{background: `radial-gradient(70% 50% at 50% 50%, ${NIGHT.redDeep} 0%, ${NIGHT.ink} 100%)`}}>
        <Guide y={1120} h={80} label="y 1120–1200" />
        <At y={1134}>
          <Counter label="RINGING" value={cur.v} since={since} size={72} layout="inline" variant="red" flash={flash} gap={28} />
        </At>
        <Tag text={`S18/S19 · ${cur.v} · since ${since}`} />
      </AbsoluteFill>
    );
  }
  return (
    <AbsoluteFill style={{background: NIGHT.ink}}>
      <Guide y={380} h={30} label="label y 380–410" />
      <Guide y={420} h={140} label="value y 420–560" />
      <At y={378}>
        <Counter label="RINGING" labelSize={26} labelColor={NIGHT.redSoft} value={lf < 15 ? '0:18' : '0:19'} since={lf % 15} size={140} gap={12} />
      </At>
      <Tag text="S27 · red-soft label · ivory value" />
    </AbsoluteFill>
  );
};

export const preview = {id: 'CounterPreview', component: CounterPreviewComp, durationInFrames: 120};
