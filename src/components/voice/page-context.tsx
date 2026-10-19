'use client';

import * as React from 'react';

/**
 * What a page tells the voice dock about itself, so the voice agent knows
 * what the guest is looking at and can act on the page (re-price it, fill in
 * checkout, confirm a booking). Pages call `useVoicePage(...)`; the dock (in
 * the root layout) reads whichever page registered last.
 */
export type VoicePageKind = 'home' | 'directory' | 'hotel' | 'checkout' | 'booking' | 'trips' | 'other';

export interface VoiceStay {
  checkIn: string;
  checkOut: string;
  guests: number;
  rooms: number;
}

export interface VoiceRoomOption {
  id: string;
  name: string;
  sleeps?: number;
  available?: boolean;
  /** Average per night, per room (USD), when priced. */
  nightly?: number | null;
  /** Whole stay, all rooms (USD), when priced. */
  total?: number | null;
}

/** What a page action reports back to the agent. `message` is written for the model to act on. */
export type VoiceActionResult = { ok: true; message: string; [k: string]: unknown } | { ok: false; error: string; [k: string]: unknown };

/** The order on a checkout page, exactly as confirming it would book it. */
export interface VoiceOrder {
  propertyId: string;
  roomTypeId: string;
  checkIn: string;
  checkOut: string;
  guests: number;
  rooms: number;
  hotel?: string | null;
  room?: string | null;
  /** Whole stay, all rooms, once priced. */
  total?: number | null;
  currency?: string | null;
}

/** What the agent asked confirm_booking to book; the checkout refuses unless it is what's on screen. */
export interface VoiceBookingRequest {
  /** Null on a hotel's own line (it means that hotel). */
  propertyId: string | null;
  roomTypeId: string;
  checkIn: string;
  checkOut: string;
  guests: number;
  rooms: number;
  /**
   * The guest spoke after the agent's read-back of this exact order (the dock
   * checks the transcript). The page books only then — after its own checks
   * (sign-in, card payment, sold out), which book nothing and come first.
   */
  guestConfirmed: boolean;
}

export interface VoicePageActions {
  /** Re-price the page for a stay (hotel page). */
  setStay?: (stay: VoiceStay) => void;
  /** Open checkout for a room (hotel page). */
  selectRoom?: (roomTypeId: string, stay?: VoiceStay) => void;
  /** Fill in checkout fields; says what was filled and what's still missing. */
  fillGuest?: (details: { name?: string | null; phone?: string | null; notes?: string | null }) => VoiceActionResult | Promise<VoiceActionResult>;
  /** Run the page's own confirm, with its own validation (checkout); refuses unless `expected` is the order on screen. */
  confirmBooking?: (expected: VoiceBookingRequest) => Promise<VoiceActionResult>;
}

export interface VoicePage {
  kind: VoicePageKind;
  propertyId?: string | null;
  propertyName?: string | null;
  /** The hotel's colour (hex), so the launcher wears it on the hotel's pages. */
  brand?: string | null;
  stay?: VoiceStay | null;
  roomOptions?: VoiceRoomOption[];
  /**
   * What's on screen, completing "The guest is on …", e.g. "checkout for the
   * Ocean King at Saltwater Inn, Nov 14–16, 2 guests, total $428; signed in".
   */
  summary?: string | null;
  /**
   * Phones and tablets (below lg): px to keep clear at the bottom, on top of the
   * launcher's own 16px margin and the safe area — e.g. a fixed booking bar.
   * In-flow buttons (checkout's confirm) use data-voice-avoid instead, and a
   * group of controls (a stay search) data-voice-avoid-controls on its wrapper.
   */
  bottomOffset?: number;
  /** Checkout: the order on screen (what confirm_booking would book). */
  order?: VoiceOrder | null;
  actions?: VoicePageActions;
}

/**
 * Page text on its way to the voice agent (hotel names, taglines, room names,
 * anything read from the URL): data, never instructions. One line, no
 * "[Page]" markers, brackets or control characters, and capped, so nothing a
 * hotel or a crafted link controls can pose as a page update. Free text the
 * guest typed into the URL (a search) should not be sent at all.
 */
export function voiceText(value: string | null | undefined, max = 160): string {
  if (!value) return '';
  const s = String(value)
    // Newlines, other control characters and invisible direction/zero-width marks.
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff]+/g, ' ')
    .replace(/\[\s*page\s*\]/gi, ' ')
    .replace(/[[\]{}<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

export interface VoicePageRegistry {
  register(id: string, page: React.MutableRefObject<VoicePage>): void;
  unregister(id: string): void;
  /** The page's data changed (not just its action functions). */
  changed(id: string): void;
}

export const VoicePageRegistryContext = React.createContext<VoicePageRegistry | null>(null);

/** A stable fingerprint of a page's data (functions excluded), for change detection. */
function fingerprint(page: VoicePage): string {
  const { actions, ...data } = page;
  return JSON.stringify({ ...data, actions: Object.keys(actions ?? {}).filter((k) => !!actions?.[k as keyof VoicePageActions]) });
}

/**
 * Tell the voice dock what this page shows and what the agent may do on it.
 * Call it on every render with the current values; action functions may be
 * new each render (the dock always calls the latest). Safe to call outside
 * the dock (it does nothing).
 */
export function useVoicePage(page: VoicePage): void {
  const registry = React.useContext(VoicePageRegistryContext);
  const id = React.useId();
  const latest = React.useRef(page);
  latest.current = page;
  const key = fingerprint(page);

  React.useEffect(() => {
    if (!registry) return;
    registry.register(id, latest);
    return () => registry.unregister(id);
  }, [registry, id]);

  React.useEffect(() => {
    registry?.changed(id);
  }, [registry, id, key]);
}

/** What the dock assumes about a page that hasn't registered (or before it does), from its path. */
export function pageFromPath(pathname: string): VoicePage {
  if (pathname === '/') return { kind: 'home' };
  if (pathname === '/properties') return { kind: 'directory' };
  const checkout = pathname.match(/^\/properties\/([^/]+)\/book\/?$/);
  if (checkout) return { kind: 'checkout', propertyId: decodeURIComponent(checkout[1]) };
  const hotel = pathname.match(/^\/properties\/([^/]+)\/?$/);
  if (hotel) return { kind: 'hotel', propertyId: decodeURIComponent(hotel[1]) };
  if (/^\/bookings\/[^/]+/.test(pathname)) return { kind: 'booking' };
  if (pathname === '/dashboard') return { kind: 'trips' };
  return { kind: 'other' };
}
