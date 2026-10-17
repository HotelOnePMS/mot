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
  pageFromPath,
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
/** Routes without a launcher (a running call keeps its pill). */
const NO_LAUNCHER = [
  /^\/login(\/|$)/,
  /^\/register(\/|$)/,
  /^\/onboarding(\/|$)/,
];
/** Tools that take a property_id the browser can fill in from the hotel on screen (concierge). */
const PROPERTY_TOOLS = new Set([
  "get_property_info",
  "check_availability",
  "start_booking",
  "leave_message",
  "use_skill",
]);

interface VoiceStatusResponse {
  provider: "openai" | "elevenlabs";
  concierge: boolean;
  hotel: {
    id: string;
    name: string;
    primaryColor: string | null;
    available: boolean;
  } | null;
}

/** Who a call is with: one hotel's front desk or the HotelOne concierge. */
interface DockTarget {
  scope: "hotel" | "global";
  propertyId: string | null;
  name: string;
  brand: string | null;
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

/** One short sentence for the agent about what is on the guest's screen. */
function describePage(page: VoicePage, s: DockSession): string {
  const name = page.propertyName?.trim();
  const fallback: Record<VoicePage["kind"], string> = {
    home: `the ${PRODUCT_NAME} home page`,
    directory: "the list of hotels",
    hotel: name ? `${name}’s page` : "a hotel’s page",
    checkout: name ? `checkout at ${name}` : "checkout",
    booking: "their booking page",
    trips: "their trips (My trips)",
    other: "another page of the site",
  };
  const place = page.summary?.trim() || fallback[page.kind];
  if (s.scope === "hotel") {
    if (page.propertyId && page.propertyId === s.propertyId)
      return `The guest is on ${place}.`;
    return `The guest moved to another page of the site. You still only help with ${s.name}.`;
  }
  return `The guest is on ${place}.${page.propertyId ? ` Its property_id is ${page.propertyId}.` : ""}`;
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
  const [, setVersion] = React.useState(0);
  const registry = React.useMemo<VoicePageRegistry>(
    () => ({
      register(id, page) {
        entries.current.delete(id);
        entries.current.set(id, page); // last registered wins
        setVersion((v) => v + 1);
      },
      unregister(id) {
        if (entries.current.delete(id)) setVersion((v) => v + 1);
      },
      changed() {
        setVersion((v) => v + 1);
      },
    }),
    [],
  );
  const currentPage = React.useCallback((): VoicePage => {
    const fromPath = pageFromPath(window.location.pathname);
    const registered = [...entries.current.values()].at(-1)?.current;
    if (!registered) return fromPath;
    return {
      ...registered,
      propertyId: registered.propertyId ?? fromPath.propertyId,
    };
  }, []);
  const fromPath = pageFromPath(pathname);
  const registered = [...entries.current.values()].at(-1)?.current;
  const page: VoicePage = registered
    ? {
        ...registered,
        propertyId: registered.propertyId ?? fromPath.propertyId,
      }
    : fromPath;

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
        };
      }
    } else if (status.concierge) {
      target = {
        scope: "global",
        propertyId: null,
        name: PRODUCT_NAME,
        brand: null,
      };
    }
  }

  // --- The call ----------------------------------------------------------------
  const [session, setSession] = React.useState<DockSession | null>(null);
  const sessionRef = React.useRef(session);
  sessionRef.current = session;
  const routerRef = React.useRef(router);
  routerRef.current = router;

  const onToolCall = React.useCallback(
    async (
      call: VoiceToolCall,
      { token }: { token: string },
    ): Promise<unknown> => {
      const s = sessionRef.current;
      const here = currentPage();
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
        const checkout =
          here.kind === "checkout" &&
          (s?.scope !== "hotel" || here.propertyId === s.propertyId);
        const action =
          call.name === "fill_guest_details"
            ? here.actions?.fillGuest
            : here.actions?.confirmBooking;
        if (!checkout)
          return {
            error:
              "Checkout isn’t open on the guest’s screen — call start_booking first.",
          };
        if (!action)
          return {
            error: "Checkout is still loading — try again in a moment.",
          };
        if (call.name === "confirm_booking")
          return here.actions!.confirmBooking!();
        return here.actions!.fillGuest!({
          name: text(args.name),
          phone: text(args.phone),
          notes: text(args.notes),
        });
      }

      // "This hotel" means the one on screen, for the concierge.
      if (
        s?.scope === "global" &&
        PROPERTY_TOOLS.has(call.name) &&
        !text(args.property_id) &&
        here.propertyId
      )
        args = { ...args, property_id: here.propertyId };
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

      // Keep the screen in step with the conversation.
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
        here.kind === "hotel" &&
        here.propertyId === hotelId
      )
        here.actions?.setStay?.(stay);
      if (
        (call.name === "start_booking" || call.name === "open_hotel") &&
        typeof output.url === "string" &&
        output.url.startsWith("/")
      ) {
        const url = output.url;
        const select =
          call.name === "start_booking" &&
          here.kind === "hotel" &&
          here.propertyId === hotelId
            ? here.actions?.selectRoom
            : undefined;
        // A beat later, so the agent's "I've opened it" lines up with the page changing.
        setTimeout(
          () =>
            select && stay
              ? select(String(args.room_type_id), stay)
              : routerRef.current.push(url),
          500,
        );
      }
      return output;
    },
    [currentPage],
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
  const voice = useLiveVoice({
    propertyId: using?.propertyId ?? undefined,
    scope: using?.scope ?? "global",
    audience: "guest",
    onToolCall,
    onStateChange: setCallState,
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
  const begin = React.useCallback(() => {
    setOpen(true);
    setWarm(true);
    if (liveRef.current || !targetRef.current) return;
    setSession({ ...targetRef.current, startedAt: Date.now() });
    lastContext.current = "";
    // Straight from the click, so the microphone prompt (and iOS audio unlock) see the gesture.
    void startRef.current();
  }, []);

  const minimise = () => setOpen(false);
  const end = () => {
    voice.stop();
    setTimeout(() => setOpen(false), 300);
  };

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
  const sendContext = voice.sendContext;
  React.useEffect(() => {
    if (voice.state !== "live" || !contextLine) return;
    // Let the page settle (data loads after navigation) before speaking up.
    const timer = setTimeout(() => {
      if (contextLine === lastContext.current) return;
      lastContext.current = contextLine;
      sendContext(`[Page] ${contextLine}`);
    }, 900);
    return () => clearTimeout(timer);
  }, [voice.state, contextLine, sendContext]);

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

  const showLauncher =
    !consolePath && !noLauncher && !!target && !live && !open;
  const showPill = !consolePath && live && !open;
  const showPanel =
    !consolePath && open && (live || !noLauncher) && (!!session || !!target);

  // Keep clear of anything marked data-voice-avoid (checkout's confirm button,
  // the hotel page's booking card; "desktop" = only from lg up): fold into a
  // 48px circle first, then lift above what's still covered if that clears it.
  const floatRef = React.useRef<HTMLDivElement>(null);
  const [lift, setLift] = React.useState(0);
  const [avoidFold, setAvoidFold] = React.useState(false);
  const liftNow = React.useRef(0);
  const foldNow = React.useRef(false);
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
        if (!foldNow.current) widths[kind] = r.width;
        const wide = widths[kind] || (kind === "pill" ? 200 : 150);
        // Where it sits without a lift.
        const top = r.top + liftNow.current;
        const bottom = r.bottom + liftNow.current;
        const desktop = window.matchMedia("(min-width: 1024px)").matches;
        const avoid = [...document.querySelectorAll<HTMLElement>("[data-voice-avoid]")]
          .filter((a) => a.dataset.voiceAvoid !== "desktop" || desktop)
          .map((a) => a.getBoundingClientRect())
          .filter((b) => b.width > 0 && b.height > 0);
        // A sliver of overlap (a card's padding) doesn't hide anything.
        const hits = (left: number) =>
          avoid.filter((b) => b.right - 12 > left && b.left + 12 < r.right && b.bottom > top && b.top < bottom);
        const fold = hits(r.right - wide).length > 0;
        const max = window.innerHeight * 0.5;
        let need = 0;
        for (const b of hits(r.right - (fold ? FOLDED : wide))) {
          const clear = bottom - b.top + 12;
          if (clear <= max) need = Math.max(need, clear); // can't clear a tall card: stay put rather than float mid-screen
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
  }, [showLauncher, showPill, collapsed, pathname]);

  // --- Words for screen readers ---------------------------------------------------
  const shown = live && session ? session : (target ?? session);
  const name = shown?.name ?? PRODUCT_NAME;
  const scope = shown?.scope ?? "global";
  const deskName =
    scope === "hotel" ? `${name} front desk` : `${PRODUCT_NAME} concierge`;
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
                      ref={launcherRef}
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
                      data-voice-pill={avoidFold ? "folded" : "full"}
                      initial={{ opacity: 0, y: 12, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 12 }}
                      className={cn(
                        "flex items-center rounded-full border bg-surface text-foreground shadow-float",
                        !avoidFold && "gap-1 p-1",
                      )}
                    >
                      <button
                        ref={pillRef}
                        type="button"
                        onClick={() => setOpen(true)}
                        aria-haspopup="dialog"
                        title={avoidFold ? VOICE_PHASE_LABEL[phase] : undefined}
                        className={cn(
                          "flex items-center rounded-full text-sm font-medium transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          avoidFold
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
                          size={avoidFold ? 38 : 36}
                          tone="brand"
                        />
                        <span
                          className={cn(
                            "flex items-center gap-1.5",
                            avoidFold && "sr-only",
                          )}
                        >
                          <span
                            className="size-1.5 rounded-full bg-destructive motion-safe:animate-pulse"
                            aria-hidden
                          />
                          {VOICE_PHASE_LABEL[phase]}
                        </span>
                        <span className="sr-only">
                          — open the call with the {deskName}
                        </span>
                      </button>
                      {!avoidFold && (
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
                      label={live ? "Minimise — the call keeps going" : "Close"}
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
                          ? "Ask about rooms, prices, parking — anything. Say what you’d like to book and it opens on your screen."
                          : "Just say where and when — for example, “a room in Santa Cruz this weekend for two”."
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
                            label={
                              voice.muted
                                ? "Turn microphone on"
                                : "Turn microphone off"
                            }
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
                      only books when you say yes — never share card details by
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
