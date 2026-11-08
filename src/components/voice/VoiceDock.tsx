"use client";

import * as React from "react";
import useSWR from "swr";
import { usePathname, useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import {
  AudioLines,
  ChevronDown,
  Mic,
  MicOff,
  PhoneOff,
  Sparkles,
  X,
} from "lucide-react";
import { PRODUCT_NAME } from "@/config/product";
import { TOUR_PATH, TOUR_STOPS, nextTourStop, tourStop } from "@/config/tour";
import { fetcher } from "@/lib/fetcher";
import { isConsolePath } from "@/lib/routes";
import { cn } from "@/lib/utils";
import { brandScope } from "@/components/guest/brand";
import { Badge } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import {
  useLiveVoice,
  type Caption,
  type VoiceState,
  type VoiceToolCall,
} from "./useLiveVoice";
import {
  VOICE_PHASE_LABEL,
  VoiceOrb,
  VoiceStatus,
  voicePhase,
} from "./VoiceOrb";
import {
  VoicePageRegistryContext,
  orderItemsKey,
  pageFromPath,
  voiceText,
  type VoiceBookingRequest,
  type VoiceOrder,
  type VoiceOrderItem,
  type VoicePage,
  type VoicePageRegistry,
  type VoiceStay,
} from "./page-context";

/**
 * The booking site's voice, mounted once in the root layout so a call (and
 * its transcript) survives client navigation: hotel page → checkout →
 * booking page. On a hotel's pages it is that hotel's front desk ("Talk to
 * us", in the hotel's colour, HOTEL scope); everywhere else it is the
 * HotelOne concierge across every listed hotel ("Ask HotelOne", GLOBAL).
 *
 * UI: a floating launcher; a non-modal panel (desktop: bottom-right card;
 * phones: bottom sheet) with status, live transcript, mute, minimise and
 * end; minimised, a compact "live" pill. Esc minimises, never hangs up.
 * Pages describe themselves with `useVoicePage`, and the agent is told when
 * the guest moves to another page during a call.
 *
 * Not offered in the staff console (staff have their own voice; a live call
 * ends there) or on sign-in, sign-up and onboarding (a call already running
 * keeps its pill there, so signing in doesn't hang up).
 */

/** Past this scroll depth the launcher folds into a round icon on phones and tablets. */
const COLLAPSE_AFTER = 120;
/** Width of the folded launcher or pill (a 48px circle). */
const FOLDED = 48;
/** Routes without a launcher: sign-in, sign-up, onboarding and the product pages for hotels (a running call keeps its pill). */
const NO_LAUNCHER = [
  /^\/login(\/|$)/,
  /^\/register(\/|$)/,
  /^\/onboarding(\/|$)/,
  // Product pages are for hotels; travellers get the launcher on /properties. The home page and
  // the owner demo (/demo/tour) keep it: there the concierge is the product guide and runs the demo.
  /^\/(about|contact|developers)(\/|$)/,
  /^\/demo\/?$/,
];
/** Pages for hotel owners: a call started here greets as the product guide (intro=owners). */
const OWNER_PAGES = new Set<VoicePage["kind"]>(["home", "tour"]);
/** How long show_demo_stop waits for the owner demo to finish opening. */
const TOUR_WAIT = 8_000;
/** Tools that take a property_id the browser can fill in from the hotel on screen (concierge). */
const PROPERTY_TOOLS = new Set([
  "get_property_info",
  "check_availability",
  "start_booking",
  "leave_message",
  "use_skill",
]);
/** A page change the voice started (start_booking, open_hotel) counts as still on its way for at most this long. */
const NAV_TIMEOUT = 15_000;
/** Ids and calendar days as the agent may see them (anything else in a URL is left out). */
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
/** How long confirm_booking waits for the guest's words when they answered a read-back but their transcript lags. */
const ANSWER_GRACE = 1_500;
/** Consent state with nothing heard yet (see the consent section in VoiceDock). */
const NO_CONSENT = { order: "", toldAt: 0, agentAfter: 0, guestAt: 0 };

interface VoiceStatusResponse {
  provider: "openai" | "elevenlabs";
  concierge: boolean;
  hotel: {
    id: string;
    name: string;
    primaryColor: string | null;
    available: boolean;
    /** The front desk can book on screen; otherwise it takes booking requests. */
    bookable: boolean;
  } | null;
}

/** Who a call is with: one hotel's front desk or the HotelOne concierge. */
interface DockTarget {
  scope: "hotel" | "global";
  propertyId: string | null;
  name: string;
  brand: string | null;
  /** Can book on screen (confirm_booking). Hotels on their own system take booking requests. */
  bookable: boolean;
}

interface DockSession extends DockTarget {
  startedAt: number;
}

export interface VoiceDockApi {
  /** A call can be started from this page. */
  available: boolean;
  /** "Talk to us" on a hotel's pages, "Ask HotelOne" elsewhere. */
  label: string;
  /** Open the panel and start talking (or bring back a running call). */
  start: () => void;
  /** The guest may be about to talk (hover, focus, touch): fetch the voice SDK now. */
  prepare: () => void;
}

const VoiceDockContext = React.createContext<VoiceDockApi | null>(null);

/** The dock's controls, for page entry points such as "Ask HotelOne" on the home page. */
export function useVoiceDock(): VoiceDockApi | null {
  return React.useContext(VoiceDockContext);
}

const text = (v: unknown) =>
  typeof v === "string" && v.trim() ? v.trim() : null;

/** A whole number from 1 to max (tool arguments may arrive as numbers or digit strings). */
function count(v: unknown, max: number): number | null {
  const n = typeof v === "string" && /^\d+$/.test(v.trim()) ? Number(v) : v;
  return typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= max
    ? n
    : null;
}

/**
 * Several room types as a tool named them ([{ room_type_id, rooms }]): null
 * when there are none, undefined when any of them is malformed.
 */
function orderItems(v: unknown): VoiceOrderItem[] | null | undefined {
  if (v === null || v === undefined) return null;
  if (!Array.isArray(v) || v.length > 4) return undefined;
  const items = v.map((i: unknown) => {
    const o = (i && typeof i === "object" ? i : {}) as Record<string, unknown>;
    return { roomTypeId: text(o.room_type_id), rooms: count(o.rooms, 9) };
  });
  if (items.some((i) => !i.roomTypeId || !i.rooms)) return undefined;
  return items.length ? (items as VoiceOrderItem[]) : null;
}

/** What confirm_booking was asked to book, or null when it didn't say. */
function bookingRequest(
  args: Record<string, unknown>,
): Omit<VoiceBookingRequest, "guestConfirmed"> | null {
  const roomTypeId = text(args.room_type_id);
  const checkIn = text(args.check_in);
  const checkOut = text(args.check_out);
  const guests = count(args.guests, 40);
  const rooms = count(args.rooms, 9);
  const items = orderItems(args.items);
  if (!roomTypeId || !checkIn || !checkOut || !guests || !rooms || items === undefined) return null;
  return {
    propertyId: text(args.property_id),
    roomTypeId,
    items,
    checkIn,
    checkOut,
    guests,
    rooms,
  };
}

/** Is `want` the order on screen? (property_id may be left out: a room type belongs to one hotel.) */
function sameOrder(
  o: VoiceOrder,
  want: Omit<VoiceBookingRequest, "guestConfirmed">,
): boolean {
  return (
    (!want.propertyId || want.propertyId === o.propertyId) &&
    want.roomTypeId === o.roomTypeId &&
    want.checkIn === o.checkIn &&
    want.checkOut === o.checkOut &&
    want.guests === o.guests &&
    want.rooms === o.rooms &&
    orderItemsKey(want.items) === orderItemsKey(o.items)
  );
}

/** The order on screen, for the agent to read back (hotel text made safe, ids and dates only if well-formed). */
function orderFacts(o: VoiceOrder | null | undefined) {
  if (!o) return undefined;
  return {
    hotel: voiceText(o.hotel, 80) || null,
    room: voiceText(o.room, 80) || null,
    property_id: SAFE_ID.test(o.propertyId) ? o.propertyId : null,
    room_type_id: SAFE_ID.test(o.roomTypeId) ? o.roomTypeId : null,
    check_in: ISO_DAY.test(o.checkIn) ? o.checkIn : null,
    check_out: ISO_DAY.test(o.checkOut) ? o.checkOut : null,
    guests: o.guests,
    rooms: o.rooms,
    // Several room types booked together: each with its rooms (room_type_id is the first of them).
    items:
      o.items && o.items.length > 1
        ? o.items.map((i) => ({
            room_type_id: SAFE_ID.test(i.roomTypeId) ? i.roomTypeId : null,
            rooms: i.rooms,
          }))
        : null,
    total: o.total ?? null,
    currency: o.currency ?? null,
  };
}

/** The ids confirm_booking takes for the checkout on screen, when they are well-formed. */
function orderIds(o: VoiceOrder | null | undefined): string {
  const f = orderFacts(o);
  if (
    !f?.property_id ||
    !f.room_type_id ||
    !f.check_in ||
    !f.check_out ||
    !count(f.guests, 40) ||
    !count(f.rooms, 9) ||
    f.items?.some((i) => !i.room_type_id || !count(i.rooms, 9))
  )
    return "";
  const items = f.items
    ? JSON.stringify(f.items)
    : "null";
  return ` To book it, confirm_booking takes property_id ${f.property_id}, room_type_id ${f.room_type_id}, items ${items}, check_in ${f.check_in}, check_out ${f.check_out}, guests ${f.guests}, rooms ${f.rooms}.`;
}

/**
 * An order as consent tracks it: hotel, room, dates, party and total. Null
 * while it isn't fully known (no checkout, or its price still loading).
 */
function orderKey(o: {
  propertyId: unknown;
  roomTypeId: unknown;
  /** Several room types: VoiceOrderItem[] (a page) or [{ room_type_id, rooms }] (start_booking's result). */
  items?: unknown;
  checkIn: unknown;
  checkOut: unknown;
  guests: unknown;
  rooms: unknown;
  total: unknown;
}): string | null {
  if (typeof o.total !== "number" || !o.propertyId || !o.roomTypeId)
    return null;
  const items = Array.isArray(o.items)
    ? orderItems(
        o.items.map((i: Record<string, unknown>) =>
          i && "roomTypeId" in i
            ? { room_type_id: i.roomTypeId, rooms: i.rooms }
            : i,
        ),
      )
    : null;
  return JSON.stringify([
    o.propertyId,
    o.roomTypeId,
    orderItemsKey(items),
    o.checkIn,
    o.checkOut,
    Number(o.guests),
    Number(o.rooms),
    o.total,
  ]);
}

/** The order on a checkout page, once priced. */
function pageOrderKey(p: VoicePage): string | null {
  return p.kind === "checkout" && p.order
    ? orderKey({ ...p.order, total: p.order.total ?? null })
    : null;
}

/** Does `want` (a URL the voice opened) show in the address bar now? Same path and the same values for its query. */
function sameUrl(want: string, at: Location): boolean {
  let u: URL;
  try {
    u = new URL(want, at.origin);
  } catch {
    return false;
  }
  const trim = (p: string) => p.replace(/\/+$/, "") || "/";
  if (trim(u.pathname) !== trim(at.pathname)) return false;
  const have = new URLSearchParams(at.search);
  for (const [k, v] of u.searchParams) if (have.get(k) !== v) return false;
  return true;
}

/**
 * The page the dock acts on: the last one registered — unless the address
 * bar has already moved to a different page, whose registration lags the
 * route change by an effect. Then only what the path says is known (no actions).
 */
function resolvePage(
  registered: VoicePage | undefined,
  fromPath: VoicePage,
): VoicePage {
  if (!registered) return fromPath;
  const moved =
    (fromPath.kind !== "other" && registered.kind !== fromPath.kind) ||
    (!!registered.propertyId &&
      !!fromPath.propertyId &&
      registered.propertyId !== fromPath.propertyId);
  if (moved) return fromPath;
  return {
    ...registered,
    propertyId: registered.propertyId ?? fromPath.propertyId,
  };
}

/**
 * One short sentence for the agent about what is on the guest's screen. Page
 * text (hotel names, taglines, room names, anything from the URL) goes
 * through voiceText: it is data, and must never read like a [Page] update.
 */
function describePage(page: VoicePage, s: DockSession): string {
  const name = voiceText(page.propertyName, 80);
  const fallback: Record<VoicePage["kind"], string> = {
    home: `the ${PRODUCT_NAME} home page`,
    directory: "the list of hotels",
    hotel: name ? `${name}’s page` : "a hotel’s page",
    checkout: name ? `checkout at ${name}` : "checkout",
    booking: "their booking page",
    trips: "their trips (My trips)",
    tour: "the owner demo (a sample hotel’s console, sample data only)",
    other: "another page of the site",
  };
  const place = voiceText(page.summary, 600) || fallback[page.kind];
  // Request-only front desks (hotels on their own system) don't book on screen.
  const ids = page.kind === "checkout" && s.bookable ? orderIds(page.order) : "";
  if (s.scope === "hotel") {
    if (page.propertyId && page.propertyId === s.propertyId)
      return `The guest is on ${place}.${ids}`;
    return `The guest moved to another page of the site. You still only help with ${voiceText(s.name, 80) || "this hotel"}.`;
  }
  const pid =
    page.propertyId && SAFE_ID.test(page.propertyId)
      ? ` Its property_id is ${page.propertyId}.`
      : "";
  return `The guest is on ${place}.${pid}${ids}`;
}

export function VoiceDock({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "/";
  const router = useRouter();
  const uid = React.useId();
  // Names this mount (data-voice-dock), so a remount is visible. Client-only: the server render can't know it.
  const [instance, setInstance] = React.useState("");
  React.useEffect(() => setInstance(Math.random().toString(36).slice(2, 10)), []);

  // --- Page registry ---------------------------------------------------------
  const entries = React.useRef(
    new Map<string, React.MutableRefObject<VoicePage>>(),
  );
  // Each registration (a page mounting) gets a new number, so a tool call can tell
  // whether the page it started on is still the one on screen.
  const generation = React.useRef(0);
  const generations = React.useRef(new Map<string, number>());
  const [, setVersion] = React.useState(0);
  const registry = React.useMemo<VoicePageRegistry>(
    () => ({
      register(id, page) {
        entries.current.delete(id);
        entries.current.set(id, page); // last registered wins
        generations.current.set(id, ++generation.current);
        setVersion((v) => v + 1);
      },
      unregister(id) {
        generations.current.delete(id);
        if (entries.current.delete(id)) setVersion((v) => v + 1);
      },
      changed() {
        setVersion((v) => v + 1);
      },
    }),
    [],
  );
  const currentPage = React.useCallback(
    (): VoicePage =>
      resolvePage(
        [...entries.current.values()].at(-1)?.current,
        pageFromPath(window.location.pathname),
      ),
    [],
  );
  /** Which page is on screen right now: its registration and path (changes when the guest navigates). */
  const pageToken = React.useCallback((): string => {
    const id = [...entries.current.keys()].at(-1);
    return `${id ? `${id}#${generations.current.get(id)}` : "-"}|${window.location.pathname}`;
  }, []);
  const page: VoicePage = resolvePage(
    [...entries.current.values()].at(-1)?.current,
    pageFromPath(pathname),
  );

  // --- Where we are and what can be offered here ------------------------------
  const consolePath = isConsolePath(pathname);
  const noLauncher = NO_LAUNCHER.some((r) => r.test(pathname));
  const pid = page.propertyId ?? null;
  // A hotel's own pages wait for its id (the booking page knows it once loaded).
  const waiting =
    !pid &&
    (page.kind === "hotel" ||
      page.kind === "checkout" ||
      page.kind === "booking");
  const { data: status } = useSWR<VoiceStatusResponse>(
    consolePath || waiting
      ? null
      : `/api/voice/status${pid ? `?propertyId=${encodeURIComponent(pid)}` : ""}`,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 60_000 },
  );
  let target: DockTarget | null = null;
  if (status && !waiting) {
    if (pid) {
      if (status.hotel?.id === pid && status.hotel.available) {
        target = {
          scope: "hotel",
          propertyId: pid,
          name: page.propertyName || status.hotel.name,
          brand: page.brand ?? status.hotel.primaryColor,
          // Older status responses had no flag: those hotels could all book.
          bookable: status.hotel.bookable !== false,
        };
      }
    } else if (status.concierge) {
      target = {
        scope: "global",
        propertyId: null,
        name: PRODUCT_NAME,
        brand: null,
        bookable: true,
      };
    }
  }

  // --- The call ----------------------------------------------------------------
  const [session, setSession] = React.useState<DockSession | null>(null);
  const sessionRef = React.useRef(session);
  sessionRef.current = session;
  const routerRef = React.useRef(router);
  routerRef.current = router;

  // --- A page change the voice started, until it shows in the address bar ------
  const pendingNav = React.useRef<{
    url: string;
    from: string;
    since: number;
  } | null>(null);
  const navigating = React.useCallback((): boolean => {
    const p = pendingNav.current;
    if (!p) return false;
    const loc = window.location;
    // Arrived, went somewhere else instead, or gave up.
    if (
      sameUrl(p.url, loc) ||
      loc.pathname + loc.search !== p.from ||
      Date.now() - p.since > NAV_TIMEOUT
    ) {
      pendingNav.current = null;
      return false;
    }
    return true;
  }, []);

  // --- Consent: confirm_booking books only after the guest answered a read-back ----
  // of the order now on checkout: the agent was told that exact order (room,
  // dates, party and total — start_booking's result or a [Page] update), spoke
  // after that (its read-back), and the guest spoke after that. One counter
  // orders those events; the guest's words themselves are the model's to judge.
  const seq = React.useRef(0);
  const consent = React.useRef({ ...NO_CONSENT });
  /** The order on screen, when known: if it changed, earlier answers no longer count. */
  const noteOrder = React.useCallback((key: string | null) => {
    const c = consent.current;
    if (!key || key === c.order) return; // unknown yet (loading): nothing changed
    consent.current = {
      order: key,
      toldAt: 0,
      agentAfter: 0,
      guestAt: c.guestAt,
    };
  }, []);
  /** The agent now knows this order (start_booking returned it, or a [Page] update named it). */
  const toldAgent = React.useCallback(
    (key: string | null) => {
      if (!key) return;
      noteOrder(key);
      const c = consent.current;
      if (!c.toldAt) c.toldAt = ++seq.current;
    },
    [noteOrder],
  );
  const onTranscript = React.useCallback(
    (role: Caption["role"]) => {
      // A change not noticed yet still comes before this line (not while a page the voice
      // opened is on its way: the one still on screen is about to go).
      if (!navigating()) noteOrder(pageOrderKey(currentPage()));
      const n = ++seq.current;
      const c = consent.current;
      if (role === "user") c.guestAt = n;
      else if (c.toldAt && !c.agentAfter) c.agentAfter = n;
    },
    [currentPage, navigating, noteOrder],
  );
  /** The agent spoke after it was told the current order (its read-back), and the guest answered after that. */
  const guestConfirmed = React.useCallback(() => {
    const c = consent.current;
    return (
      !!c.order &&
      c.toldAt > 0 &&
      c.agentAfter > c.toldAt &&
      c.guestAt > c.agentAfter
    );
  }, []);
  /** The agent read the order back and the guest hasn't been heard since (their words may still be on the way). */
  const awaitingAnswer = React.useCallback(() => {
    const c = consent.current;
    return (
      !!c.order &&
      c.toldAt > 0 &&
      c.agentAfter > c.toldAt &&
      c.guestAt < c.agentAfter
    );
  }, []);

  const onToolCall = React.useCallback(
    async (
      call: VoiceToolCall,
      { token }: { token: string },
    ): Promise<unknown> => {
      const s = sessionRef.current;
      let args: Record<string, unknown>;
      try {
        const parsed = JSON.parse(call.arguments || "{}");
        args = parsed && typeof parsed === "object" ? parsed : {};
      } catch {
        return { error: "Arguments were not valid JSON." };
      }

      // Screen-only tools: they act on the page the guest has open.
      if (
        call.name === "fill_guest_details" ||
        call.name === "confirm_booking"
      ) {
        if (s && !s.bookable)
          return {
            error:
              "This hotel’s team confirms bookings themselves: use request_booking instead.",
          };
        // The guest answered the read-back but their words haven't arrived yet (speech
        // recognition can trail the model): give them a moment before deciding.
        if (call.name === "confirm_booking" && !navigating()) {
          noteOrder(pageOrderKey(currentPage()));
          const until = Date.now() + ANSWER_GRACE;
          while (
            awaitingAnswer() &&
            Date.now() < until &&
            sessionRef.current?.startedAt === s?.startedAt
          )
            await new Promise((r) => setTimeout(r, 100));
        }
        // A page the voice just opened isn't on screen yet: don't act on the one it replaces.
        if (navigating())
          return {
            error:
              "The page you opened is still loading on the guest’s screen. Wait a moment, then try again.",
          };
        const here = currentPage();
        const checkout =
          here.kind === "checkout" &&
          (s?.scope !== "hotel" || here.propertyId === s.propertyId);
        if (!checkout)
          return {
            error:
              "Checkout isn’t open on the guest’s screen. Call start_booking first.",
          };
        const loading = {
          error: "Checkout is still loading. Try again in a moment.",
        };
        if (call.name === "fill_guest_details") {
          const fill = here.actions?.fillGuest;
          if (!fill) return loading;
          return fill({
            name: text(args.name),
            phone: text(args.phone),
            notes: text(args.notes),
          });
        }
        const confirm = here.actions?.confirmBooking;
        if (!confirm) return loading;
        const want = bookingRequest(args);
        if (!want)
          return {
            ok: false,
            error:
              "Nothing was booked: say what you are booking. confirm_booking needs the property_id, room_type_id, items (several room types, else null), check_in, check_out, guests and rooms of the checkout on screen (from start_booking or the latest [Page] update).",
            on_screen: orderFacts(here.order),
          };
        noteOrder(pageOrderKey(here));
        const guestSaidYes = guestConfirmed();
        // The checkout checks the rest, in its own order: a different order than its URL is refused
        // (naming what's on screen), then price, sign-in and payment — which book nothing — and
        // only then the guest's yes.
        const result = await confirm({ ...want, guestConfirmed: guestSaidYes });
        // A yes books once: another booking needs a new read-back and a new yes.
        if (result.ok)
          consent.current = {
            ...NO_CONSENT,
            guestAt: consent.current.guestAt,
          };
        if (
          !result.ok &&
          result.needs === "guest confirmation" &&
          here.order &&
          sameOrder(here.order, want)
        )
          return { ...result, on_screen: orderFacts(here.order) };
        return result;
      }

      // The owner demo: runs on screen against the sample console, never the server.
      if (call.name === "start_owner_demo" || call.name === "show_demo_stop") {
        if (s?.scope !== "global")
          return {
            error: `The owner demo is part of the ${PRODUCT_NAME} concierge, not a hotel’s front desk.`,
          };
        const stops = TOUR_STOPS.map((t) => ({ id: t.id, title: t.title }));
        const onTour = () => currentPage().kind === "tour";
        if (call.name === "start_owner_demo") {
          if (!onTour() && !navigating()) {
            pendingNav.current = {
              url: TOUR_PATH,
              from: window.location.pathname + window.location.search,
              since: Date.now(),
            };
            routerRef.current.push(TOUR_PATH);
          }
          return {
            ok: true,
            message:
              "The owner demo is opening on the visitor’s screen: the console of a made-up sample hotel, with sample data only. Say so in a few words, then call show_demo_stop with the first stop.",
            stops,
            first_stop: stops[0].id,
          };
        }
        const stop = tourStop(args.stop);
        if (!stop)
          return {
            error: "Unknown stop: use one of the ids from start_owner_demo.",
            stops,
          };
        if (!onTour() && !navigating()) {
          const url = `${TOUR_PATH}?stop=${encodeURIComponent(stop.id)}`;
          pendingNav.current = {
            url,
            from: window.location.pathname + window.location.search,
            since: Date.now(),
          };
          routerRef.current.push(url);
        }
        // Wait for the demo to be on screen (it may still be opening), then show the stop.
        const until = Date.now() + TOUR_WAIT;
        let show = currentPage().actions?.showTourStop;
        while (
          !(onTour() && show) &&
          Date.now() < until &&
          sessionRef.current?.startedAt === s.startedAt
        ) {
          await new Promise((r) => setTimeout(r, 150));
          show = currentPage().actions?.showTourStop;
        }
        const shown = onTour() && show ? show(stop.id) : null;
        if (shown && !shown.ok) return shown;
        return {
          ok: true,
          on_screen: !!shown,
          stop: stop.id,
          title: stop.title,
          explain: stop.explain,
          next_stop: nextTourStop(stop.id),
          ...(shown
            ? {}
            : {
                note: "The demo didn’t open on the visitor’s screen (they may have moved away). Explain it anyway, or offer to open it again with start_owner_demo.",
              }),
        };
      }

      // The call and the page this tool started on: what it may change on screen afterwards.
      const startedAt = s?.startedAt;
      const before = pageToken();
      const at = currentPage();
      // "This hotel" means the one on screen, for the concierge.
      if (
        s?.scope === "global" &&
        PROPERTY_TOOLS.has(call.name) &&
        !text(args.property_id) &&
        at.propertyId
      )
        args = { ...args, property_id: at.propertyId };
      const res = await fetch("/api/voice/tool", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          name: call.name,
          arguments: JSON.stringify(args),
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        output?: Record<string, unknown>;
        error?: string;
      };
      if (!res.ok) return { error: body.error ?? "That lookup failed." };
      const output = body.output ?? {};
      if (output.error) return output;

      // Keep the screen in step with the conversation — only for this call, and only
      // on the page the tool started on (the guest may have moved on meanwhile).
      if (sessionRef.current?.startedAt !== startedAt || !liveRef.current)
        return output;
      const samePage = pageToken() === before;
      const here = currentPage();
      const hotelId =
        s?.scope === "hotel" ? s.propertyId : text(args.property_id);
      const stay: VoiceStay | null =
        typeof args.check_in === "string" && typeof args.check_out === "string"
          ? {
              checkIn: args.check_in,
              checkOut: args.check_out,
              guests: Number(args.guests) || 2,
              rooms: Number(args.rooms) || 1,
            }
          : null;
      if (
        call.name === "check_availability" &&
        stay &&
        samePage &&
        here.kind === "hotel" &&
        here.propertyId === hotelId
      )
        here.actions?.setStay?.(stay);
      if (
        (call.name === "start_booking" || call.name === "open_hotel") &&
        typeof output.url === "string" &&
        output.url.startsWith("/")
      ) {
        if (!samePage)
          return {
            ...output,
            opened: false,
            say: undefined,
            note: "The guest went to another page while this was loading, so nothing was opened on their screen. Ask whether they still want it before opening it again.",
          };
        const url = output.url;
        // Several room types open the checkout link itself; one opens through the hotel page.
        const select =
          call.name === "start_booking" &&
          typeof args.room_type_id === "string" &&
          !(Array.isArray(args.items) && args.items.length > 1) &&
          here.kind === "hotel" &&
          here.propertyId === hotelId
            ? here.actions?.selectRoom
            : undefined;
        // Until the address bar shows `url`, checkout tools wait (see navigating()).
        pendingNav.current = {
          url,
          from: window.location.pathname + window.location.search,
          since: Date.now(),
        };
        // The agent has this order (room, dates, party, total) to read back.
        if (call.name === "start_booking")
          toldAgent(
            orderKey({
              propertyId: output.property_id,
              roomTypeId: output.room_type_id,
              items: output.items,
              checkIn: output.check_in,
              checkOut: output.check_out,
              guests: output.guests,
              rooms: output.rooms,
              total: output.total,
            }),
          );
        if (select && stay) select(String(args.room_type_id), stay);
        else routerRef.current.push(url);
      }
      return output;
    },
    [
      awaitingAnswer,
      currentPage,
      guestConfirmed,
      navigating,
      noteOrder,
      pageToken,
      toldAgent,
    ],
  );

  // Mirrors the call's state so the options below can follow it in the same render.
  const [callState, setCallState] = React.useState<VoiceState>("idle");
  const busy =
    callState === "connecting" ||
    callState === "live" ||
    callState === "ending";
  // A running call keeps its own hotel and scope; otherwise "start" connects to what this page offers.
  const using = busy && session ? session : target;
  // The voice SDK is large: fetch it once someone shows intent, not on every page view.
  const [warm, setWarm] = React.useState(false);
  const prepare = React.useCallback(() => setWarm(true), []);
  // Pages for hotel owners: the concierge greets as the product guide. Read when a call starts.
  const intro =
    !busy && OWNER_PAGES.has(page.kind) ? ("owners" as const) : undefined;
  const voice = useLiveVoice({
    propertyId: using?.propertyId ?? undefined,
    scope: using?.scope ?? "global",
    intro,
    audience: "guest",
    onToolCall,
    onStateChange: setCallState,
    onTranscript,
    preload: warm,
  });
  const live =
    voice.state === "connecting" ||
    voice.state === "live" ||
    voice.state === "ending";
  const liveRef = React.useRef(live);
  liveRef.current = live;
  const phase = voicePhase({
    state: voice.state,
    speaking: voice.agentSpeaking,
    working: voice.working,
    muted: voice.muted,
    error: voice.error,
  });

  // --- Panel ---------------------------------------------------------------------
  const [open, setOpen] = React.useState(false);
  const panelRef = React.useRef<HTMLDivElement>(null);
  const launcherRef = React.useRef<HTMLButtonElement>(null);
  // The live pill's "open the call" button.
  const pillRef = React.useRef<HTMLButtonElement>(null);
  const wasOpen = React.useRef(false);

  const targetRef = React.useRef(target);
  targetRef.current = target;
  const startRef = React.useRef(voice.start);
  startRef.current = voice.start;
  const lastContext = React.useRef("");
  // End call closes the panel a beat later; a new call started in that beat cancels it.
  const closeTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelClose = React.useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  }, []);
  // When a minimised call ended with focus in the dock: the launcher takes focus once it mounts.
  const focusLauncherAt = React.useRef(0);
  const begin = React.useCallback(() => {
    cancelClose();
    setOpen(true);
    setWarm(true);
    if (liveRef.current || !targetRef.current) return;
    setSession({ ...targetRef.current, startedAt: Date.now() });
    lastContext.current = "";
    pendingNav.current = null;
    consent.current = { ...NO_CONSENT };
    focusLauncherAt.current = 0;
    // Straight from the click, so the microphone prompt (and iOS audio unlock) see the gesture.
    void startRef.current();
  }, [cancelClose]);

  const minimise = () => setOpen(false);
  const end = () => {
    voice.stop();
    cancelClose();
    closeTimer.current = setTimeout(() => {
      closeTimer.current = null;
      setOpen(false);
    }, 300);
  };
  React.useEffect(() => cancelClose, [cancelClose]);

  // Focus into the panel when it opens; back to the launcher or pill when it closes.
  React.useEffect(() => {
    if (open) {
      wasOpen.current = true;
      const frame = requestAnimationFrame(() => panelRef.current?.focus());
      return () => cancelAnimationFrame(frame);
    }
    if (wasOpen.current) {
      wasOpen.current = false;
      const frame = requestAnimationFrame(() =>
        (pillRef.current ?? launcherRef.current)?.focus({
          preventScroll: true,
        }),
      );
      return () => cancelAnimationFrame(frame);
    }
  }, [open]);

  // A minimised call ended (End on the pill, or the agent or network hung up): the pill and its
  // focused button go away, so focus moves to the launcher when it appears — unless the guest
  // is busy elsewhere on the page.
  const dockRef = React.useRef<HTMLDivElement>(null);
  const focusFree = React.useCallback(() => {
    const a = document.activeElement;
    return !a || a === document.body || !!dockRef.current?.contains(a);
  }, []);
  const wasLive = React.useRef(live);
  React.useEffect(() => {
    const was = wasLive.current;
    wasLive.current = live;
    if (was && !live && !open && focusFree())
      focusLauncherAt.current = Date.now();
  }, [live, open, focusFree]);
  const setLauncher = React.useCallback((el: HTMLButtonElement | null) => {
    launcherRef.current = el;
    const at = focusLauncherAt.current;
    if (!el || !at) return;
    focusLauncherAt.current = 0;
    // Only right after that call ended (the launcher waits for the pill's exit animation).
    if (Date.now() - at > 2500) return;
    requestAnimationFrame(() => {
      if (focusFree()) el.focus({ preventScroll: true });
    });
  }, [focusFree]);

  // A problem while minimised: show it.
  React.useEffect(() => {
    if (voice.error && session) setOpen(true);
  }, [voice.error, session]);

  // Staff console: no guest voice there; a running call ends.
  const stop = voice.stop;
  React.useEffect(() => {
    if (consolePath && liveRef.current) {
      stop();
      setOpen(false);
    }
  }, [consolePath, stop]);

  // --- Tell the agent where the guest is ------------------------------------------
  const contextLine = session && live ? describePage(page, session) : "";
  // The checkout order that line tells the agent about (for consent), if it names one.
  const contextOrder =
    session &&
    live &&
    session.bookable &&
    (session.scope === "global" || page.propertyId === session.propertyId)
      ? pageOrderKey(page)
      : null;
  const sendContext = voice.sendContext;
  React.useEffect(() => {
    if (voice.state !== "live" || !contextLine) return;
    // Let the page settle (data loads after navigation) before speaking up.
    const timer = setTimeout(() => {
      if (contextLine !== lastContext.current) {
        lastContext.current = contextLine;
        sendContext(`[Page] ${contextLine}`);
      }
      if (!navigating()) toldAgent(contextOrder);
    }, 900);
    return () => clearTimeout(timer);
  }, [
    voice.state,
    contextLine,
    contextOrder,
    sendContext,
    toldAgent,
    navigating,
  ]);

  // --- Placement -----------------------------------------------------------------
  const [collapsed, setCollapsed] = React.useState(false);
  React.useEffect(() => {
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() =>
        setCollapsed(window.scrollY > COLLAPSE_AFTER),
      );
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", update);
    };
  }, [pathname]);

  // Phones and tablets (below lg): past the first screenful the launcher and the live pill fold into
  // a 48px circle (the pill's End call is then in the panel), so they cover less of the page.
  const [desktop, setDesktop] = React.useState(false);
  React.useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const update = () => setDesktop(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  const scrollFold = collapsed && !desktop;
  const scrollFoldNow = React.useRef(scrollFold);
  scrollFoldNow.current = scrollFold;

  const showLauncher =
    !consolePath && !noLauncher && !!target && !live && !open;
  const showPill = !consolePath && live && !open;
  const showPanel =
    !consolePath && open && (live || !noLauncher) && (!!session || !!target);

  // Keep clear of anything marked data-voice-avoid (checkout's confirm button,
  // the hotel page's booking card; "desktop" = only from lg up), and of each
  // control inside data-voice-avoid-controls (the hotel page's room list and
  // stay search): fold into a 48px circle first, then lift above what's still
  // covered if that clears it.
  const floatRef = React.useRef<HTMLDivElement>(null);
  const [lift, setLift] = React.useState(0);
  const [avoidFold, setAvoidFold] = React.useState(false);
  const liftNow = React.useRef(0);
  const foldNow = React.useRef(false);
  // The live pill folds to its orb next to something to avoid, or for the scroll on phones.
  const pillFolded = avoidFold || scrollFold;
  // Unfolded widths, per kind, to know when unfolding would fit again.
  const wideWidths = React.useRef({ launcher: 0, pill: 0 });
  React.useEffect(() => {
    if (!showLauncher && !showPill) return;
    const kind = showLauncher ? "launcher" : "pill";
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const el = floatRef.current;
        if (!el) return;
        const r = el.getBoundingClientRect();
        // Unfolded width: measured while unfolded, estimated until then.
        const widths = wideWidths.current;
        if (!foldNow.current && !scrollFoldNow.current) widths[kind] = r.width;
        // Folded for the scroll: it stays a circle, whatever it passes.
        const wide = scrollFoldNow.current
          ? FOLDED
          : widths[kind] || (kind === "pill" ? 200 : 150);
        // Where it sits without a lift.
        const top = r.top + liftNow.current;
        const bottom = r.bottom + liftNow.current;
        const desktop = window.matchMedia("(min-width: 1024px)").matches;
        const avoid = [
          ...document.querySelectorAll<HTMLElement>(
            "[data-voice-avoid], [data-voice-avoid-controls] :is(button, a[href], input, select, textarea)",
          ),
        ]
          .filter((a) => a.dataset.voiceAvoid !== "desktop" || desktop)
          // A sliver of overlap (a card's padding) doesn't hide anything; on a single control it does.
          .map((a) => ({ b: a.getBoundingClientRect(), slack: a.hasAttribute("data-voice-avoid") ? 12 : 2 }))
          .filter(({ b }) => b.width > 0 && b.height > 0);
        /** What it would cover from `left` to its right edge, lifted by `up`. */
        const hits = (left: number, up = 0) =>
          avoid
            .filter(({ b, slack }) => b.right - slack > left && b.left + slack < r.right && b.bottom > top - up && b.top < bottom - up)
            .map(({ b }) => b);
        const fold = hits(r.right - wide).length > 0;
        const left = r.right - (fold ? FOLDED : wide);
        const max = window.innerHeight * 0.5;
        // Lift above what it covers; if that lands on the next control up (a stay search's
        // date fields above its steppers), above that too — within half the screen.
        let need = 0;
        for (let i = 0; i < 6; i++) {
          let next = need;
          for (const b of hits(left, need)) {
            const clear = bottom - b.top + 12;
            if (clear <= max) next = Math.max(next, clear); // can't clear a tall card: stay put rather than float mid-screen
          }
          if (next === need) break;
          need = next;
        }
        if (fold !== foldNow.current) {
          foldNow.current = fold;
          setAvoidFold(fold);
        }
        if (Math.abs(need - liftNow.current) > 1) {
          liftNow.current = need;
          setLift(need);
        }
      });
    };
    measure();
    window.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure);
    const ro =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(measure)
        : null;
    ro?.observe(document.body);
    if (floatRef.current) ro?.observe(floatRef.current);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
      ro?.disconnect();
    };
  }, [showLauncher, showPill, collapsed, desktop, pathname]);

  // --- Words for screen readers ---------------------------------------------------
  const shown = live && session ? session : (target ?? session);
  const name = shown?.name ?? PRODUCT_NAME;
  const scope = shown?.scope ?? "global";
  // Said after "the": "the Saltwater Inn front desk", never "the The Saltwater Inn…".
  const deskName =
    scope === "hotel"
      ? `${name.replace(/^the\s+/i, "")} front desk`
      : `${PRODUCT_NAME} concierge`;
  const [announce, setAnnounce] = React.useState("");
  const prevState = React.useRef(voice.state);
  React.useEffect(() => {
    const prev = prevState.current;
    prevState.current = voice.state;
    if (voice.state === "connecting")
      setAnnounce(`Connecting you to the ${deskName}…`);
    else if (voice.state === "live" && prev !== "live")
      setAnnounce(`Connected. The ${deskName} is listening.`);
    else if (voice.state === "idle" && (prev === "live" || prev === "ending"))
      setAnnounce("Call ended.");
  }, [voice.state, deskName]);

  const api = React.useMemo<VoiceDockApi>(
    () => ({
      available: !!target && !consolePath,
      label: target?.scope === "hotel" ? "Talk to us" : `Ask ${PRODUCT_NAME}`,
      start: begin,
      prepare,
    }),
    [target?.scope, !!target, consolePath, begin, prepare], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const brand = brandScope(shown?.brand);
  const launcherLabel =
    target?.scope === "hotel" ? "Talk to us" : `Ask ${PRODUCT_NAME}`;
  const titleId = `${uid}-title`;
  const noteId = `${uid}-note`;
  const offset = page.bottomOffset ?? 0;

  return (
    <VoicePageRegistryContext.Provider value={registry}>
      <VoiceDockContext.Provider value={api}>
        {children}
        {!consolePath && (
          <div
            ref={dockRef}
            data-voice-dock={instance}
            data-voice-session={session?.startedAt ?? ""}
            data-voice-state={voice.state}
            data-voice-scope={session?.scope ?? target?.scope ?? ""}
            data-voice-open={open ? "true" : "false"}
            style={brand.style}
            className={brand.className}
          >
            <p className="sr-only" aria-live="polite">
              {announce}
            </p>

            {/* Launcher and live pill: bottom-right, above the page's own bottom bar on phones. */}
            {(showLauncher || showPill) && (
              <div
                ref={floatRef}
                style={{
                  ["--vd-offset" as string]: `${offset}px`,
                  transform: lift ? `translateY(-${lift}px)` : undefined,
                }}
                className={cn(
                  "fixed right-[max(1rem,env(safe-area-inset-right))] z-40 transition-transform duration-200 motion-reduce:transition-none",
                  "bottom-[calc(env(safe-area-inset-bottom)_+_var(--vd-offset)_+_1rem)] lg:bottom-[max(1.5rem,env(safe-area-inset-bottom))] lg:right-6",
                )}
              >
                <AnimatePresence mode="wait" initial={false}>
                  {showLauncher ? (
                    <motion.button
                      ref={setLauncher}
                      key="launcher"
                      data-voice-launcher
                      type="button"
                      initial={{ opacity: 0, y: 12, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 12 }}
                      onClick={begin}
                      onPointerEnter={prepare}
                      onTouchStart={prepare}
                      onFocus={prepare}
                      aria-haspopup="dialog"
                      title={collapsed || avoidFold ? launcherLabel : undefined}
                      className={cn(
                        "inline-flex h-12 items-center justify-center gap-2 overflow-hidden whitespace-nowrap rounded-full bg-brand text-sm font-medium text-brand-foreground shadow-float transition-[width,padding,filter] duration-200 hover:brightness-[0.94] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none",
                        avoidFold
                          ? "w-12 px-0"
                          : collapsed
                            ? "w-12 px-0 lg:w-auto lg:pl-4 lg:pr-5"
                            : "pl-4 pr-5",
                      )}
                    >
                      <AudioLines className="size-5 shrink-0" aria-hidden />
                      <span
                        className={cn(
                          avoidFold
                            ? "sr-only"
                            : collapsed && "sr-only lg:not-sr-only",
                        )}
                      >
                        {launcherLabel}
                      </span>
                    </motion.button>
                  ) : (
                    // The live pill; folded (next to a booking card) it is just the orb, and End call is in the panel.
                    <motion.div
                      key="pill"
                      data-voice-pill={pillFolded ? "folded" : "full"}
                      initial={{ opacity: 0, y: 12, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 12 }}
                      className={cn(
                        "flex items-center rounded-full border bg-surface text-foreground shadow-float",
                        !pillFolded && "gap-1 p-1",
                      )}
                    >
                      <button
                        ref={pillRef}
                        type="button"
                        onClick={() => setOpen(true)}
                        aria-haspopup="dialog"
                        title={pillFolded ? VOICE_PHASE_LABEL[phase] : undefined}
                        className={cn(
                          "flex items-center rounded-full text-sm font-medium transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          pillFolded
                            ? "size-[46px] justify-center"
                            : "h-11 gap-2.5 pl-1 pr-3.5",
                        )}
                      >
                        <VoiceOrb
                          state={voice.state}
                          level={voice.level}
                          speaking={voice.agentSpeaking}
                          working={voice.working}
                          muted={voice.muted}
                          size={pillFolded ? 38 : 36}
                          tone="brand"
                        />
                        <span
                          className={cn(
                            "flex items-center gap-1.5",
                            pillFolded && "sr-only",
                          )}
                        >
                          <span
                            className="size-1.5 rounded-full bg-destructive motion-safe:animate-pulse"
                            aria-hidden
                          />
                          {VOICE_PHASE_LABEL[phase]}
                        </span>
                        <span className="sr-only">
                          Open the call with the {deskName}
                        </span>
                      </button>
                      {!pillFolded && (
                        <IconButton
                          label="End call"
                          variant="ghost"
                          size="icon-lg"
                          className="rounded-full text-destructive hover:bg-destructive-soft hover:text-destructive-soft-foreground"
                          onClick={end}
                        >
                          <PhoneOff aria-hidden />
                        </IconButton>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}

            <AnimatePresence>
              {showPanel && (
                <motion.div
                  ref={panelRef}
                  key="panel"
                  data-voice-panel
                  role="dialog"
                  aria-modal="false"
                  aria-labelledby={titleId}
                  aria-describedby={noteId}
                  tabIndex={-1}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      e.stopPropagation();
                      minimise();
                    }
                  }}
                  initial={{ opacity: 0, y: 24 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 24 }}
                  transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                  className={cn(
                    "fixed inset-x-0 bottom-0 z-[45] flex max-h-[75dvh] flex-col overflow-hidden rounded-t-3xl border-t bg-card pb-[max(1rem,env(safe-area-inset-bottom))] text-card-foreground shadow-float focus:outline-none",
                    "sm:inset-x-auto sm:bottom-[max(1.5rem,env(safe-area-inset-bottom))] sm:right-6 sm:max-h-[min(38rem,calc(100dvh-3rem))] sm:w-[380px] sm:rounded-3xl sm:border sm:pb-0",
                  )}
                >
                  <div
                    className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-border-strong/50 sm:hidden"
                    aria-hidden
                  />
                  <div className="flex shrink-0 items-start gap-3 border-b px-5 pb-4 pt-3 sm:pt-5">
                    <VoiceOrb
                      state={voice.state}
                      level={voice.level}
                      speaking={voice.agentSpeaking}
                      working={voice.working}
                      muted={voice.muted}
                      size={44}
                      tone="brand"
                    />
                    <div className="min-w-0 flex-1">
                      <h2
                        id={titleId}
                        className="truncate font-display text-lg leading-tight"
                      >
                        {scope === "hotel" ? name : `${PRODUCT_NAME} concierge`}
                      </h2>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        <VoiceStatus phase={phase} tone="brand" />
                        <Badge variant="agent" size="sm" icon={Sparkles}>
                          AI voice
                        </Badge>
                      </div>
                    </div>
                    <IconButton
                      label={live ? "Minimise (the call keeps going)" : "Close"}
                      variant="ghost"
                      size="icon-lg"
                      className="-mr-2 -mt-1 shrink-0 text-muted-foreground"
                      onClick={minimise}
                    >
                      {live ? <ChevronDown aria-hidden /> : <X aria-hidden />}
                    </IconButton>
                  </div>

                  <Transcript
                    captions={voice.captions}
                    agentName={scope === "hotel" ? name : "Concierge"}
                    hint={
                      voice.state === "connecting"
                        ? "Connecting… If your browser asks, allow the microphone."
                        : scope === "hotel"
                          ? "Ask about rooms, prices, parking or anything else. Say what you’d like to book and it opens on your screen."
                          : "Just say where and when. For example, “a room in Santa Cruz this weekend for two”."
                    }
                  />

                  {voice.error && (
                    <div
                      role="alert"
                      className="mx-5 mb-1 shrink-0 rounded-xl bg-destructive-soft px-3.5 py-2.5 text-sm text-destructive-soft-foreground"
                    >
                      <p className="font-medium">
                        We couldn’t connect the call.
                      </p>
                      <p className="mt-0.5 text-xs">{voice.error}</p>
                    </div>
                  )}

                  <div className="shrink-0 px-5 pt-3">
                    <div className="flex justify-center gap-2">
                      {live ? (
                        <>
                          <IconButton
                            label="Mute microphone"
                            aria-pressed={voice.muted}
                            variant="outline"
                            size="icon-lg"
                            onClick={voice.toggleMute}
                            disabled={voice.state === "ending"}
                            className={cn(
                              voice.muted &&
                                "border-destructive/40 text-destructive",
                            )}
                          >
                            {voice.muted ? (
                              <MicOff aria-hidden />
                            ) : (
                              <Mic aria-hidden />
                            )}
                          </IconButton>
                          <Button
                            variant="destructive"
                            className="h-11 rounded-xl px-5"
                            onClick={end}
                            disabled={voice.state === "ending"}
                          >
                            <PhoneOff aria-hidden /> End call
                          </Button>
                        </>
                      ) : (
                        <Button
                          variant="brand"
                          className="h-11 rounded-xl px-5"
                          onClick={begin}
                          disabled={!target}
                        >
                          <AudioLines aria-hidden />{" "}
                          {voice.error
                            ? "Try again"
                            : voice.captions.length
                              ? "Start a new call"
                              : "Start talking"}
                        </Button>
                      )}
                    </div>
                    <p
                      id={noteId}
                      className="mt-3 text-center text-xs leading-relaxed text-muted-foreground sm:mb-4"
                    >
                      You’re talking to an AI voice that uses live prices. It
                      only books when you say yes. Never share card details by
                      voice.
                    </p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
      </VoiceDockContext.Provider>
    </VoicePageRegistryContext.Provider>
  );
}

/** The conversation so far, newest at the bottom; follows new lines unless the guest scrolled up. */
function Transcript({
  captions,
  agentName,
  hint,
}: {
  captions: Caption[];
  agentName: string;
  hint: string;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const follow = React.useRef(true);
  React.useEffect(() => {
    const el = ref.current;
    if (el && follow.current) el.scrollTop = el.scrollHeight;
  }, [captions]);
  return (
    <div
      ref={ref}
      role="log"
      aria-label="Conversation"
      tabIndex={0}
      onScroll={(e) => {
        const el = e.currentTarget;
        follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
      }}
      className="min-h-[7rem] flex-1 overflow-y-auto px-5 py-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
    >
      {captions.length === 0 ? (
        <p className="text-sm leading-relaxed text-muted-foreground">{hint}</p>
      ) : (
        <ol className="space-y-2.5">
          {captions.map((c) => (
            <li
              key={c.id}
              className={cn(
                "flex",
                c.role === "user" ? "justify-end" : "justify-start",
              )}
            >
              <p
                className={cn(
                  "max-w-[85%] whitespace-pre-line rounded-2xl px-3.5 py-2 text-sm leading-relaxed",
                  c.role === "user"
                    ? "rounded-br-md bg-muted text-foreground"
                    : "rounded-bl-md bg-brand-soft text-brand-soft-foreground",
                )}
              >
                <span className="sr-only">
                  {c.role === "user" ? "You: " : `${agentName}: `}
                </span>
                {c.text}
              </p>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/**
 * "Ask HotelOne" — a small entry point a page can place in its content (the
 * home page does). Renders nothing where a call can't be started.
 */
export function TalkToConcierge({ className }: { className?: string }) {
  const dock = useVoiceDock();
  if (!dock?.available) return null;
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border bg-surface px-4 py-3 shadow-xs",
        className,
      )}
    >
      <span
        className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-agent-soft text-agent-soft-foreground"
        aria-hidden
      >
        <AudioLines className="size-[18px]" />
      </span>
      <p className="min-w-0 flex-1 text-sm">
        <span className="font-medium">Looking for a room?</span>{" "}
        <span className="text-muted-foreground">Just say where and when.</span>
      </p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-10"
        onClick={dock.start}
        onPointerEnter={dock.prepare}
        onTouchStart={dock.prepare}
        onFocus={dock.prepare}
      >
        <AudioLines aria-hidden /> {dock.label}
      </Button>
    </div>
  );
}
