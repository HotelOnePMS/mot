// Dev preview for src/ui/GenericPhone.tsx.
//   f0–29    S06 contact card (dark), thumb ripple on the call button from f20
//   f30–59   S06 calling: "Calling…" 00:00
//   f60–89   S20 lock screen with the missed-call card
//   f90–119  incoming call (light), ringing
//   f120–149 home screen with a "Call ended" banner sliding in
//   f150–179 off + custom (a HotelOne Screen inside the phone at the real narrow width)
import React from 'react';
import {AbsoluteFill, interpolate, useCurrentFrame} from 'remotion';
import {loadFonts} from '../fonts.ts';
import {GenericPhone, phonePoint} from '../ui/GenericPhone.tsx';
import {inbox, Screen, VoiceMessagesPage} from '../hotelone/index.ts';
import {FONT, LIGHT, NIGHT} from '../theme.ts';

loadFonts();

const Tag: React.FC<{text: string}> = ({text}) => (
  <div style={{position: 'absolute', left: 24, bottom: 24, fontFamily: FONT.mono, fontSize: 24, color: NIGHT.brass, background: 'rgba(7,9,13,0.75)', padding: '6px 12px', borderRadius: 8}}>{text}</div>
);

const bg = `radial-gradient(80% 60% at 50% 40%, ${NIGHT.wallLow} 0%, ${NIGHT.ink} 100%)`;

const GenericPhonePreviewComp: React.FC = () => {
  const frame = useCurrentFrame();
  const seg = Math.floor(frame / 30);
  const lf = frame % 30;
  if (seg === 0) {
    const W = 560;
    const left = 225;
    const top = 330;
    const call = phonePoint('call', W);
    return (
      <AbsoluteFill style={{background: bg}}>
        <div style={{position: 'absolute', left, top}}>
          <GenericPhone width={W} screen="contact" name="Starlite — front desk" time="2:21" rim={NIGHT.teal} tap={{at: 'call', progress: interpolate(lf, [20, 29], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'})}} press={lf >= 20 && lf < 23 ? 1 : 0} />
        </div>
        <div style={{position: 'absolute', left: left + call.x - 6, top: top + call.y - 6, width: 12, height: 12, borderRadius: 6, background: NIGHT.brass}} />
        <Tag text="S06 · contact card · call anchor in brass" />
      </AbsoluteFill>
    );
  }
  if (seg === 1) {
    return (
      <AbsoluteFill style={{background: bg}}>
        <div style={{position: 'absolute', left: 225, top: 330}}>
          <GenericPhone width={560} screen="calling" name="Starlite — front desk" time="2:21" elapsed={lf / 30} rim={NIGHT.teal} />
        </div>
        <Tag text="S06 · calling · 00:00" />
      </AbsoluteFill>
    );
  }
  if (seg === 2) {
    return (
      <AbsoluteFill style={{background: bg}}>
        <div style={{position: 'absolute', left: 300, top: 420}}>
          <GenericPhone width={420} screen="lock" time="2:14" lockTime="2:14" wallpaper="red" rim={NIGHT.red} notification={{title: 'Missed call', body: '(928) 555-0147', time: '2:13 AM'}} numberCircle={{progress: interpolate(lf, [5, 15], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'})}} />
        </div>
        <Tag text="S20 · lock screen · missed call" />
      </AbsoluteFill>
    );
  }
  if (seg === 3) {
    return (
      <AbsoluteFill style={{background: bg}}>
        <div style={{position: 'absolute', left: 300, top: 420}}>
          <GenericPhone width={420} screen="incoming" theme="light" name="(928) 555-0147" time="2:13" ring={(lf % 15) / 15} />
        </div>
        <Tag text="incoming · light · ring" />
      </AbsoluteFill>
    );
  }
  if (seg === 4) {
    return (
      <AbsoluteFill style={{background: bg}}>
        <div style={{position: 'absolute', left: 300, top: 420}}>
          <GenericPhone width={420} screen="home" time="2:22" lockTime="2:22" wallpaper="red" banner={{title: 'Call ended', body: 'Starlite — front desk · 00:31', time: 'now', icon: 'phone-off', iconBg: NIGHT.red}} bannerIn={interpolate(lf, [2, 12], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'})} />
        </div>
        <Tag text="home · call ended banner" />
      </AbsoluteFill>
    );
  }
  return (
    <AbsoluteFill style={{background: bg}}>
      <div style={{position: 'absolute', left: 40, top: 520}}>
        <GenericPhone width={440} screen="off" />
      </div>
      <div style={{position: 'absolute', left: 560, top: 520}}>
        <GenericPhone width={440} screen="custom" theme="light" time="6:52" screenBg={LIGHT.background}>
          <div style={{position: 'absolute', top: 52, left: 0}}>
            <Screen mode="light" width={380} height={748}>
              <VoiceMessagesPage mode="light" requests={inbox('morning')} />
            </Screen>
          </div>
        </GenericPhone>
      </div>
      <Tag text="off · custom (HotelOne at 380 CSS px)" />
    </AbsoluteFill>
  );
};

export const preview = {id: 'GenericPhonePreview', component: GenericPhonePreviewComp, durationInFrames: 180};
