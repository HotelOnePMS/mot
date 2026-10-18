// S20 · TheKnot · 0:42.5–0:46.5. A detective board on ink: Rita's front-desk
// lock screen (missed call from (928) 555-0147 at 2:13 AM) over the Starlite's
// HotelOne inbox, where the same number left a booking request ten minutes
// later. Red marker circles, a red string between them, the headline, and the
// quoted total popping out giant. Nobody speaks here, so the pill may sit in
// the caption band. Every beat reads marks.ts S20 (see theknot/layout.ts).
import React from 'react';
import {AbsoluteFill, Easing, interpolate, useCurrentFrame} from 'remotion';
import type {SceneProps} from './types.ts';
import {MarkerCircle, RedString} from '../fx/RedString.tsx';
import {alpha} from '../set/parts.tsx';
import {EASE_POP, FONT, INTER_FEATURES, NIGHT} from '../theme.ts';
import {BoardBackground, BOARD, PinnedTag, Tape} from './theknot/Board.tsx';
import {LockPanel, LOCK_NUMBER} from './theknot/LockPanel.tsx';
import {InboxPanel, ROW_PHONE, ROW_TOTAL} from './theknot/InboxPanel.tsx';
import {BOT, HEAD, PILL, PUSH_ORIGIN, T, TAG_BOT, TAG_TOP, TOP, panelToBoard, type Panel} from './theknot/layout.ts';

const clamp = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;
const ease = Easing.bezier(...EASE_POP);
const c01 = (x: number) => Math.max(0, Math.min(1, x));

type Ellipse = {cx: number; cy: number; rx: number; ry: number};

/** The point on an ellipse facing another point (where the string's pin goes). */
const edgeToward = (e: Ellipse, to: {x: number; y: number}, bias = 0) => {
  const a = Math.atan2((to.y - e.cy) / e.ry, (to.x - e.cx) / e.rx) + bias;
  return {x: e.cx + Math.cos(a) * e.rx, y: e.cy + Math.sin(a) * e.ry};
};

/** A pinned print: slides in, rotates a hair, casts a shadow; `over` is panel-local and unclipped. */
const Print: React.FC<{p: Panel; dy: number; children: React.ReactNode; over?: React.ReactNode}> = ({p, dy, children, over}) => (
  <div style={{position: 'absolute', left: p.x, top: p.y + dy, width: p.w, height: p.h, transform: `rotate(${p.rot}deg)`}}>
    <div style={{position: 'absolute', inset: 0, borderRadius: 18, boxShadow: `0 34px 60px -18px ${alpha(NIGHT.ink, 0.95)}, 0 6px 14px ${alpha(NIGHT.ink, 0.6)}`}} />
    {children}
    <div style={{position: 'absolute', inset: 0, overflow: 'visible', pointerEvents: 'none'}}>{over}</div>
  </div>
);

/** One headline line rising out of its own baseline mask. */
const Rise: React.FC<{since: number; top: number; height: number; style: React.CSSProperties; children: React.ReactNode}> = ({since, top, height, style, children}) => {
  if (since < 0) return null;
  const k = interpolate(since, [0, 12], [0, 1], {...clamp, easing: ease});
  return (
    <div style={{position: 'absolute', left: 0, width: 1010, top, height, overflow: 'hidden', display: 'flex', justifyContent: 'center'}}>
      <div style={{transform: `translateY(${(1 - k) * height * 0.9}px)`, opacity: c01(since / 4), whiteSpace: 'nowrap', ...style}}>{children}</div>
    </div>
  );
};

export const TheKnot: React.FC<SceneProps> = () => {
  const frame = useCurrentFrame();

  // camera: the slow push (100→106%) plus a short kick on the 45.5 sub impact
  const push = interpolate(frame, [0, T.end], [1, 1.06], clamp);
  const sincePop = frame - T.pop;
  const kick = sincePop >= 0 ? Math.exp(-sincePop / 2.6) : 0;
  const shake = {x: kick * 7 * Math.sin(sincePop * 2.4), y: kick * 5 * Math.cos(sincePop * 3.1)};
  const toScreen = (pt: {x: number; y: number}) => ({x: PUSH_ORIGIN.x + (pt.x - PUSH_ORIGIN.x) * push + shake.x, y: PUSH_ORIGIN.y + (pt.y - PUSH_ORIGIN.y) * push + shake.y});

  // the two prints slide in from above and below (8 frames)
  const slide = interpolate(frame, [T.panels, T.panelsEnd], [0, 1], {...clamp, easing: ease});
  const topDy = (1 - slide) * -540;
  const botDy = (1 - slide) * 540;

  // marker circles
  const draw = (at: number, frames: number) => interpolate(frame, [at, at + frames], [0, 1], clamp);
  const lockCircle = draw(T.circleLock, T.circleDraw);
  const rowCircle = draw(T.circleRow, T.circleDraw);
  const totalCircle = draw(T.circleTotal, Math.max(2, T.pop - T.circleTotal));

  // the red string, circle to circle (board px)
  const lockC = panelToBoard(TOP, {x: LOCK_NUMBER.cx, y: LOCK_NUMBER.cy});
  const rowC = panelToBoard(BOT, {x: ROW_PHONE.cx, y: ROW_PHONE.cy});
  const from = edgeToward({...LOCK_NUMBER, cx: lockC.x, cy: lockC.y}, rowC);
  const to = edgeToward({...ROW_PHONE, cx: rowC.x, cy: rowC.y}, lockC);
  const string = interpolate(frame, [T.stringStart, T.stringEnd], [0, 1], clamp);
  const pins: [number, number] = [c01((frame - T.pinA) / 5), c01((frame - T.pinB) / 5)];

  // the giant total: pops out of the circled line and lands on its pill
  const totalPt = toScreen(panelToBoard(BOT, {x: ROW_TOTAL.cx, y: ROW_TOTAL.cy}));
  const pillC = {x: PILL.cx, y: PILL.top + PILL.h / 2};
  const popScale = sincePop < 0 ? 0 : interpolate(sincePop, [0, 5, T.popFrames], [0.6, 1.08, 1], {...clamp, easing: Easing.out(Easing.quad)});
  const travel = interpolate(sincePop, [0, 5], [0, 1], {...clamp, easing: ease});
  const pillX = totalPt.x + (pillC.x - totalPt.x) * travel;
  const pillY = totalPt.y + (pillC.y - totalPt.y) * travel;
  const scrim = interpolate(sincePop, [0, 5], [0, 0.3], clamp);
  const bloom = sincePop < 0 ? 0 : interpolate(sincePop, [0, 2, 30], [0, 1, 0.35], clamp);

  return (
    <AbsoluteFill style={{background: BOARD, overflow: 'hidden'}}>
      <AbsoluteFill style={{transform: `translate(${shake.x}px, ${shake.y}px) scale(${push})`, transformOrigin: `${PUSH_ORIGIN.x}px ${PUSH_ORIGIN.y}px`}}>
        <BoardBackground />

        <Print
          p={TOP}
          dy={topDy}
          over={
            <>
              <svg width={TOP.w} height={TOP.h} style={{position: 'absolute', inset: 0, overflow: 'visible'}} aria-hidden>
                <Tape x={TOP.w - 26} y={6} rot={32} seed="knot-tape-a" />
              </svg>
              <MarkerCircle {...LOCK_NUMBER} progress={lockCircle} seed="knot-lock" tilt={-1.5} />
            </>
          }
        >
          <LockPanel />
        </Print>
        <div style={{position: 'absolute', inset: 0, transform: `translateY(${topDy}px)`}}>
          <PinnedTag text="Rita’s desk · 2:13 AM" color={NIGHT.redSoft} x={TAG_TOP.x} cy={TAG_TOP.cy} rot={0.9} />
        </div>

        <Print
          p={BOT}
          dy={botDy}
          over={
            <>
              <svg width={BOT.w} height={BOT.h} style={{position: 'absolute', inset: 0, overflow: 'visible'}} aria-hidden>
                <Tape x={34} y={2} rot={-30} seed="knot-tape-b" />
              </svg>
              <MarkerCircle {...ROW_PHONE} progress={rowCircle} seed="knot-row" tilt={-1.5} />
              <MarkerCircle {...ROW_TOTAL} progress={totalCircle} seed="knot-total" tilt={-1} width={6} />
              <div style={{position: 'absolute', inset: 0, borderRadius: 18, background: NIGHT.ink, opacity: scrim}} />
            </>
          }
        >
          <InboxPanel />
        </Print>
        <div style={{position: 'absolute', inset: 0, transform: `translateY(${botDy}px)`}}>
          <PinnedTag text="The Starlite · inbox" color={NIGHT.tealSoft} x={TAG_BOT.x} cy={TAG_BOT.cy} rot={-1.2} align="right" />
        </div>

        <RedString from={from} to={to} progress={string} pins={pins} sag={26} width={3} />
      </AbsoluteFill>

      {/* headline (unpushed, so it holds its zone): 44.0 two Fraunces lines, 44.75 the red line */}
      <Rise since={frame - T.headline} top={HEAD.top} height={HEAD.lineH} style={{fontFamily: FONT.display, fontWeight: 600, fontSize: HEAD.size, lineHeight: `${HEAD.lineH}px`, letterSpacing: '-0.015em', color: NIGHT.ivory}}>
        Her 2:13 caller
      </Rise>
      <Rise since={frame - T.headline - 3} top={HEAD.top + HEAD.lineH} height={HEAD.lineH} style={{fontFamily: FONT.display, fontWeight: 600, fontSize: HEAD.size, lineHeight: `${HEAD.lineH}px`, letterSpacing: '-0.015em', color: NIGHT.ivory}}>
        tried Gus next.
      </Rise>
      <Rise since={frame - T.line2} top={HEAD.line2Top} height={56} style={{fontFamily: FONT.ui, fontFeatureSettings: INTER_FEATURES, fontWeight: 600, fontSize: HEAD.line2Size, lineHeight: '50px', color: NIGHT.redSoft}}>
        She watched it ring.
      </Rise>

      {/* 45.5: "$238.00" on an ink pill, y 1170–1320 */}
      {sincePop >= 0 ? (
        <>
          <div
            style={{
              position: 'absolute',
              left: pillX - 520,
              top: pillY - 260,
              width: 1040,
              height: 520,
              background: `radial-gradient(closest-side, ${alpha(NIGHT.red, 0.34 * bloom)} 0%, ${alpha(NIGHT.red, 0.1 * bloom)} 45%, ${alpha(NIGHT.red, 0)} 100%)`,
            }}
          />
          <div
            style={{
              position: 'absolute',
              left: pillX,
              top: pillY,
              transform: `translate(-50%, -50%) scale(${popScale})`,
              height: PILL.h,
              padding: '0 56px',
              display: 'flex',
              alignItems: 'center',
              borderRadius: PILL.h / 2,
              background: NIGHT.ink,
              boxShadow: `inset 0 0 0 2px ${alpha(NIGHT.red, 0.55)}, 0 0 0 1px ${alpha(NIGHT.ink, 0.8)}, 0 24px 60px -16px ${alpha(NIGHT.ink, 1)}`,
              fontFamily: FONT.mono,
              fontWeight: 500,
              fontSize: 140,
              lineHeight: 1,
              letterSpacing: '-0.03em',
              color: NIGHT.red,
              fontVariantNumeric: 'tabular-nums',
              whiteSpace: 'nowrap',
              textShadow: `0 0 ${18 + 22 * bloom}px ${alpha(NIGHT.red, 0.45)}`,
            }}
          >
            $238.00
          </div>
        </>
      ) : null}
    </AbsoluteFill>
  );
};
