'use client';

import * as React from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { getSession, signIn, signOut, useSession } from 'next-auth/react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ArrowLeft, Building2, CalendarDays, Check, CreditCard, Lock, ShieldCheck, UserRound, Users } from 'lucide-react';
import type { StayQuote } from '@/lib/dto';
import { linesFromParams, setLineParams, splitParty, totalRooms } from '@/lib/booking-lines';
import { api, fetcher } from '@/lib/fetcher';
import { fmtDay, fmtRange } from '@/lib/format';
import { fromCents, paymentAmountDue, toCents, type AmountDue, type PaymentPolicy } from '@/lib/payments';
import { isStaffRole } from '@/lib/routes';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Callout, EmptyState, Skeleton } from '@/components/ui/primitives';
import { SegmentedControl } from '@/components/ui/segmented';
import { SmartImage } from '@/components/ui/smart-image';
import { PublicDemoNote } from '@/components/guest/PublicDemoNote';
import { orderItemsKey, useVoicePage, voiceText, type VoiceActionResult, type VoiceBookingRequest } from '@/components/voice/page-context';
import { GuestShell } from '../../_components/guest-shell';
import { usePropertyShell } from '../../_components/property-shell';
import { isDay, plural, price, shiftDay } from '../../_components/format';

interface PublicProperty {
  id: string;
  name: string;
  city: string;
  state: string;
  phone: string;
  email: string | null;
  primaryColor: string | null;
  isDemo: boolean;
  roomTypes: { id: string; name: string; capacity: number; photos: { url: string }[] }[];
}

/** How the guest pays at this hotel and the policy they accept (GET /api/properties/:id/payment-terms). */
interface PaymentTerms {
  policy: PaymentPolicy;
  depositNights: number;
  onlinePayment: boolean;
  policyText: string;
  policyHash: string;
}

/** The new-guest form; lives in Checkout so links (guestName/guestEmail/guestPhone) and the voice agent can fill it. */
interface GuestForm {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  password: string;
}

/** Ids from the URL for the voice agent: well-formed ids only (dates are already checked with isDay). */
const idOrBlank = (v: string) => (/^[A-Za-z0-9_-]{1,64}$/.test(v) ? v : '(invalid)');

/**
 * The last booking made in this browser, so the same stay (same guest, room
 * type, dates and party) isn't booked twice by accident within a couple of
 * minutes — a second tab, or a voice confirm after going back to checkout.
 * A convenience only: storage may be unavailable, and then nothing is blocked.
 */
const RECENT_BOOKING = 'hotelone:recent-booking';
const RECENT_BOOKING_MS = 2 * 60_000;
function recentBooking(key: string): { id: string; code: string | null } | null {
  try {
    const v = JSON.parse(window.localStorage.getItem(RECENT_BOOKING) ?? 'null') as { key?: string; id?: string; code?: string | null; at?: number } | null;
    if (!v || v.key !== key || typeof v.id !== 'string' || typeof v.at !== 'number' || Date.now() - v.at > RECENT_BOOKING_MS) return null;
    return { id: v.id, code: v.code ?? null };
  } catch {
    return null;
  }
}
function rememberBooking(key: string, id: string, code: string | null) {
  try {
    window.localStorage.setItem(RECENT_BOOKING, JSON.stringify({ key, id, code, at: Date.now() }));
  } catch {
    /* storage blocked: no duplicate check */
  }
}

/** ["name", "email", "a password"] → "name, email and a password". */
const listWords = (words: string[]) => (words.length > 1 ? `${words.slice(0, -1).join(', ')} and ${words.at(-1)}` : (words[0] ?? ''));

/** "Jamie Lee Smith" → first "Jamie", last "Lee Smith". */
/** "US dollars", "Euro (EUR)": the currency the hotel prices in. */
function currencyName(code: string): string {
  if (code === 'USD') return 'US dollars';
  try {
    const name = new Intl.DisplayNames(['en'], { type: 'currency' }).of(code);
    return name && name !== code ? `${name} (${code})` : code;
  } catch {
    return code;
  }
}

function splitName(full: string): { firstName: string; lastName: string } {
  const [firstName = '', ...rest] = full.trim().split(/\s+/);
  return { firstName, lastName: rest.join(' ') };
}

/** The taxes and fees of several quotes, added up per charge (same name, kind and rate), in first-seen order. */
function sumCharges(quotes: StayQuote[]) {
  const out = new Map<string, { key: string; name: string; kind: string; rate: number; cents: number }>();
  for (const q of quotes) {
    for (const c of q.charges ?? []) {
      const key = `${c.name}|${c.kind}|${c.rate}`;
      const row = out.get(key) ?? { key, name: c.name, kind: c.kind, rate: c.rate, cents: 0 };
      row.cents += toCents(c.amount);
      out.set(key, row);
    }
  }
  return [...out.values()].map((c) => ({ ...c, amount: fromCents(c.cents) }));
}

const STEPS = ['Room and dates', 'Your details', 'Review and book'] as const;

/** Where the guest is in checkout; earlier steps are links back. */
function Steps({ current, backHref }: { current: 2 | 3; backHref: string }) {
  return (
    <nav aria-label="Booking progress" className="mt-5">
      <ol className="flex items-center gap-2 sm:gap-3">
        {STEPS.map((label, i) => {
          const n = i + 1;
          const done = n < current;
          const active = n === current;
          const dot = (
            <span
              className={cn(
                'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold',
                done ? 'bg-brand text-brand-foreground' : active ? 'border-2 border-brand bg-brand-soft text-brand-soft-foreground' : 'border border-input text-muted-foreground'
              )}
              aria-hidden
            >
              {done ? <Check className="h-4 w-4" /> : n}
            </span>
          );
          const text = (
            <>
              {dot}
              <span className={cn('hidden text-sm sm:inline', active ? 'font-semibold text-foreground' : 'text-muted-foreground')} aria-hidden>
                {label}
              </span>
              <span className="sr-only">
                {label}
                {done ? ' (done)' : ''}
              </span>
            </>
          );
          return (
            <li key={label} className={cn('flex items-center gap-2 sm:gap-3', n < STEPS.length && 'flex-1')} aria-current={active ? 'step' : undefined}>
              {n === 1 ? (
                <Link href={backHref} className="flex items-center gap-2 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:gap-3 sm:rounded-md [&>span:nth-child(2)]:hover:underline">
                  {text}
                </Link>
              ) : (
                <span className="flex items-center gap-2 sm:gap-3">{text}</span>
              )}
              {n < STEPS.length && <span className={cn('h-px min-w-4 flex-1', done ? 'bg-brand' : 'bg-border')} aria-hidden />}
            </li>
          );
        })}
      </ol>
      <p className="mt-2 text-sm text-muted-foreground sm:hidden" aria-hidden>
        Step {current} of {STEPS.length} · <span className="font-medium text-foreground">{STEPS[current - 1]}</span>
      </p>
    </nav>
  );
}

function Section({ id, title, description, done, children }: { id: string; title: string; description?: string; done?: boolean; children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-24 rounded-2xl border bg-card p-5 shadow-xs sm:p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id={`${id}-title`} className="text-lg font-semibold tracking-tight">
            {title}
          </h2>
          {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
        </div>
        {done && (
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-success-soft text-success-soft-foreground">
            <Check className="h-4 w-4" aria-hidden />
            <span className="sr-only">Done</span>
          </span>
        )}
      </div>
      <div className="mt-5">{children}</div>
    </section>
  );
}

function GuestAuth({ onDone, form, setForm }: { onDone: () => void; form: GuestForm; setForm: React.Dispatch<React.SetStateAction<GuestForm>> }) {
  const [mode, setMode] = React.useState<'register' | 'signin'>('register');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const { update } = useSession();
  const reduce = useReducedMotion();
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (mode === 'register') {
        await api('/api/auth/register', { method: 'POST', json: form });
      }
      const res = await signIn('credentials', { email: form.email, password: form.password, redirect: false });
      if (!res || res.error) throw new Error(mode === 'signin' ? 'That email and password don’t match an account.' : 'Your account was created, but signing in failed. Choose “I have an account” and try again.');
      await getSession();
      await update();
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <SegmentedControl
        layoutId="checkout-auth"
        aria-label="Do you have an account?"
        value={mode}
        onChange={(m) => {
          setMode(m);
          setError('');
        }}
        options={[
          { value: 'register', label: 'I’m new here' },
          { value: 'signin', label: 'I have an account' },
        ]}
      />
      {mode === 'register' && <PublicDemoNote className="mt-4" />}
      <form onSubmit={submit} className="mt-5 space-y-4" aria-describedby={error ? 'auth-error' : undefined}>
        <AnimatePresence initial={false} mode="popLayout">
          {mode === 'register' && (
            <motion.div
              key="names"
              initial={reduce ? false : { opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={reduce ? undefined : { opacity: 0, height: 0 }}
              className="grid gap-4 overflow-hidden sm:grid-cols-2"
            >
              <Field label="First name" htmlFor="g-first">
                <Input id="g-first" required autoComplete="given-name" value={form.firstName} onChange={set('firstName')} />
              </Field>
              <Field label="Last name" htmlFor="g-last">
                <Input id="g-last" required autoComplete="family-name" value={form.lastName} onChange={set('lastName')} />
              </Field>
            </motion.div>
          )}
        </AnimatePresence>
        <div className={cn('grid gap-4', mode === 'register' && 'sm:grid-cols-2')}>
          <Field label="Email" htmlFor="g-email" hint={mode === 'register' ? 'Your confirmation goes here.' : undefined}>
            <Input id="g-email" type="email" inputMode="email" required autoComplete="email" value={form.email} onChange={set('email')} />
          </Field>
          {mode === 'register' && (
            <Field label="Phone" optional htmlFor="g-phone" hint="Only used about this stay.">
              <Input id="g-phone" type="tel" inputMode="tel" autoComplete="tel" value={form.phone} onChange={set('phone')} />
            </Field>
          )}
        </div>
        <Field label="Password" htmlFor="g-pass" hint={mode === 'register' ? 'At least 10 characters. You’ll use it to manage your booking.' : undefined}>
          <Input
            id="g-pass"
            type="password"
            required
            minLength={mode === 'register' ? 8 : 1}
            autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
            value={form.password}
            onChange={set('password')}
          />
        </Field>
        {error && (
          <Callout tone="danger" id="auth-error" role="alert">
            {error}
          </Callout>
        )}
        <Button type="submit" variant="brand" size="lg" loading={busy} loadingText={mode === 'register' ? 'Creating your account…' : 'Signing in…'} className="h-11 w-full text-sm sm:w-auto">
          {mode === 'register' ? 'Continue' : 'Sign in and continue'}
        </Button>
      </form>
    </div>
  );
}

function Checkout() {
  const { propertyId } = useParams<{ propertyId: string }>();
  const params = useSearchParams();
  const router = useRouter();
  const shell = usePropertyShell();
  const { data: session, status } = useSession();
  // One room type (roomTypeId + rooms) or several booked together (items=…).
  const lines = React.useMemo(() => linesFromParams(params), [params]);
  const multi = lines.length > 1;
  const roomTypeId = lines[0]?.roomTypeId ?? '';
  // Calendar days only: anything else in a (possibly crafted) link counts as no dates chosen.
  const checkIn = isDay(params.get('checkIn')) ? params.get('checkIn')! : '';
  const checkOut = isDay(params.get('checkOut')) ? params.get('checkOut')! : '';
  const guests = Number(params.get('guests')) || 2;
  const rooms = lines.length ? totalRooms(lines) : Number(params.get('rooms')) || 1;

  const { data: p } = useSWR<PublicProperty>(`/api/properties/${propertyId}`, fetcher);
  // Several room types share the party out as the server does (per-guest fees follow it).
  const party = React.useMemo(
    () => (multi && p ? splitParty(guests, lines.map((l) => ({ rooms: l.rooms, capacity: p.roomTypes.find((r) => r.id === l.roomTypeId)?.capacity ?? 0 }))) : null),
    [multi, p, guests, lines]
  );
  // A quote per room type; the booking endpoint charges exactly their sum.
  const quoteUrls = lines.map(
    (l, i) => `/api/quote?roomTypeId=${encodeURIComponent(l.roomTypeId)}&checkIn=${checkIn}&checkOut=${checkOut}&guests=${multi ? (party?.[i] ?? 1) : guests}&rooms=${l.rooms}`
  );
  const { data: quotes, error: quoteError } = useSWR<StayQuote[]>(lines.length && checkIn && checkOut && (!multi || p) ? ['quotes', ...quoteUrls] : null, () =>
    Promise.all(quoteUrls.map((u) => fetcher<StayQuote>(u)))
  );
  const quote = quotes?.[0];
  const total = quotes ? fromCents(quotes.reduce((s, q) => s + toCents(q.total), 0)) : null;
  const { data: config } = useSWR<{ emailEnabled?: boolean }>('/api/config', fetcher);
  const { data: terms } = useSWR<PaymentTerms>(`/api/properties/${propertyId}/payment-terms`, fetcher);
  const [accepted, setAccepted] = React.useState(false);
  const [needAccept, setNeedAccept] = React.useState(false);
  const acceptRef = React.useRef<HTMLInputElement>(null);
  const [notes, setNotes] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  // Set synchronously when a booking starts, so the Confirm button and the voice agent's
  // confirm can't both get through before React re-renders with `busy`.
  const booking = React.useRef(false);
  const [error, setError] = React.useState('');
  const [needDetails, setNeedDetails] = React.useState(false);
  const confirmRef = React.useRef<HTMLButtonElement>(null);
  // Agent links pre-fill the guest's details (guestName, guestEmail, guestPhone).
  const [guestForm, setGuestForm] = React.useState<GuestForm>(() => ({
    ...splitName(params.get('guestName') ?? ''),
    email: params.get('guestEmail') ?? '',
    phone: params.get('guestPhone') ?? '',
    password: '',
  }));

  const rt = p?.roomTypes.find((r) => r.id === roomTypeId);
  const signedIn = status === 'authenticated';
  const back = `/properties/${propertyId}?${new URLSearchParams({ checkIn, checkOut, guests: String(guests), rooms: String(multi ? 1 : rooms), ...(multi ? { items: setLineParams(new URLSearchParams(), lines).get('items')! } : {}) })}`;
  // The room type (if any) that no longer has enough rooms free.
  const shortLine = quotes ? lines.findIndex((l, i) => quotes[i] && quotes[i].available < l.rooms) : -1;
  const unavailable = shortLine >= 0;
  const shortName = shortLine >= 0 ? (p?.roomTypes.find((r) => r.id === lines[shortLine].roomTypeId)?.name ?? quotes?.[shortLine]?.roomTypeName) : null;
  const lineName = (i: number) => p?.roomTypes.find((r) => r.id === lines[i].roomTypeId)?.name ?? quotes?.[i]?.roomTypeName ?? 'Room';
  const roomsLabel = multi ? lines.map((l, i) => `${l.rooms} × ${lineName(i)}`).join(', ') : null;
  const shortLeft = shortLine >= 0 ? (quotes?.[shortLine]?.available ?? 0) : 0;
  const soldOutText = multi && shortLine >= 0 ? (shortLeft ? `Only ${shortLeft} ${shortName ?? 'room'} left for these dates.` : `The ${shortName ?? 'room'} just sold out for these dates.`) : 'This room just sold out for these dates.';
  // Several room types: the party must fit them, with at least one guest per type (the server refuses otherwise).
  const sleeps = p ? lines.reduce((s, l) => s + l.rooms * (p.roomTypes.find((r) => r.id === l.roomTypeId)?.capacity ?? 0), 0) : null;
  const tooSmall = multi && sleeps !== null && (sleeps < guests || guests < lines.length);
  const tooSmallText = guests < lines.length ? 'Each room type needs at least one guest.' : `These rooms don’t sleep ${plural(guests, 'guest')}.`;
  // What is charged now (a deposit or the whole stay) follows the hotel's payment policy, never the guest's choice.
  // Worked out per room type, as the server does, and paid together.
  const due = React.useMemo<AmountDue | null>(() => {
    if (!terms || !quotes || quotes.length !== lines.length) return null;
    const parts = quotes.map((q, i) =>
      paymentAmountDue({ policy: terms.policy, depositNights: terms.depositNights, nightlyCents: q.nights.map((n) => toCents(n.price)), rooms: lines[i].rooms, totalCents: toCents(q.total) })
    );
    const dueNowCents = parts.reduce((s, x) => s + x.dueNowCents, 0);
    const balanceCents = parts.reduce((s, x) => s + x.balanceCents, 0);
    return { dueNowCents, balanceCents, kind: dueNowCents === 0 ? 'NONE' : balanceCents > 0 ? 'DEPOSIT' : 'FULL' };
  }, [terms, quotes, lines]);
  const payNow = !!terms?.onlinePayment && !!due && due.dueNowCents > 0;
  const method = payNow ? 'stripe' : 'pay_at_property';
  const name = p?.name ?? shell?.name;
  // The hotel's own chrome, as on its page: header, contact footer and the demo banner.
  const brandColor = p?.primaryColor ?? shell?.primaryColor;
  const hotel = name ? { name, phone: p?.phone, email: p?.email } : undefined;
  const isDemo = p?.isDemo ?? shell?.isDemo;

  React.useEffect(() => {
    if (signedIn) setNeedDetails(false);
  }, [signedIn]);

  /** Show where to go next instead of a disabled button: the details form, focused. */
  function askForDetails(focus = true) {
    setNeedDetails(true);
    document.getElementById('details')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (focus) setTimeout(() => document.querySelector<HTMLInputElement>('#details input:not([type="hidden"])')?.focus({ preventScroll: true }), 350);
  }

  /**
   * Book it (the guest is signed in). Pay-at-hotel bookings go to the booking page; card payments to Stripe.
   * One at a time: a second call while one is running (or after one succeeded, while the page moves on) is refused.
   */
  async function submit(): Promise<{ ok: true; id: string; code: string | null; total: number | null } | { ok: false; error: string; busy?: true; duplicate?: { id: string; code: string | null } }> {
    if (booking.current) return { ok: false, error: 'It’s already booking — wait a moment.', busy: true };
    const stayKey = JSON.stringify([session?.user?.id ?? session?.user?.email ?? '', propertyId, lines, checkIn, checkOut, guests, rooms]);
    const dup = recentBooking(stayKey);
    if (dup) {
      const message = `This stay was booked a moment ago${dup.code ? ` (confirmation code ${dup.code})` : ''}, so it wasn’t booked again.`;
      setError(`${message} Opening that booking.`);
      router.push(`/bookings/${dup.id}`);
      return { ok: false, error: `${message} Its booking page is opening — tell the guest they already have it.`, duplicate: dup };
    }
    if (!terms) return { ok: false, error: 'The booking terms are still loading — try again in a moment.' };
    if (!accepted) {
      setNeedAccept(true);
      acceptRef.current?.focus();
      return { ok: false, error: 'Please accept the cancellation policy to book.' };
    }
    booking.current = true;
    setBusy(true);
    setError('');
    try {
      const r = await api<{ requiresPayment: boolean; checkoutUrl?: string; booking: { id: string; code?: string | null; totalPrice?: number } }>('/api/bookings', {
        method: 'POST',
        json: { propertyId, lines, checkIn, checkOut, guests, notes: notes.trim() || null, acceptPolicy: true, policyHash: terms.policyHash },
      });
      if (r.requiresPayment && r.checkoutUrl) {
        window.location.href = r.checkoutUrl;
        return { ok: false, error: 'Opening the card payment page.' };
      }
      rememberBooking(stayKey, r.booking.id, r.booking.code ?? null);
      router.push(`/bookings/${r.booking.id}?new=1`);
      return { ok: true, id: r.booking.id, code: r.booking.code ?? null, total: typeof r.booking.totalPrice === 'number' ? r.booking.totalPrice : null };
    } catch (e) {
      const message = (e as Error).message;
      booking.current = false;
      setError(message);
      setBusy(false);
      return { ok: false, error: message };
    }
  }

  async function confirm() {
    if (!signedIn) return askForDetails();
    await submit();
  }

  // The voice agent (the site's voice dock) sees this order and can fill in details and book on a spoken yes.
  const roomName = roomsLabel ?? rt?.name ?? quote?.roomTypeName;
  const totalText = total !== null ? price(total, quote?.currency ?? 'USD') : null;
  const stayWords = checkIn && checkOut ? `${fmtRange(checkIn, checkOut)}, ${plural(guests, 'guest')}${rooms > 1 ? `, ${plural(rooms, 'room')}` : ''}` : '';
  /** "the Ocean King at The Saltwater Inn, Feb 4 – 5, 2 guests, total $289" (hotel text made safe for the agent). */
  const orderWords = `${roomName ? (multi ? `${voiceText(roomName, 160)} booked together` : `the ${voiceText(roomName, 80)}`) : 'a room'}${name ? ` at ${voiceText(name, 80)}` : ''}, ${stayWords}${totalText ? `, total ${totalText}` : ''}`;
  /** Several room types as the voice agent names them: room_type_id and rooms each (null for one). */
  const items = multi ? lines.map((l) => ({ roomTypeId: l.roomTypeId, rooms: l.rooms })) : null;
  /** The voice agent must name the order it books; anything but what's on screen is refused. */
  const differsFromScreen = (want: VoiceBookingRequest) =>
    (!!want.propertyId && want.propertyId !== propertyId) ||
    want.roomTypeId !== roomTypeId ||
    want.checkIn !== checkIn ||
    want.checkOut !== checkOut ||
    want.guests !== guests ||
    want.rooms !== rooms ||
    orderItemsKey(want.items) !== orderItemsKey(items);
  useVoicePage({
    kind: 'checkout',
    propertyId,
    propertyName: name,
    brand: brandColor,
    stay: checkIn && checkOut ? { checkIn, checkOut, guests, rooms } : null,
    order:
      roomTypeId && checkIn && checkOut
        ? { propertyId, roomTypeId, items, checkIn, checkOut, guests, rooms, hotel: name ?? null, room: roomName ?? null, total, currency: quote?.currency ?? 'USD' }
        : null,
    summary:
      lines.length && checkIn && checkOut
        ? [
            `checkout for ${orderWords}`,
            unavailable ? voiceText(soldOutText, 160).replace(/\.$/, '') : '',
            tooSmall ? `${tooSmallText.replace(/\.$/, '')} — they need to add a room` : '',
            status === 'loading' ? '' : signedIn ? `signed in as ${session?.user?.name ?? session?.user?.email}` : 'not signed in yet',
            method === 'stripe' ? 'card payment required to confirm' : 'paying at the hotel',
          ]
            .filter(Boolean)
            .join('; ')
        : 'checkout, but no room or dates are chosen yet',
    actions: {
      fillGuest: ({ name: guestName, phone, notes: requests }): VoiceActionResult => {
        const filled: string[] = [];
        if (requests) {
          setNotes(requests.slice(0, 1000));
          filled.push('special requests');
        }
        if (signedIn) {
          return {
            ok: true,
            message: `${filled.length ? `Filled in ${filled.join(' and ')}. ` : ''}The guest is signed in as ${session?.user?.name ?? session?.user?.email}, so their name and email come from their account.`,
          };
        }
        const next = { ...guestForm, ...(guestName ? splitName(guestName) : {}), ...(phone ? { phone } : {}) };
        if (guestName) filled.push('name');
        if (phone) filled.push('phone');
        setGuestForm(next);
        if (guestName || phone) askForDetails(false);
        const missing = [!next.firstName || !next.lastName ? 'first and last name' : '', !next.email ? 'email' : '', 'a password'].filter(Boolean);
        return {
          ok: true,
          message: `${filled.length ? `Filled in ${filled.join(' and ')}. ` : ''}To book, the guest needs to add their ${listWords(missing)} under “Your details” on screen (or choose “I have an account” and sign in).`,
          missing,
        };
      },
      confirmBooking: async (want): Promise<VoiceActionResult> => {
        if (booking.current || busy) return { ok: false, error: 'It’s already booking — wait a moment.' };
        if (differsFromScreen(want)) {
          return {
            ok: false,
            // URL values only as ids and calendar days (a crafted link can't add words here).
            error: `That isn’t the checkout on screen, so nothing was booked. The screen shows ${orderWords} (property_id ${idOrBlank(propertyId)}, room_type_id ${idOrBlank(roomTypeId)}, check_in ${checkIn}, check_out ${checkOut}, guests ${guests}, rooms ${rooms}). Read that back and ask the guest, or call start_booking for the room they want.`,
          };
        }
        if (quoteError) return { ok: false, error: `The price couldn’t be checked: ${(quoteError as Error).message}` };
        if (!quote) return { ok: false, error: 'The price is still loading — try again in a moment.' };
        if (unavailable) return { ok: false, error: `${voiceText(soldOutText, 160)} Offer to check other rooms or dates.` };
        if (tooSmall) return { ok: false, error: `${tooSmallText} Offer to add a room.` };
        if (!accepted) {
          setNeedAccept(true);
          return { ok: false, error: 'The guest needs to tick the box accepting the cancellation policy on screen first. Never accept it on their behalf.' };
        }
        if (method === 'stripe') {
          return { ok: false, error: 'Card payment is selected. Ask the guest to tap “Continue to payment” on screen. Never take card details by voice.' };
        }
        if (!signedIn) {
          askForDetails();
          return { ok: false, error: 'The guest isn’t signed in yet. Ask them to finish “Your details” on screen — email and a password, or sign in — then you can book it.', needs: 'sign in' };
        }
        // Last check before booking: the guest answered a read-back of this order (the dock reads the transcript).
        if (!want.guestConfirmed) return { ok: false, error: 'Ask the guest to confirm the room, dates and total first.', needs: 'guest confirmation' };
        const r = await submit();
        if (!r.ok) return { ok: false, error: r.error, ...(r.duplicate ? { already_booked: true, code: r.duplicate.code } : {}) };
        const paid = r.total ?? total ?? quote.total;
        const cur = quote.currency ?? 'USD';
        const hotel = voiceText(name, 80) || null;
        const room = voiceText(roomName, multi ? 160 : 80) || null;
        // What was actually booked, for the agent to read back.
        return {
          ok: true,
          message: `Booked ${room ? (multi ? `${room}, one booking` : `the ${room}`) : 'the room'}${hotel ? ` at ${hotel}` : ''}, ${stayWords}, total ${price(paid, cur)} — pay at the hotel. Confirmation code ${r.code ?? 'on screen'}. Read back the hotel, room, dates and total. Their booking page is opening now${config?.emailEnabled ? ' and a confirmation email is on its way' : ''}.`,
          code: r.code,
          hotel,
          room,
          check_in: checkIn,
          check_out: checkOut,
          guests,
          rooms,
          total: paid,
          currency: cur,
        };
      },
    },
  });

  if (!lines.length || !checkIn || !checkOut) {
    return (
      <GuestShell brandColor={brandColor} brand={name ? { name, href: `/properties/${propertyId}` } : undefined} hotel={hotel} demo={isDemo}>
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
          <h1 className="sr-only">Confirm and book</h1>
          <div className="mx-auto max-w-xl rounded-2xl border bg-card">
            <EmptyState
              icon={CalendarDays}
              title="Pick your dates and room first"
              description="Choose when you’re staying and which room you’d like, then come back here to book."
              action={
                <Button asChild variant="brand">
                  <Link href={`/properties/${propertyId}`}>See rooms and prices</Link>
                </Button>
              }
            />
          </div>
        </div>
      </GuestShell>
    );
  }

  const deadline = fmtDay(shiftDay(checkIn, -1), 'weekday');
  const cur = quote?.currency ?? 'USD';
  const totalLabel = total !== null ? price(total, cur) : '';
  // Several room types: each one's room charges, then the hotel's taxes and fees added up across them.
  const multiCharges = multi && quotes ? sumCharges(quotes) : [];
  const nightsCount = quote?.nights.length ?? 0;

  return (
    // The hotel's name goes back to its page with this stay still chosen.
    <GuestShell brandColor={brandColor} brand={name ? { name, href: back } : undefined} hotel={hotel} demo={isDemo}>
      <div className="mx-auto max-w-7xl px-4 pb-16 sm:px-6">
        <Link
          href={back}
          className="-ml-1 mt-3 inline-flex min-h-10 items-center gap-1.5 rounded-md px-1 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden /> Change room or dates
        </Link>
        <h1 className="mt-2 font-display text-3xl tracking-tight sm:text-4xl">Confirm and book</h1>
        <Steps current={signedIn ? 3 : 2} backHref={back} />

        <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_400px] lg:gap-10">
          <div className="order-2 min-w-0 space-y-5 lg:order-1">
            <Section id="details" title="Your details" description={signedIn ? undefined : 'We’ll send your confirmation by email.'} done={signedIn}>
              {status === 'loading' ? (
                <Skeleton className="h-16 rounded-xl" />
              ) : signedIn ? (
                <>
                  <div className="flex items-center justify-between gap-3 rounded-xl bg-muted px-4 py-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <UserRound className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{session?.user?.name}</p>
                        <p className="truncate text-sm text-muted-foreground">{session?.user?.email}</p>
                      </div>
                    </div>
                    {/* data-voice-avoid: the voice launcher or live pill moves off this button on phones. */}
                    <Button data-voice-avoid variant="ghost" size="sm" className="shrink-0" onClick={() => signOut({ redirect: false })}>
                      Not you?
                    </Button>
                  </div>
                  {isStaffRole(session?.user?.role) && (
                    <Callout tone="info" className="mt-3">
                      You’re signed in as hotel staff — this booking will be under your own name.
                    </Callout>
                  )}
                </>
              ) : (
                <>
                  {needDetails && (
                    <Callout tone="info" className="mb-5" role="status">
                      Add your details to finish booking — it takes a few seconds.
                    </Callout>
                  )}
                  <GuestAuth form={guestForm} setForm={setGuestForm} onDone={() => setTimeout(() => confirmRef.current?.focus(), 100)} />
                </>
              )}
            </Section>

            <Section id="requests" title="Special requests" description="Optional. They go straight to the front desk — we can’t guarantee them, but we’ll try.">
              <Field label="Anything the hotel should know?" htmlFor="notes" labelClassName="sr-only">
                <Textarea
                  id="notes"
                  rows={3}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  maxLength={1000}
                  placeholder="Arrival time, celebrations, accessibility needs, a quiet room…"
                />
              </Field>
            </Section>

            <Section id="payment" title="Payment">
              {payNow && due ? (
                <div className="flex items-start gap-3 rounded-xl border bg-surface-sunken p-4">
                  <CreditCard className="mt-0.5 h-5 w-5 shrink-0 text-brand" aria-hidden />
                  <div>
                    <p className="text-sm font-semibold">
                      {due.kind === 'DEPOSIT'
                        ? `Pay a deposit of ${price(fromCents(due.dueNowCents), cur)} now by card`
                        : `Pay ${price(fromCents(due.dueNowCents), cur)} now by card`}
                    </p>
                    <p className="mt-0.5 text-sm text-muted-foreground">
                      {due.kind === 'DEPOSIT'
                        ? `The balance of ${price(fromCents(due.balanceCents), cur)} is paid at the hotel. `
                        : ''}
                      You’ll pay on a secure Stripe page, straight to the hotel. Your bank may ask you to verify the payment (3D Secure). Your booking is confirmed once the payment goes through.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-3 rounded-xl border bg-surface-sunken p-4">
                  <Building2 className="mt-0.5 h-5 w-5 shrink-0 text-brand" aria-hidden />
                  <div>
                    <p className="text-sm font-semibold">Pay at the hotel</p>
                    <p className="mt-0.5 text-sm text-muted-foreground">Nothing is charged today. You pay when you arrive.</p>
                  </div>
                </div>
              )}
            </Section>

            <section aria-label="Book" className="rounded-2xl border bg-card p-5 shadow-xs sm:p-6">
              <p className="flex items-start gap-2.5 text-sm">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden />
                <span className="text-muted-foreground">
                  <strong className="font-semibold text-foreground">Free changes and cancellation until 3:00 PM on {deadline}</strong>, the day before check-in. After
                  that, contact the hotel.
                </span>
              </p>
              {terms && (
                <div className="mt-4 rounded-xl border bg-surface-sunken p-4">
                  <p className="text-sm font-semibold">Cancellation and refund policy</p>
                  <p className="mt-1 text-sm text-muted-foreground" id="policy-text">
                    {terms.policyText}
                  </p>
                  <label className="mt-3 flex min-h-10 cursor-pointer items-start gap-3 text-sm">
                    <input
                      ref={acceptRef}
                      type="checkbox"
                      checked={accepted}
                      onChange={(e) => {
                        setAccepted(e.target.checked);
                        if (e.target.checked) setNeedAccept(false);
                      }}
                      aria-describedby="policy-text"
                      aria-invalid={needAccept && !accepted}
                      className="mt-0.5 h-5 w-5 shrink-0 accent-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    />
                    <span className="font-medium">I have read and accept this cancellation and refund policy.</span>
                  </label>
                  {needAccept && !accepted && (
                    <p className="mt-2 text-sm text-destructive" role="alert">
                      Please tick the box to accept the policy and book.
                    </p>
                  )}
                </div>
              )}
              {error && (
                <Callout tone="danger" className="mt-4" role="alert">
                  {error}
                </Callout>
              )}
              {unavailable && (
                <Callout tone="danger" className="mt-4" role="alert" action={<Button asChild variant="outline" size="sm"><Link href={back}>Choose another room</Link></Button>}>
                  {soldOutText}
                </Callout>
              )}
              {tooSmall && (
                <Callout tone="danger" className="mt-4" role="alert" action={<Button asChild variant="outline" size="sm"><Link href={back}>Add a room</Link></Button>}>
                  {tooSmallText}
                </Callout>
              )}
              <Button
                ref={confirmRef}
                // The voice launcher moves up instead of covering this button as it scrolls past.
                data-voice-avoid
                variant="brand"
                size="lg"
                // A long total wraps under the label on the narrowest phones instead of widening the page.
                className="mt-5 h-auto min-h-12 w-full flex-wrap gap-x-2 gap-y-0.5 whitespace-normal py-3"
                onClick={confirm}
                loading={busy}
                loadingText={method === 'stripe' ? 'Opening secure payment…' : rooms > 1 ? 'Booking your rooms…' : 'Booking your room…'}
                disabled={!quote || !terms || unavailable || tooSmall}
              >
                <Lock aria-hidden />
                {method === 'stripe' ? 'Continue to payment' : 'Confirm booking'}
                {due && payNow ? <span className="tabular">· {price(fromCents(due.dueNowCents), cur)} today</span> : totalLabel && <span className="tabular">· {totalLabel}</span>}
              </Button>
              <p className="mt-3 text-center text-xs text-muted-foreground">
                {isDemo ? 'This is a demo hotel — book freely, nothing is charged.' : method === 'stripe' ? 'You’ll pay on the next screen.' : 'You won’t be charged today.'}
              </p>
            </section>
          </div>

          {/* Summary */}
          <aside className="order-1 lg:order-2" aria-labelledby="summary-title">
            {/* From lg up the voice launcher folds (or moves up) instead of covering the order summary. */}
            <div data-voice-avoid="desktop" className="overflow-hidden rounded-2xl border bg-card shadow-soft lg:sticky lg:top-24">
              <SmartImage src={rt?.photos[0]?.url} alt="" aspectRatio="16 / 9" sizes="400px" className="hidden w-full sm:block" />
              <div className="p-5">
                <div className="flex items-start gap-3">
                  <SmartImage src={rt?.photos[0]?.url} alt="" className="h-16 w-20 shrink-0 rounded-lg sm:hidden" />
                  <div className="min-w-0">
                    <p className="truncate text-sm text-muted-foreground">{name ? `${name} · ${p?.city ?? shell?.city ?? ''}` : ' '}</p>
                    <h2 id="summary-title" className="text-lg font-semibold tracking-tight">
                      {multi ? plural(rooms, 'room') : (rt?.name ?? quote?.roomTypeName ?? <span className="skeleton mt-1 inline-block h-6 w-40 align-middle" aria-hidden />)}
                    </h2>
                    {multi && <p className="text-sm text-muted-foreground">{roomsLabel}</p>}
                  </div>
                </div>
                <dl className="mt-4 grid grid-cols-2 gap-2 text-sm">
                  <div className="rounded-xl bg-muted px-3 py-2.5">
                    <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <CalendarDays className="h-3.5 w-3.5" aria-hidden /> Dates
                    </dt>
                    <dd className="mt-0.5 font-medium">{fmtRange(checkIn, checkOut)}</dd>
                  </div>
                  <div className="rounded-xl bg-muted px-3 py-2.5">
                    <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Users className="h-3.5 w-3.5" aria-hidden /> Guests
                    </dt>
                    <dd className="mt-0.5 font-medium">
                      {plural(guests, 'guest')}
                      {rooms > 1 ? ` · ${plural(rooms, 'room')}` : ''}
                    </dd>
                  </div>
                </dl>
                <p className="mt-2 text-xs text-muted-foreground">Check in from 3:00 PM · check out by 11:00 AM</p>

                <div className="mt-5 border-t pt-4">
                  <h3 className="text-sm font-semibold">Price details</h3>
                  {quoteError ? (
                    <Callout tone="warning" className="mt-3" role="alert">
                      {(quoteError as Error).message}
                    </Callout>
                  ) : !quote || !quotes ? (
                    <div className="mt-3 space-y-2" aria-hidden>
                      <Skeleton className="h-4 w-full" />
                      <Skeleton className="h-4 w-full" />
                      <Skeleton className="mt-3 h-6 w-full" />
                    </div>
                  ) : multi ? (
                    <dl className="mt-3 space-y-1.5 text-sm">
                      {quotes.map((q, i) => (
                        <div key={q.roomTypeId} className="flex justify-between gap-3 text-muted-foreground">
                          <dt>
                            {lineName(i)} × {q.rooms}
                            <span className="block text-xs">
                              {plural(nightsCount, 'night')} × {price(q.averageNightly, cur)} average
                            </span>
                          </dt>
                          <dd className="tabular">{price(q.subtotal, cur)}</dd>
                        </div>
                      ))}
                      {multiCharges.map((c) => (
                        <div key={c.key} className="flex justify-between gap-3 text-muted-foreground">
                          <dt>
                            {c.name}
                            {c.kind === 'PERCENT' ? ` (${Number(c.rate.toFixed(3))}%)` : ''}
                          </dt>
                          <dd className="tabular">{price(c.amount, cur)}</dd>
                        </div>
                      ))}
                      <div className="flex justify-between gap-3 text-muted-foreground">
                        <dt>Booking fee</dt>
                        <dd>None</dd>
                      </div>
                      <div className="flex items-baseline justify-between gap-3 border-t pt-3">
                        <dt className="text-base font-semibold">Total</dt>
                        <dd className="text-lg font-semibold tabular">{totalLabel}</dd>
                      </div>
                    </dl>
                  ) : (
                    <dl className="mt-3 space-y-1.5 text-sm">
                      {nightsCount <= 7 ? (
                        quote.nights.map((n) => (
                          <div key={n.date} className="flex justify-between gap-3 text-muted-foreground">
                            <dt>{fmtDay(n.date, 'weekday')}</dt>
                            <dd className="tabular">
                              {price(n.price, cur)}
                              {rooms > 1 ? ` × ${rooms}` : ''}
                            </dd>
                          </div>
                        ))
                      ) : (
                        <div className="flex justify-between gap-3 text-muted-foreground">
                          <dt>
                            {plural(nightsCount, 'night')} × {price(quote.averageNightly, cur)} average
                            {rooms > 1 ? ` × ${rooms} rooms` : ''}
                          </dt>
                          <dd className="tabular">{price(quote.subtotal, cur)}</dd>
                        </div>
                      )}
                      {quote.charges?.length > 0 && (
                        <>
                          {nightsCount <= 7 && (
                            <div className="flex justify-between gap-3 border-t pt-1.5 text-muted-foreground">
                              <dt>Room total</dt>
                              <dd className="tabular">{price(quote.subtotal, cur)}</dd>
                            </div>
                          )}
                          {quote.charges.map((c) => (
                            <div key={c.name} className="flex justify-between gap-3 text-muted-foreground">
                              <dt>
                                {c.name}
                                {c.kind === 'PERCENT' ? ` (${Number(c.rate.toFixed(3))}%)` : ''}
                              </dt>
                              <dd className="tabular">{price(c.amount, cur)}</dd>
                            </div>
                          ))}
                        </>
                      )}
                      <div className="flex justify-between gap-3 text-muted-foreground">
                        <dt>Booking fee</dt>
                        <dd>None</dd>
                      </div>
                      <div className="flex items-baseline justify-between gap-3 border-t pt-3">
                        <dt className="text-base font-semibold">Total</dt>
                        <dd className="text-lg font-semibold tabular">{price(quote.total, cur)}</dd>
                      </div>
                    </dl>
                  )}
                  {quote && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      Prices in {currencyName(cur)}.{' '}
                      {(quotes ?? [quote]).some((q) => q.charges?.length) ? 'The total includes the hotel’s taxes and fees.' : 'Any local taxes are paid at the hotel.'}
                    </p>
                  )}
                </div>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </GuestShell>
  );
}

/** First paint: the hotel's header and the checkout's shape, before the search params are read. */
function CheckoutFallback() {
  const shell = usePropertyShell();
  return (
    <GuestShell
      brandColor={shell?.primaryColor}
      brand={shell ? { name: shell.name, href: `/properties/${shell.id}` } : undefined}
      hotel={shell ? { name: shell.name } : undefined}
      demo={shell?.isDemo}
    >
      <div className="mx-auto max-w-7xl px-4 pb-16 sm:px-6" role="status" aria-label="Loading checkout">
        <div className="mt-3 h-10" />
        <h1 className="mt-2 font-display text-3xl tracking-tight sm:text-4xl">Confirm and book</h1>
        <Skeleton className="mt-5 h-8 w-full max-w-3xl" />
        <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_400px] lg:gap-10">
          <Skeleton className="order-2 h-[28rem] rounded-2xl lg:order-1" />
          <Skeleton className="order-1 h-72 rounded-2xl lg:order-2 lg:h-[34rem]" />
        </div>
      </div>
    </GuestShell>
  );
}

export default function BookPage() {
  return (
    <React.Suspense fallback={<CheckoutFallback />}>
      <Checkout />
    </React.Suspense>
  );
}
