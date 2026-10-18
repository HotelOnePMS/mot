// Fidelity check: the same slices of the app as scratchpad/realui/{light,dark}.html (the app's real class
// strings compiled with its own tailwind.config.ts + globals.css), rendered by the rebuild at 390 CSS px x 1.35.
//   f0 light: To handle · 2 | Done · 0 + the morning inbox
//   f1 dark:  How it sounds card + the night inbox
//   f2/f3: f0/f1 with a readout of every text node's position; f4: the sonner toast at 2x; f5/f6: the rate cell at 3x
// Compare the stills with the headless-Chrome screenshots of the real markup side by side.
import React from 'react';
import {AbsoluteFill, useCurrentFrame} from 'remotion';
import {loadFonts} from '../fonts.ts';
import {COPY_TOAST, HO, HowItSoundsCard, QUEEN_FRI, RateCell, inbox, MessagesList, PageFrame, Screen, SegmentedControl, SonnerToast, ToastViewport, useHO} from '../hotelone/index.ts';

loadFonts();

const Requests: React.FC<{when: 'night' | 'morning'}> = ({when}) => (
  <div style={{display: 'flex', flexDirection: 'column', gap: 16, alignItems: 'flex-start'}}>
    <SegmentedControl size="sm" options={['To handle · 2', 'Done · 0']} value={0} />
    <MessagesList requests={inbox(when)} style={{alignSelf: 'stretch'}} />
  </div>
);

const Bg: React.FC<{mode: 'light' | 'dark'}> = ({mode}) => <AbsoluteFill style={{background: useHO(mode).background}} />;

/**
 * f2/f3: the same as f0/f1 plus a readout of every text node's position (CSS px from the page frame's top-left),
 * to diff against realui/pos.js run on the real markup at 390 CSS px.
 */
const Measure: React.FC<{zoom: number}> = ({zoom}) => {
  const ref = React.useRef<HTMLDivElement>(null);
  const [out, setOut] = React.useState('');
  React.useLayoutEffect(() => {
    const root = ref.current?.parentElement?.querySelector('[data-frame]')?.parentElement;
    if (!root) return;
    const o = root.getBoundingClientRect();
    const rows: string[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let n: Node | null;
    while ((n = walker.nextNode())) {
      const t = (n.textContent ?? '').trim();
      if (!t) continue;
      const r = document.createRange();
      r.selectNodeContents(n);
      const rc = r.getClientRects()[0];
      if (!rc) continue;
      rows.push(`${t.slice(0, 18)}@${((rc.left - o.left) / zoom).toFixed(1)},${((rc.top - o.top) / zoom).toFixed(1)}`);
    }
    setOut(rows.join(' || '));
  }, [zoom]);
  return (
    <div ref={ref} style={{position: 'absolute', left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.9)', color: '#fff', font: '11px monospace', whiteSpace: 'pre-wrap', padding: 6, zIndex: 9}}>
      {out}
    </div>
  );
};

const Comp: React.FC = () => {
  const frame = useCurrentFrame();
  if (frame === 5 || frame === 6) {
    // f5/f6: the Friday rate cell (sm-and-up rendering) on the calendar card at 3x (compare realui/cell-*.html).
    const m = frame === 5 ? 'light' : 'dark';
    return (
      <AbsoluteFill style={{background: '#000'}}>
        <Screen mode={m} zoom={3} width={108} height={104} background={HO[m].card}>
          <div style={{padding: 8}}>
            <RateCell {...QUEEN_FRI} />
          </div>
        </Screen>
      </AbsoluteFill>
    );
  }
  if (frame === 4) {
    // f4: the sonner toast as the narrow toaster places it, 390 x 140 CSS px at 2x (compare realui/toast.html).
    return (
      <AbsoluteFill style={{background: '#000'}}>
        <Screen mode="light" zoom={2} width={390} height={140}>
          <ToastViewport enter={1}>
            <SonnerToast title={COPY_TOAST} />
          </ToastViewport>
        </Screen>
      </AbsoluteFill>
    );
  }
  const mode = frame % 2 === 0 ? 'light' : 'dark';
  return (
    <AbsoluteFill>
      <Bg mode={mode} />
      <Screen mode={mode} zoom={1.35} width={390} height={1300}>
        <PageFrame>
          <div data-frame style={{display: 'none'}} />
          {mode === 'light' ? (
            <Requests when="morning" />
          ) : (
            <>
              <HowItSoundsCard mode="dark" />
              <div style={{height: 24}} />
              <Requests when="night" />
            </>
          )}
        </PageFrame>
      </Screen>
      {frame >= 2 ? <Measure zoom={1.35} /> : null}
    </AbsoluteFill>
  );
};

export const preview = {id: 'HotelOneComparePreview', component: Comp, durationInFrames: 7, width: 527, height: 1755};
