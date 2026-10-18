// S20 BOTTOM panel: the Starlite's HotelOne console, dark theme, Voice front
// desk → Messages, at the narrow layout zoomed 1.8x. Newest first (the API
// order): Rita's message as a 30% strip, then Sam Ortiz's booking request with
// everything but "Quoted total: $238.00" dimmed and blurred, the phone button
// crisp and the email at 40%. The print crops below the first button row.
import React from 'react';
import {ConsoleHeader, MessagesList, Screen, inbox} from '../../hotelone/index.ts';
import {alpha} from '../../set/parts.tsx';
import {NIGHT} from '../../theme.ts';
import {BOT, CSS_W, ZOOM} from './layout.ts';

/** CSS px between the sticky console header and the card (the page is scrolled so the inbox sits under it). */
export const CARD_TOP_CSS = 12;
/** Height of Rita's strip (CSS px). The board's 70 px can't hold her two lines at 1.8x; this lands the print's
 * bottom edge in the gap under Sam's first button row. */
export const STRIP_CSS = 56;

/**
 * Anchors measured on the render (panel-local frame px, unrotated):
 * the phone button's number "+1 (928) 555-0147" and "Quoted total: $238.00".
 */
export const ROW_PHONE = {cx: 194, cy: 467, rx: 172, ry: 31}; // icon + number box x 61–326, y 454–479
export const ROW_TOTAL = {cx: 470, cy: 363, rx: 164, ry: 27}; // glyph box x 342–598, y 351–373

export const InboxPanel: React.FC = () => (
  <div style={{position: 'absolute', inset: 0, overflow: 'hidden', borderRadius: 18}}>
    <Screen mode="dark" zoom={ZOOM} width={CSS_W} height={BOT.h / ZOOM}>
      <ConsoleHeader blur />
      <div style={{padding: `${CARD_TOP_CSS}px 16px 0`, boxSizing: 'border-box'}}>
        <MessagesList
          requests={inbox('night')}
          fx={{
            rita: {opacity: 0.3, cropTop: 12, maxHeight: STRIP_CSS},
            sam: {dimMessage: {opacity: 0.4, blur: 1.4}, email: {opacity: 0.4}},
          }}
        />
      </div>
    </Screen>
    {/* print edge: teal hairline (Gus's world) and a soft falloff at the crop */}
    <div style={{position: 'absolute', inset: 0, borderRadius: 18, boxShadow: `inset 0 0 0 1.5px ${alpha(NIGHT.tealSoft, 0.3)}, inset 0 -50px 50px -34px ${alpha(NIGHT.ink, 0.9)}`}} />
  </div>
);
