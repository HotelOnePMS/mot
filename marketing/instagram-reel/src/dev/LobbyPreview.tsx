// Dev preview for src/set/Lobby.tsx: the shared lobby in each of its jobs.
//   f0–29    red, S01 frame 0 (HOOK_CROP), ringing
//   f30–59   red, S01 push 1.06 with the trill buzz, window neon dip, the glint
//   f60–89   teal, S02 framing (~0.55) through where the binoculars sit, ringing
//   f90–119  teal, S03/S08 dark phone + dust
//   f120–149 red, S19 pull-back/pan (0.92, x -260), phone soft-focus, glint
//   f150–179 red, missed (lock screen) at S19 crop
//   f180–209 teal, blinds closed ('none'), dark
import React from 'react';
import {AbsoluteFill, interpolate, Easing, useCurrentFrame} from 'remotion';
import {loadFonts} from '../fonts.ts';
import {Lobby, HOOK_CROP, buzzOffset, lobbyToFrame, LOBBY} from '../set/Lobby.tsx';
import {FONT, NIGHT} from '../theme.ts';

loadFonts();

const Label: React.FC<{text: string}> = ({text}) => (
  <div style={{position: 'absolute', left: 24, bottom: 24, fontFamily: FONT.mono, fontSize: 26, color: NIGHT.brass, background: 'rgba(7,9,13,0.7)', padding: '6px 12px', borderRadius: 8}}>{text}</div>
);

/** Mock of the S01 text block (owned by the ColdOpen scene), only to judge the set under it. */
const HookMock: React.FC<{question?: boolean}> = ({question = true}) => (
  <AbsoluteFill>
    <div style={{position: 'absolute', left: 505 - 520, top: 230, width: 1040, height: 500, background: 'radial-gradient(closest-side, rgba(7,9,13,0.55), rgba(7,9,13,0.55) 55%, rgba(7,9,13,0))'}} />
    <div style={{position: 'absolute', left: 105, width: 800, top: 300, textAlign: 'center', fontFamily: FONT.mono, fontWeight: 500, fontSize: 44, letterSpacing: '0.08em', color: NIGHT.brass}}>2:13 AM</div>
    <div style={{position: 'absolute', left: 65, width: 880, top: 370, textAlign: 'center', fontFamily: FONT.ui, fontWeight: 600, fontSize: 72, lineHeight: 1.08, color: NIGHT.ivory}}>Nobody works nights<br />at the Starlite.</div>
    {question ? <div style={{position: 'absolute', left: 65, width: 880, top: 580, textAlign: 'center', fontFamily: FONT.ui, fontWeight: 600, fontSize: 54, color: NIGHT.ivory}}>So who picks up at <span style={{fontFamily: FONT.mono, fontWeight: 500, color: NIGHT.tealSoft}}>0:20</span>?</div> : null}
  </AbsoluteFill>
);

const LobbyPreviewComp: React.FC = () => {
  const frame = useCurrentFrame();
  const seg = Math.floor(frame / 30);
  const lf = frame % 30;
  if (seg === 0) return (<AbsoluteFill><Lobby tint="red" crop={HOOK_CROP} />{lf >= 15 ? <HookMock question={lf >= 22} /> : null}<Label text="red · HOOK_CROP · ringing" /></AbsoluteFill>);
  if (seg === 1) {
    const s = interpolate(lf, [0, 29], [1, 1.06], {easing: Easing.inOut(Easing.cubic)});
    return (
      <AbsoluteFill>
        <Lobby tint="red" crop={{scale: s, x: 0, y: 0}} buzz={buzzOffset(lf, lf < 18 ? 1 : 0)} ringPulse={lf < 18 ? 1 : 0} windowNeon={lf >= 10 && lf < 13 ? 0.6 : 1} glint={lf >= 20 && lf < 24 ? 1 : 0} />
        <Label text={`red · push ${s.toFixed(3)} · buzz`} />
      </AbsoluteFill>
    );
  }
  if (seg === 2) return (<AbsoluteFill><Lobby tint="teal" crop={{scale: 0.55, x: 0, y: 0}} buzz={buzzOffset(lf, 1)} ringPulse={0.7} /><Label text="teal · S02 · 0.55" /></AbsoluteFill>);
  if (seg === 3) return (<AbsoluteFill><Lobby tint="teal" phoneState="dark" crop={{scale: 0.75, x: 0, y: -60}} dust={lf / 30 + 3} /><Label text="teal · dark · dust" /></AbsoluteFill>);
  if (seg === 4) {
    const crop = {scale: 0.92, x: -260, y: 0};
    const c = lobbyToFrame({x: LOBBY.sedan.cx, y: LOBBY.sedan.cy}, crop);
    return (
      <AbsoluteFill>
        <Lobby tint="red" crop={crop} phoneBlur={3} glint={1} />
        <svg width={1080} height={1920} style={{position: 'absolute', inset: 0}}>
          <ellipse cx={c.x} cy={c.y} rx={95} ry={50} fill="none" stroke={NIGHT.ivory} strokeWidth={3} />
        </svg>
        <Label text="red · S19 crop · ring via lobbyToFrame" />
      </AbsoluteFill>
    );
  }
  if (seg === 5) return (<AbsoluteFill><Lobby tint="red" phoneState="missed" crop={{scale: 0.92, x: -260, y: 0}} /><Label text="red · missed" /></AbsoluteFill>);
  return (<AbsoluteFill><Lobby tint="teal" windowView="none" phoneState="dark" /><Label text="teal · blinds · dark" /></AbsoluteFill>);
};

export const preview = {id: 'LobbyPreview', component: LobbyPreviewComp, durationInFrames: 210};
