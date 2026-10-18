// Dev preview for src/char/Rita.tsx (rig A in the car set, rig B, the S09 lenses).
//   f0    S04 rest: binoculars on her chest, writing tonight's "20s"
//   f30   S04 open: binoculars up in the near hand, far hand writing
//   f60   S10: phone at ear, one brow up, eyes narrowed (1.5× on her face)
//   f90   S13: smirk, glance at camera, glint (1.5×)
//   f120  S16: smug head tilt toward the Starlite, phone at ear (1.4×)
//   f150  S17: sip from the thermos cup
//   f180  S21: asleep at dawn
//   f210  face sheet at 2.2×: neutral / brow / smirk+look / blink
//   f240  S15: lowering the binoculars (far hand), phone at ear
//   f270  S16 toss follow-through, looking at the passenger seat
//   f300  S07 rig B in the bottom half (grip at the end)
//   f330  S09 glasses close-up with the teal lobby reflected, glint sweep
//   f360  S11: leaning over the wheel, phone at ear, writing "Fri 23" (1.25×)
import React from 'react';
import {AbsoluteFill, Easing, interpolate, useCurrentFrame} from 'remotion';
import {loadFonts} from '../fonts.ts';
import {CarInterior, stenoPenTip} from '../set/CarInterior.tsx';
import type {Crop} from '../set/Lobby.tsx';
import {FONT, NIGHT} from '../theme.ts';
import {RitaA, RitaAArt, RitaB, RitaGlasses, padToRest, type RitaPose} from '../char/Rita.tsx';
import {LobbyArt} from '../set/Lobby.tsx';

loadFonts();

const Label: React.FC<{text: string}> = ({text}) => (
  <div style={{position: 'absolute', left: 24, bottom: 24, fontFamily: FONT.mono, fontSize: 26, color: NIGHT.brass, background: 'rgba(7,9,13,0.7)', padding: '6px 12px', borderRadius: 8}}>{text}</div>
);

/** A camera that puts rest point p at frame point `to` at `scale`. */
const camOn = (p: [number, number], scale: number, to: [number, number] = [505, 820]): Crop => ({scale, x: to[0] - 540 - (p[0] - 540) * scale, y: to[1] - 960 - (p[1] - 960) * scale});

const Shot: React.FC<{pose: RitaPose; camera?: Crop; pad?: {tonight?: number}; dawn?: number; label: string; steam?: number}> = ({pose, camera, pad = {tonight: 1}, dawn = 0, label, steam = 0}) => (
  <AbsoluteFill>
    <CarInterior layer="back" camera={camera} dawn={dawn} neon={dawn > 0.5 ? 0 : 1} clock={dawn > 0.5 ? '6:52' : '2:14'} />
    <RitaA layer="body" camera={camera} {...pose} />
    <CarInterior layer="front" camera={camera} pad={pad} dawn={dawn} neon={dawn > 0.5 ? 0 : 1} steam={steam} />
    <RitaA layer="front" camera={camera} {...pose} />
    <Label text={label} />
  </AbsoluteFill>
);

const RitaPreviewComp: React.FC = () => {
  const frame = useCurrentFrame();
  const seg = Math.floor(frame / 30);
  const lf = frame % 30;
  const t = frame / 30;
  const k = lf / 29;
  if (seg === 0 || seg === 1) {
    const p = interpolate(lf, [3, 21], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
    const tip = padToRest(stenoPenTip({tonight: p}));
    return <Shot label={`S04 ${seg ? 'binoculars up (near)' : 'rest'} · pen ${p.toFixed(2)}`} pad={{tonight: p}} pose={{t, pen: 1, penAt: tip, binoculars: seg ? 1 : 0, binocularHand: 'near'}} />;
  }
  if (seg === 2) {
    const brow = interpolate(lf, [0, 6], [0, 1], {extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic)});
    return <Shot label="S10 brow + squint, phone" camera={camOn([440, 790], 1.5)} pose={{t, phoneToEar: 1, browRaise: brow, squint: 0.7, lookX: 0.3}} />;
  }
  if (seg === 3) {
    return <Shot label="S13 smirk, glance, glint" camera={camOn([440, 790], 1.5)} pose={{t, phoneToEar: 1, smirk: 1, lookX: -1, glint: k, browRaise: 0.3}} />;
  }
  if (seg === 4) {
    return <Shot label="S16 head tilt, smug" camera={camOn([440, 800], 1.4)} pose={{t, phoneToEar: 1, smirk: 0.6, headTilt: 7 * k, squint: 0.3}} />;
  }
  if (seg === 5) {
    return <Shot label="S17 sip" pose={{t, sip: k, lookX: 0.5}} steam={1} />;
  }
  if (seg === 6) {
    return <Shot label="S21 asleep, dawn" pose={{t, asleep: 1, dawn: k}} dawn={k} pad={{}} />;
  }
  if (seg === 7) {
    const cells: Array<[string, RitaPose]> = [
      ['neutral', {}],
      ['browRaise 1, squint .6', {browRaise: 1, squint: 0.6}],
      ['smirk 1, look -1', {smirk: 1, lookX: -1}],
      ['blink 1', {blink: 1}],
    ];
    return (
      <AbsoluteFill style={{background: NIGHT.ink}}>
        <svg width={1080} height={1920} viewBox="0 0 1080 1920">
          {cells.map(([name, pose], i) => (
            <g key={name}>
              <g transform={`translate(${(i % 2) * 540 + 300} ${Math.floor(i / 2) * 900 + 760}) scale(1.9) translate(-398 -872)`}>
                <RitaAArt {...pose} t={0} layer="body" />
              </g>
              <text x={(i % 2) * 540 + 30} y={Math.floor(i / 2) * 900 + 60} fill={NIGHT.brass} fontSize={26} fontFamily={FONT.mono}>{name}</text>
            </g>
          ))}
        </svg>
      </AbsoluteFill>
    );
  }
  if (seg === 8) {
    return <Shot label="S15 lowering binoculars" pose={{t, phoneToEar: 1, binoculars: 1 - k, binocularHand: 'far', lookX: 0.4, browRaise: 0.2}} />;
  }
  if (seg === 12) {
    const p = interpolate(lf, [6, 24], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
    const tip = padToRest(stenoPenTip({tonight: 1, fri: p}));
    return <Shot label={`S11 lean, phone, pen "Fri 23" ${p.toFixed(2)}`} camera={camOn([470, 860], 1.25, [505, 860])} pad={{tonight: 1, fri: p} as {tonight: number}} pose={{t, lean: 1, phoneToEar: 1, pen: 1, penAt: tip, browRaise: lf > 20 ? 0.4 : 0}} />;
  }
  if (seg === 9) return <Shot label="S16 toss, look at seat" pose={{t, phoneToEar: 1 - k, phone: k < 0.3, lookX: 0.8, lookY: 0.8, headTilt: 6, smirk: 0.3}} />;
  if (seg === 10) {
    return (
      <AbsoluteFill style={{background: NIGHT.ink}}>
        <AbsoluteFill style={{top: 0, height: 955, background: NIGHT.tealDeep, opacity: 0.6}} />
        <AbsoluteFill style={{top: 965, background: `linear-gradient(180deg, ${NIGHT.wall}, ${NIGHT.ink})`}} />
        <RitaB t={t} grip={k > 0.6 ? 1 : 0} />
        <RitaB t={t} grip={k > 0.6 ? 1 : 0} x={430} y={880} scale={1.8} />
        <div style={{position: 'absolute', left: 0, right: 0, top: 1200, height: 100, border: `2px dashed ${NIGHT.red}`, opacity: 0.5}} />
        <div style={{position: 'absolute', left: 0, right: 0, top: 1540, height: 2, background: NIGHT.red, opacity: 0.6}} />
        <Label text={`S07 rig B · grip ${k > 0.6 ? 1 : 0} (caption band dashed)`} />
      </AbsoluteFill>
    );
  }
  return (
    <AbsoluteFill style={{background: NIGHT.ink}}>
      <RitaGlasses
        drift={12 * k}
        glint={interpolate(lf, [10, 16], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'})}
        chainGlint={k}
        reflection={(l) => (
          <g transform={`translate(${l.cx} ${l.cy}) scale(${l.index ? -0.42 : -0.5} 0.5) translate(-620 -820)`}>
            <LobbyArt tint="teal" phoneState="dark" clock="2:21" />
          </g>
        )}
      />
      <Label text="S09 glasses close-up" />
    </AbsoluteFill>
  );
};

export const preview = {id: 'RitaPreview', component: RitaPreviewComp, durationInFrames: 390};
