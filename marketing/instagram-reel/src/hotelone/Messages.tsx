// The voice messages inbox (src/app/admin/voice/page.tsx, Requests()),
// rebuilt at the real narrow layout: a Card with divide-y, one <article> per
// request, newest first (the API orders by status desc, createdAt desc).
// bookingLink() and formatPhone() are ported verbatim, so the row text and the
// phone button read exactly as the app would render the stored request.
import React from 'react';
import {random} from 'remotion';
import {Icon, type IconName} from './icons.tsx';
import {Badge, Button, Card} from './primitives.tsx';
import {alpha, RADIUS, useHO, type Mode} from './tokens.ts';

// ─── App logic, ported ──────────────────────────────────────────────────────

/**
 * page.tsx bookingLink(): phone booking requests end with the pre-filled
 * checkout link. Only the path is kept (the last match), and the trailing
 * colon before it turns into a period.
 */
export function bookingLink(message: string): {text: string; path: string | null} {
  const matches = [...message.matchAll(/(?:https?:\/\/\S+?)?(\/properties\/[\w-]+\/book\?\S+)$/g)];
  const last = matches.at(-1);
  if (!last || last.index === undefined) return {text: message, path: null};
  return {text: message.slice(0, last.index).replace(/:\s*$/, '.').trim(), path: last[1]};
}

/** src/lib/format.ts formatPhone() for NANP numbers: "+19285550147" -> "+1 (928) 555-0147". Anything else comes back trimmed. */
export function formatPhone(raw: string | null | undefined, opts: {national?: boolean} = {}): string {
  if (!raw) return '';
  const trimmed = raw.trim();
  let n = trimmed.replace(/\(\s*0\s*\)/g, '').replace(/[\s().-]/g, '');
  if (n.startsWith('00')) n = `+${n.slice(2)}`;
  if (!/^\+[1-9]\d{6,14}$/.test(n)) return trimmed;
  const digits = n.slice(1);
  if (digits.length === 11 && digits.startsWith('1')) {
    const local = `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
    return opts.national ? local : `+1 ${local}`;
  }
  return trimmed;
}

/** page.tsx SOURCE labels and icons. */
export const SOURCE: Record<string, {label: string; icon: IconName}> = {
  PHONE: {label: 'Phone call', icon: 'phone'},
  WHATSAPP: {label: 'WhatsApp', icon: 'message-circle'},
  VOICE: {label: 'Booking page', icon: 'globe'},
  AGENT: {label: 'AI assistant', icon: 'sparkles'},
};

// ─── Story data ─────────────────────────────────────────────────────────────

export type GuestRequest = {
  id: string;
  name: string;
  /** E.164, as guestTools saves the caller ID. */
  phone: string | null;
  email: string | null;
  /** The stored message, link included (bookingLink() strips it for display). */
  message: string;
  source: 'PHONE' | 'WHATSAPP' | 'VOICE' | 'AGENT';
  status: 'NEW' | 'DONE';
  /** timeAgo() output, e.g. "2m ago", "10m ago", "5h ago". */
  ago: string;
};

/** The pre-filled checkout path checkoutPath() writes (fictional property and room ids). */
export const SAM_LINK = 'https://hotelone.site/properties/cmgstarlite7q2x9/book?roomTypeId=cmgqueen4k8w1d&checkIn=2026-10-23&checkOut=2026-10-25&guests=2&rooms=1';

/** Rita's leave_message (summarised by the model: "Rita says hi to Gus."), from her own number. */
export const RITA_REQUEST: GuestRequest = {
  id: 'rita',
  name: 'Rita',
  phone: '+19285550163',
  email: null,
  message: 'Rita says hi to Gus.',
  source: 'PHONE',
  status: 'NEW',
  ago: '2m ago',
};

/** Sam's request_booking, in submitBookingRequest()'s exact format (shared.ts L146). */
export const SAM_REQUEST: GuestRequest = {
  id: 'sam',
  name: 'Sam Ortiz',
  phone: '+19285550147',
  email: 'sam.ortiz@example.com',
  message: `Phone booking request: Queen Room, Fri, Oct 23 to Sun, Oct 25 (2 nights), 2 guests. Quoted total: $238.00. Confirm with the guest, then send them this link to finish booking: ${SAM_LINK}`,
  source: 'PHONE',
  status: 'NEW',
  ago: '10m ago',
};

/** The inbox newest first. 'night' = viewed at about 2:24 (S20: 2m / 10m ago); 'morning' = 6:52 (S22-S25: both 5h ago). */
export const inbox = (when: 'night' | 'morning'): GuestRequest[] =>
  when === 'night' ? [RITA_REQUEST, SAM_REQUEST] : [{...RITA_REQUEST, ago: '5h ago'}, {...SAM_REQUEST, ago: '5h ago'}];

// ─── Marker circle (hand-drawn, for the S20 detective board) ────────────────

/**
 * A wobbly hand-drawn ellipse around its parent, drawn on by `progress` (0..1): a little over one turn,
 * so the pen overshoots its start like a real marker. The path lives on a stretched unit box; the visible
 * stroke keeps an even width (non-scaling-stroke) and each part (the turn, then the overshoot) is revealed
 * through its own mask stroke, whose dash runs in the unit box where pathLength is exact.
 */
export const MarkerCircle: React.FC<{progress: number; color: string; pad?: number; padY?: number; strokeWidth?: number; seed?: string}> = ({progress, color, pad = 7, padY, strokeWidth = 2.5, seed = 'm'}) => {
  const py = padY ?? pad * 0.8;
  const uid = `mc${React.useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const p = Math.max(0, Math.min(1, progress));
  if (p <= 0) return null;
  const turns = 1.12;
  const a0 = -2.2 + random(`${seed}a`) * 0.4;
  const pathFor = (k0: number, k1: number, n: number) => {
    const pts: string[] = [];
    for (let i = 0; i <= n; i++) {
      const k = k0 + ((k1 - k0) * i) / n;
      const a = a0 + k * turns * Math.PI * 2;
      const wob = 1 + (random(`${seed}${Math.floor(k * 6)}`) - 0.5) * 0.05 + k * 0.035;
      const x = 0.5 + 0.5 * Math.cos(a) * wob;
      const y = 0.5 + 0.5 * Math.sin(a) * wob * (1 - 0.04 * Math.sin(k * 7));
      pts.push(`${i === 0 ? 'M' : 'L'}${x.toFixed(4)} ${y.toFixed(4)}`);
    }
    return pts.join(' ');
  };
  const split = 1 / turns;
  const parts = [
    {d: pathFor(0, split, 48), reveal: Math.min(1, p / split)},
    {d: pathFor(split, 1, 8), reveal: Math.max(0, (p - split) / (1 - split))},
  ];
  return (
    <svg
      viewBox="0 0 1 1"
      preserveAspectRatio="none"
      style={{position: 'absolute', left: -pad, top: -py, width: `calc(100% + ${pad * 2}px)`, height: `calc(100% + ${py * 2}px)`, overflow: 'visible', pointerEvents: 'none', zIndex: 3}}
      aria-hidden
    >
      <defs>
        {parts.map((part, i) => (
          <mask key={i} id={`${uid}${i}`} maskUnits="userSpaceOnUse" x={-1} y={-1} width={3} height={3}>
            <path d={part.d} fill="none" stroke="#fff" strokeWidth={0.22} strokeLinecap="butt" pathLength={1} strokeDasharray={`${part.reveal} 2`} />
          </mask>
        ))}
      </defs>
      {parts.map((part, i) =>
        part.reveal > 0 ? (
          <path key={i} d={part.d} mask={`url(#${uid}${i})`} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        ) : null,
      )}
    </svg>
  );
};

// ─── Row ────────────────────────────────────────────────────────────────────

/** Per-element effects for the film. All optional; with none the row renders exactly as the app does. */
export type RowFx = {
  /** Whole-row opacity (S20 article 1 at 0.3; S24 the done row fading out). */
  opacity?: number;
  /** translateX in CSS px (S24: the row slides left as it leaves). */
  x?: number;
  /** 0..1 collapses the row's height to 0 (S24: the list closes up). */
  collapse?: number;
  /** Show only the top N CSS px of the row (a collage crop, S20 article 1). */
  maxHeight?: number;
  /** Hide this many CSS px from the top of the row (with maxHeight: a window into the row, e.g. S20's 70 px strip of article 1 skipping its top padding). */
  cropTop?: number;
  /** 0..1 focus ring on the row (S22: 2px primary at 30%). */
  focus?: number;
  /** Everything in the message except "Quoted total: $X" is dimmed/blurred (S20: 0.4 and ~1.4px). */
  dimMessage?: {opacity: number; blur?: number};
  /** "Quoted total: $238.00": a highlighter sweep (S25, brass at 30%) and/or a marker circle (S20, red). */
  total?: {marker?: number; markerColor?: string; circle?: number; circleColor?: string};
  /** The phone button: opacity, a marker circle (S20), a press (0..1). */
  phone?: {opacity?: number; circle?: number; circleColor?: string; pressed?: number};
  email?: {opacity?: number};
  copy?: {opacity?: number; pressed?: number};
  markDone?: {opacity?: number; pressed?: number; hover?: number};
};

export type MessageRowProps = {
  request: GuestRequest;
  fx?: RowFx;
  /** Opacity of the divide-y top border (drawn on every row but the first). Default 1. */
  divider?: number;
  /** Round the focus ring's corners to match the card (first/last row). */
  first?: boolean;
  last?: boolean;
  mode?: Mode;
};

const TOTAL_RE = /Quoted total: \$[\d,]+\.\d{2}/;

/**
 * One <article>: `flex flex-col gap-3 p-4` on phones. Header (name 600, outline sm source badge, timeAgo),
 * message (text-sm leading-relaxed, bookingLink() text), ghost sm buttons in text-primary that wrap
 * (phone, email, Copy booking link), then the secondary sm "Mark done" on its own line (self-start).
 */
export const MessageRow: React.FC<MessageRowProps> = ({request: r, fx = {}, divider = 1, first, last, mode}) => {
  const t = useHO(mode);
  const link = bookingLink(r.message);
  const src = SOURCE[r.source] ?? SOURCE.VOICE;
  const done = r.status === 'DONE';
  const text = link.text;
  const m = TOTAL_RE.exec(text);
  const dim = fx.dimMessage;
  const dimStyle: React.CSSProperties | undefined = dim ? {opacity: dim.opacity, filter: dim.blur ? `blur(${dim.blur}px)` : undefined} : undefined;
  const marker = fx.total?.marker ?? 0;
  const markerColor = fx.total?.markerColor ?? alpha(t.highlight, 0.3);
  const collapse = Math.max(0, Math.min(1, fx.collapse ?? 0));
  const focus = Math.max(0, Math.min(1, fx.focus ?? 0));
  const radius = `${first ? RADIUS['2xl'] - 1 : 0}px ${first ? RADIUS['2xl'] - 1 : 0}px ${last ? RADIUS['2xl'] - 1 : 0}px ${last ? RADIUS['2xl'] - 1 : 0}px`;

  const message = (
    <p style={{margin: '6px 0 0', fontSize: 14, lineHeight: 1.625, color: done ? t.mutedForeground : t.foreground}}>
      {m ? (
        <>
          <span style={dimStyle}>{text.slice(0, m.index)}</span>
          <span
            style={{
              position: 'relative',
              backgroundImage: marker > 0 ? `linear-gradient(${markerColor}, ${markerColor})` : undefined,
              backgroundRepeat: 'no-repeat',
              backgroundSize: `${Math.max(0, Math.min(1, marker)) * 100}% 82%`,
              backgroundPosition: '0 75%',
            }}
          >
            {m[0]}
            {fx.total?.circle ? <MarkerCircle progress={fx.total.circle} color={fx.total.circleColor ?? t.destructive} seed={`${r.id}total`} pad={11} padY={5} /> : null}
          </span>
          <span style={dimStyle}>{text.slice(m.index + m[0].length)}</span>
        </>
      ) : (
        <span style={dimStyle}>{text}</span>
      )}
    </p>
  );

  const body = (
    <article
      style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        padding: 16,
        borderTop: first ? undefined : `1px solid ${divider >= 1 ? t.border : alpha(t.border, Math.max(0, divider))}`,
        borderRadius: radius,
        boxShadow: focus > 0 ? `inset 0 0 0 2px ${alpha(t.primary, 0.3 * focus)}` : undefined,
        opacity: fx.opacity ?? 1,
        transform: fx.x ? `translateX(${fx.x}px)` : undefined,
        maxHeight: fx.maxHeight !== undefined ? fx.maxHeight + (fx.cropTop ?? 0) : undefined,
        marginTop: fx.cropTop ? -fx.cropTop : undefined,
        overflow: fx.maxHeight !== undefined ? 'hidden' : undefined,
        boxSizing: 'border-box',
      }}
    >
      <div style={{minWidth: 0, flex: 1}}>
        <div style={{display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 8, rowGap: 4}}>
          <h3 style={{margin: 0, fontSize: 14, lineHeight: '20px', fontWeight: 600}}>{r.name}</h3>
          <Badge variant="outline" size="sm" icon={src.icon} color={t.mutedForeground}>
            {src.label}
          </Badge>
          <time style={{fontSize: 12, lineHeight: '16px', color: t.mutedForeground}}>{r.ago}</time>
        </div>
        {message}
        <div style={{marginLeft: -8, marginTop: 6, display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 4, rowGap: 4, fontSize: 14}}>
          {r.phone ? (
            <span style={{position: 'relative', display: 'inline-flex', opacity: fx.phone?.opacity ?? 1}}>
              <Button variant="ghost" size="sm" icon="phone" paddingX={8} color={t.primary} pressed={fx.phone?.pressed}>
                <span style={{fontVariantNumeric: 'tabular-nums'}}>{formatPhone(r.phone)}</span>
              </Button>
              {fx.phone?.circle ? <MarkerCircle progress={fx.phone.circle} color={fx.phone.circleColor ?? t.destructive} seed={`${r.id}phone`} pad={6} /> : null}
            </span>
          ) : null}
          {r.email ? (
            <span style={{display: 'inline-flex', maxWidth: '100%', opacity: fx.email?.opacity ?? 1}}>
              <Button variant="ghost" size="sm" icon="mail" paddingX={8} color={t.primary} style={{maxWidth: '100%'}}>
                <span style={{overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}}>{r.email}</span>
              </Button>
            </span>
          ) : null}
          {link.path ? (
            <span style={{display: 'inline-flex', opacity: fx.copy?.opacity ?? 1}}>
              <Button variant="ghost" size="sm" icon="copy" paddingX={8} color={t.primary} pressed={fx.copy?.pressed} hover={fx.copy?.pressed ? fx.copy.pressed : 0}>
                Copy booking link
              </Button>
            </span>
          ) : null}
        </div>
      </div>
      <span style={{alignSelf: 'flex-start', display: 'inline-flex', opacity: fx.markDone?.opacity ?? 1}}>
        {done ? (
          <Button variant="ghost" size="sm" icon="rotate-ccw">
            Reopen
          </Button>
        ) : (
          <Button variant="secondary" size="sm" icon="check" pressed={fx.markDone?.pressed} hover={fx.markDone?.hover}>
            Mark done
          </Button>
        )}
      </span>
    </article>
  );

  const cropped = fx.cropTop ? <div style={{overflow: 'hidden'}}>{body}</div> : body;
  if (collapse <= 0) return cropped;
  // grid-template-rows 1fr -> 0fr interpolates the row height without measuring it.
  return (
    <div style={{display: 'grid', gridTemplateRows: `${1 - collapse}fr`}}>
      <div style={{minHeight: 0, overflow: 'hidden'}}>{cropped}</div>
    </div>
  );
};

// ─── List ───────────────────────────────────────────────────────────────────

export type MessagesListProps = {
  /** Newest first, as the API returns them. Use inbox('night' | 'morning') for the story's two rows. */
  requests: GuestRequest[];
  /** Effects per request id. */
  fx?: Record<string, RowFx | undefined>;
  /** Clip the rows to the card (useful while a row slides out). */
  clip?: boolean;
  mode?: Mode;
  style?: React.CSSProperties;
};

/** `<Card className="divide-y p-0">` of MessageRows. */
export const MessagesList: React.FC<MessagesListProps> = ({requests, fx = {}, clip, mode, style}) => {
  // divide-y: a row gets a top border when a visible row sits above it. A row that is
  // collapsing fades the border of the row below it away as it goes.
  let above = 0;
  return (
    <Card mode={mode} style={{padding: 0, overflow: clip ? 'hidden' : undefined, ...style}}>
      {requests.map((r, i) => {
        const f = fx[r.id];
        const divider = Math.min(1, above);
        above += 1 - Math.max(0, Math.min(1, f?.collapse ?? 0));
        return <MessageRow key={r.id} request={r} fx={f} divider={divider} first={i === 0} last={i === requests.length - 1} mode={mode} />;
      })}
    </Card>
  );
};
