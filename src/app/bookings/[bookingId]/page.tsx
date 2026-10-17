'use client';

import * as React from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { motion, useReducedMotion } from 'framer-motion';
import { toast } from 'sonner';
import {
  ArrowLeft,
  BedDouble,
  CalendarPlus,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  CreditCard,
  Mail,
  MapPin,
  Navigation as NavIcon,
  Phone,
  ShieldCheck,
  TriangleAlert,
  Users,
} from 'lucide-react';
import type { BookingStatus, StayQuote } from '@/lib/dto';
import { api, fetcher } from '@/lib/fetcher';
import { addDays, fmtDay, localToday, nightsBetween } from '@/lib/format';
import { BOOKING_STATUS, paymentLabel } from '@/lib/status';
import { cn } from '@/lib/utils';
import { PRODUCT_NAME } from '@/config/product';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Callout, EmptyState, Skeleton } from '@/components/ui/primitives';
import { SmartImage } from '@/components/ui/smart-image';
import { BookingStatusBadge } from '@/components/hotel/badges';
import { brandScope } from '@/components/guest/brand';
import { DateField } from '@/components/guest/StaySearch';
import { useVoicePage } from '@/components/voice/page-context';
import { GuestShell } from '@/app/properties/_components/guest-shell';
import { plural, price } from '@/app/properties/_components/format';

interface GuestBooking {
  id: string;
  code: string;
  status: BookingStatus;
  paymentStatus: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  guests: number;
  rooms: number;
  totalPrice: number;
  notes: string | null;
  roomTypeId: string;
  property: { id: string; name: string; address: string; city: string; state: string; zipCode: string; phone: string; email: string | null; primaryColor: string | null; photos: { url: string }[] };
  roomType: { id: string; name: string; capacity: number; amenities: string[]; photos: { url: string }[] };
  room: { roomNumber: string } | null;
  user: { firstName: string; lastName: string; email: string };
  statusHistory: { status: string; notes: string | null; createdAt: string }[];
  policy: { deadlineDay: string; deadlineLabel: string; passed: boolean };
  canCancel: boolean;
  canModifyCheckIn: boolean;
  canModifyCheckOut: boolean;
}

function icsFor(b: GuestBooking) {
  const d = (day: string) => day.replace(/-/g, '');
  const esc = (s: string) => s.replace(/[,;\\]/g, (m) => `\\${m}`).replace(/\n/g, '\\n');
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:-//${PRODUCT_NAME}//Booking//EN`,
    'BEGIN:VEVENT',
    // The UID suffix stays "@stayos": calendar apps match on it to update the
    // same event instead of adding a duplicate for bookings saved before the rename.
    `UID:${b.id}@stayos`,
    `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')}`,
    `DTSTART;VALUE=DATE:${d(b.checkIn)}`,
    `DTEND;VALUE=DATE:${d(b.checkOut)}`,
    `SUMMARY:${esc(`Stay at ${b.property.name}`)}`,
    `LOCATION:${esc(`${b.property.address}, ${b.property.city}, ${b.property.state} ${b.property.zipCode}`)}`,
    `DESCRIPTION:${esc(`Confirmation ${b.code} · ${b.roomType.name} · ${b.guests} guest(s). Check-in from 3 PM.`)}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
}

function ChangeDatesDialog({
  booking,
  open,
  onOpenChange,
  onDone,
  scope,
}: {
  booking: GuestBooking;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onDone: () => void;
  scope: ReturnType<typeof brandScope>;
}) {
  const [checkIn, setCheckIn] = React.useState(booking.checkIn);
  const [checkOut, setCheckOut] = React.useState(booking.checkOut);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  React.useEffect(() => {
    if (open) {
      setCheckIn(booking.checkIn);
      setCheckOut(booking.checkOut);
      setError('');
    }
  }, [open, booking.checkIn, booking.checkOut]);
  const changed = checkIn !== booking.checkIn || checkOut !== booking.checkOut;
  const valid = checkOut > checkIn;
  const { data: quote, error: quoteError } = useSWR<StayQuote>(
    open && changed && valid ? `/api/quote?roomTypeId=${booking.roomTypeId}&checkIn=${checkIn}&checkOut=${checkOut}&guests=${booking.guests}&rooms=${booking.rooms}` : null,
    fetcher
  );
  const diff = quote ? quote.total - booking.totalPrice : 0;
  const today = localToday();
  const nights = nightsBetween(checkIn, checkOut);

  async function save() {
    setBusy(true);
    setError('');
    try {
      const body: Record<string, string> = {};
      if (checkIn !== booking.checkIn) body.newCheckIn = checkIn;
      if (checkOut !== booking.checkOut) body.newCheckOut = checkOut;
      await api(`/api/bookings/${booking.id}/modify-dates`, { method: 'POST', json: body });
      toast.success('Your dates are updated');
      onDone();
      onOpenChange(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent style={scope.style} className={scope.className}>
        <DialogHeader>
          <DialogTitle>Change your dates</DialogTitle>
          <DialogDescription>
            {booking.canModifyCheckIn
              ? 'Pick new dates — we’ll check availability and show the new price before anything changes.'
              : 'Your check-in date can no longer change online, but you can still change your check-out.'}
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <DateField
            id="cd-in"
            label="Check in"
            value={checkIn}
            min={today}
            disabled={!booking.canModifyCheckIn}
            bordered
            icon
            onChange={(v) => {
              setCheckIn(v);
              if (checkOut <= v) setCheckOut(addDays(v, Math.max(1, nightsBetween(booking.checkIn, booking.checkOut))));
            }}
          />
          <DateField
            id="cd-out"
            label="Check out"
            value={checkOut}
            min={addDays(checkIn > today ? checkIn : today, 1)}
            max={addDays(checkIn, 30)}
            bordered
            icon
            onChange={setCheckOut}
          />
        </div>
        <div className="min-h-[3.25rem] rounded-xl bg-muted px-4 py-3 text-sm" aria-live="polite">
          {!changed ? (
            <p className="text-muted-foreground">
              Now: {fmtDay(booking.checkIn, 'weekday')} – {fmtDay(booking.checkOut, 'weekday')} · {price(booking.totalPrice)}
            </p>
          ) : !valid ? (
            <p className="text-muted-foreground">Check-out must be after check-in.</p>
          ) : quoteError ? (
            <p className="text-destructive">{(quoteError as Error).message}</p>
          ) : quote ? (
            <div className="flex items-center justify-between gap-3">
              <span>
                {plural(nights, 'night')} · new total <span className="font-semibold tabular">{price(quote.total)}</span>
              </span>
              <span
                className={cn(
                  'shrink-0 rounded-full px-2 py-0.5 text-xs font-medium tabular',
                  diff > 0 ? 'bg-warning-soft text-warning-soft-foreground' : diff < 0 ? 'bg-success-soft text-success-soft-foreground' : 'bg-surface text-muted-foreground'
                )}
              >
                {diff === 0 ? 'Same price' : `${diff > 0 ? '+' : '−'}${price(Math.abs(diff))}`}
                {diff !== 0 && <span className="sr-only">{diff > 0 ? ' more than now' : ' less than now'}</span>}
              </span>
            </div>
          ) : (
            <Skeleton className="h-5 w-2/3" />
          )}
        </div>
        {error && (
          <Callout tone="danger" role="alert">
            {error}
          </Callout>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Keep my dates
          </Button>
          <Button
            variant="brand"
            onClick={() => (changed ? save() : document.getElementById(booking.canModifyCheckIn ? 'cd-in' : 'cd-out')?.focus())}
            loading={busy}
            loadingText="Updating your dates…"
            disabled={changed && (!valid || !quote || !!quoteError)}
          >
            Change dates
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CancelDialog({ b, open, onOpenChange, onDone }: { b: GuestBooking; open: boolean; onOpenChange: (o: boolean) => void; onDone: () => Promise<unknown> }) {
  const [reason, setReason] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const keepRef = React.useRef<HTMLButtonElement>(null);

  async function cancel() {
    setBusy(true);
    setError('');
    try {
      await api(`/api/bookings/${b.id}/cancel`, { method: 'PUT', json: { reason: reason.trim() || undefined } });
      toast.success('Your booking is cancelled');
      onOpenChange(false);
      await onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        // Start on the safe choice (and don't pop the phone keyboard for the optional reason).
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          keepRef.current?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>Cancel your stay at {b.property.name}?</DialogTitle>
          <DialogDescription>
            {fmtDay(b.checkIn, 'weekday')} – {fmtDay(b.checkOut, 'weekday')} · {b.roomType.name} · confirmation {b.code}
          </DialogDescription>
        </DialogHeader>
        <Callout tone="danger" icon={TriangleAlert}>
          <p className="font-semibold">This can’t be undone.</p>
          <p>
            Your room is released to other guests. Cancelling is free —{' '}
            {b.paymentStatus === 'PAID' ? 'you paid online, so the hotel will arrange your refund.' : 'nothing has been charged.'}
          </p>
        </Callout>
        <Field label="Reason" optional htmlFor="cancel-reason" hint="Helps the hotel — only they can see it.">
          <Textarea id="cancel-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder="Plans changed…" />
        </Field>
        {error && (
          <Callout tone="danger" role="alert">
            {error}
          </Callout>
        )}
        <DialogFooter>
          <Button ref={keepRef} variant="outline" onClick={() => onOpenChange(false)}>
            Keep my booking
          </Button>
          <Button variant="destructive" onClick={cancel} loading={busy} loadingText="Cancelling your booking…">
            Yes, cancel booking
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function LoadingState() {
  return (
    <GuestShell footer={false}>
      <div className="mx-auto max-w-7xl px-4 pb-16 sm:px-6" role="status" aria-label="Loading your booking">
        <Skeleton className="mt-3 h-10 w-28" />
        <div className="mt-4 grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-10">
          <div className="space-y-6">
            <Skeleton className="h-80 rounded-2xl" />
            <Skeleton className="h-64 rounded-2xl" />
          </div>
          <Skeleton className="h-72 rounded-2xl" />
        </div>
      </div>
    </GuestShell>
  );
}

function BookingPage() {
  const { bookingId } = useParams<{ bookingId: string }>();
  const params = useSearchParams();
  const router = useRouter();
  const reduce = useReducedMotion();
  const { status } = useSession();
  const { data: b, error, mutate } = useSWR<GuestBooking>(status === 'authenticated' ? `/api/bookings/${bookingId}` : null, fetcher);
  const { data: config } = useSWR<{ emailEnabled: boolean }>('/api/config', fetcher);
  const [changeOpen, setChangeOpen] = React.useState(false);
  const [cancelOpen, setCancelOpen] = React.useState(params.get('action') === 'cancel');
  const [copied, setCopied] = React.useState(false);
  const isNew = params.get('new') === '1';
  const payment = params.get('payment');

  React.useEffect(() => {
    if (status === 'unauthenticated') router.replace(`/login?callbackUrl=${encodeURIComponent(`/bookings/${bookingId}`)}`);
  }, [status, router, bookingId]);

  // The voice front desk (the site's voice dock) knows which booking is on screen.
  useVoicePage({
    kind: 'booking',
    propertyId: b?.property.id ?? null,
    propertyName: b?.property.name ?? null,
    brand: b?.property.primaryColor ?? null,
    summary: b
      ? `their booking page at ${b.property.name}: confirmation ${b.code}, ${BOOKING_STATUS[b.status]?.label.toLowerCase() ?? b.status.toLowerCase()}, ${b.roomType.name}, ${fmtDay(b.checkIn, 'weekday')} to ${fmtDay(b.checkOut, 'weekday')}, ${plural(b.guests, 'guest')}, ${price(b.totalPrice)} (${paymentLabel(b.paymentStatus).label.toLowerCase()})${
          b.policy.passed ? '' : `; free changes until ${b.policy.deadlineLabel}`
        }${isNew ? ' — they have just booked it' : ''}`
      : null,
  });

  if (error) {
    return (
      <GuestShell>
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
          <h1 className="sr-only">Your booking</h1>
          <div className="mx-auto max-w-xl rounded-2xl border bg-card">
            <EmptyState
              icon={TriangleAlert}
              title="We couldn’t open this booking"
              description={(error as Error).message || 'It may belong to another account. Check you’re signed in with the email you booked with.'}
              action={
                <Button asChild variant="default">
                  <Link href="/dashboard">Go to my trips</Link>
                </Button>
              }
            />
          </div>
        </div>
      </GuestShell>
    );
  }

  if (!b) return <LoadingState />;

  const scope = brandScope(b.property.primaryColor);
  const upcoming = b.status === 'CONFIRMED' || b.status === 'PENDING';
  const cancelled = b.status === 'CANCELLED' || b.status === 'NO_SHOW';
  const today = localToday();
  const daysToGo = nightsBetween(today, b.checkIn);
  const pay = paymentLabel(b.paymentStatus);
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${b.property.name}, ${b.property.address}, ${b.property.city}, ${b.property.state}`)}`;
  const justBooked = !cancelled && (isNew || payment === 'success');
  const cancelBlocked = params.get('action') === 'cancel' && !b.canCancel && !cancelled;
  const countdown =
    b.status === 'CHECKED_IN'
      ? 'Enjoy your stay'
      : b.status === 'CHECKED_OUT'
        ? 'Thanks for staying'
        : cancelled
          ? null
          : daysToGo <= 0
            ? 'Check-in is today'
            : daysToGo === 1
              ? 'See you tomorrow'
              : `${daysToGo} days to go`;
  const requests = b.notes ? b.notes.split('\n').filter((l) => !l.startsWith('[')).join('\n') || b.notes : null;

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(b.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable — the code is visible anyway */
    }
  };

  const downloadIcs = () => {
    const url = URL.createObjectURL(new Blob([icsFor(b)], { type: 'text/calendar' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `stay-${b.code}.ics`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <GuestShell brandColor={b.property.primaryColor} brand={{ name: b.property.name, href: `/properties/${b.property.id}` }}>
      <div className="mx-auto max-w-7xl px-4 pb-16 sm:px-6">
        <Link
          href="/dashboard"
          className="-ml-1 mt-3 inline-flex min-h-10 items-center gap-1.5 rounded-md px-1 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden /> My trips
        </Link>

        {justBooked && (
          <motion.div
            initial={reduce ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            role="status"
            className="mt-3 flex items-start gap-4 rounded-2xl border border-success/25 bg-success-soft p-5 text-success-soft-foreground sm:items-center sm:p-6"
          >
            <motion.span
              initial={reduce ? false : { scale: 0.6, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: 'spring', delay: 0.15 }}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-success text-success-foreground"
              aria-hidden
            >
              <Check className="h-6 w-6" />
            </motion.span>
            <div className="min-w-0">
              <p className="font-display text-2xl leading-tight tracking-tight">{payment === 'success' ? 'Payment received — you’re booked!' : 'You’re booked!'}</p>
              <p className="mt-1 text-sm">
                {config?.emailEnabled ? `We’ve emailed your confirmation to ${b.user.email}. ` : 'Keep your confirmation code handy. '}
                {b.property.name} is expecting you on {fmtDay(b.checkIn, 'long')}.
              </p>
            </div>
          </motion.div>
        )}
        {payment === 'cancelled' && b.paymentStatus === 'AWAITING_PAYMENT' && (
          <Callout tone="warning" className="mt-3" role="alert">
            Payment wasn’t completed, so this booking isn’t confirmed yet. Book again and choose “Pay at the hotel”, or contact {b.property.name}.
          </Callout>
        )}

        <div className="mt-4 grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-x-10">
          <div className="min-w-0 space-y-6 lg:col-start-1 lg:row-start-1">
            {/* Hero + stay */}
            <motion.section initial={reduce ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="overflow-hidden rounded-2xl border bg-card shadow-soft" aria-labelledby="stay-title">
              <div className="relative">
                <SmartImage src={b.property.photos[0]?.url} alt="" priority sizes="(min-width: 1024px) 60vw, 100vw" className={cn('h-48 w-full sm:h-60', cancelled && 'grayscale')} />
                <div className="absolute inset-0 bg-gradient-to-t from-overlay/80 via-overlay/25 to-transparent" aria-hidden />
                <div className="absolute inset-x-5 bottom-4 text-inverse-foreground sm:inset-x-6 sm:bottom-5">
                  <p className="flex items-center gap-1.5 text-sm opacity-90">
                    <MapPin className="h-3.5 w-3.5" aria-hidden /> {b.property.city}, {b.property.state}
                  </p>
                  <h1 id="stay-title" className="font-display text-3xl leading-tight tracking-tight sm:text-4xl">
                    <span className="sr-only">Your stay at </span>
                    {b.property.name}
                  </h1>
                </div>
              </div>

              <div className="flex flex-col gap-4 border-b p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <BookingStatusBadge status={b.status} />
                    {countdown && <span className="text-base font-semibold">{countdown}</span>}
                  </div>
                  <p className="mt-1.5 text-sm text-muted-foreground">
                    {cancelled ? `This booking was ${b.status === 'NO_SHOW' ? 'marked as a no-show' : 'cancelled'}.` : `${b.user.firstName} ${b.user.lastName} · ${plural(b.guests, 'guest')}`}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={copyCode}
                  className="group flex min-h-12 items-center gap-3 self-start rounded-xl border border-dashed border-border-strong/60 px-4 py-2 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:self-auto"
                  aria-label={`Confirmation code ${b.code.split('').join(' ')}. Copy`}
                >
                  <span>
                    <span className="block text-xs text-muted-foreground">Confirmation code</span>
                    <span className="font-mono text-lg font-semibold tracking-[0.2em]">{b.code}</span>
                  </span>
                  {copied ? <Check className="h-4 w-4 text-success" aria-hidden /> : <Copy className="h-4 w-4 text-muted-foreground group-hover:text-foreground" aria-hidden />}
                </button>
                <span className="sr-only" aria-live="polite">
                  {copied ? 'Confirmation code copied' : ''}
                </span>
              </div>

              <div className="p-5 sm:p-6">
                <dl className="grid grid-cols-2 divide-x rounded-xl border">
                  <div className="p-4">
                    <dt className="text-xs text-muted-foreground">Check in</dt>
                    <dd className="mt-0.5 text-lg font-semibold">{fmtDay(b.checkIn, 'weekday')}</dd>
                    <dd className="text-sm text-muted-foreground">from 3:00 PM</dd>
                  </div>
                  <div className="p-4">
                    <dt className="text-xs text-muted-foreground">Check out</dt>
                    <dd className="mt-0.5 text-lg font-semibold">{fmtDay(b.checkOut, 'weekday')}</dd>
                    <dd className="text-sm text-muted-foreground">by 11:00 AM</dd>
                  </div>
                </dl>
                <ul className="mt-5 space-y-3 text-sm">
                  <li className="flex items-center gap-3">
                    <BedDouble className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                    <span>
                      {b.roomType.name}
                      {b.rooms > 1 ? ` × ${b.rooms}` : ''}
                      {b.room && <span className="text-muted-foreground"> · Room {b.room.roomNumber}</span>}
                    </span>
                  </li>
                  <li className="flex items-center gap-3">
                    <Users className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                    {plural(b.guests, 'guest')} · {plural(b.nights, 'night')}
                  </li>
                  <li className="flex items-center gap-3">
                    <CreditCard className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                    <span>
                      <span className="font-semibold tabular">{price(b.totalPrice)}</span>
                      <span className="text-muted-foreground"> · {pay.label}</span>
                    </span>
                  </li>
                </ul>
                {requests && (
                  <div className="mt-5 rounded-xl bg-muted px-4 py-3 text-sm">
                    <p className="text-xs font-medium text-muted-foreground">Your requests</p>
                    <p className="mt-0.5 whitespace-pre-line">{requests}</p>
                  </div>
                )}
              </div>
            </motion.section>

            {/* Manage */}
            {(upcoming || b.status === 'CHECKED_IN') && (
              <section className="rounded-2xl border bg-card p-5 shadow-xs sm:p-6" aria-labelledby="manage-title">
                <h2 id="manage-title" className="text-lg font-semibold tracking-tight">
                  Change or cancel
                </h2>
                {b.policy.passed ? (
                  <p className="mt-2 flex items-start gap-2.5 text-sm text-muted-foreground">
                    <Clock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                    <span>
                      The free change window closed at {b.policy.deadlineLabel}. To change or cancel now, contact {b.property.name}
                      {b.property.phone ? ` on ${b.property.phone}` : ''}.
                    </span>
                  </p>
                ) : (
                  <p className="mt-2 flex items-start gap-2.5 rounded-xl bg-success-soft px-3.5 py-2.5 text-sm text-success-soft-foreground">
                    <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                    <span>
                      <strong className="font-semibold">Free changes and cancellation until {b.policy.deadlineLabel}</strong> — the day before check-in.
                    </span>
                  </p>
                )}
                {cancelBlocked && (
                  <Callout tone="warning" className="mt-3" role="alert">
                    This booking can’t be cancelled online any more. Please contact the hotel.
                  </Callout>
                )}
                {(b.canModifyCheckIn || b.canModifyCheckOut || b.canCancel) && (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {(b.canModifyCheckIn || b.canModifyCheckOut) && (
                      <Button variant="outline" onClick={() => setChangeOpen(true)}>
                        Change dates
                      </Button>
                    )}
                    {b.canCancel && (
                      <Button variant="ghost" className="text-destructive hover:bg-destructive-soft hover:text-destructive-soft-foreground" onClick={() => setCancelOpen(true)}>
                        Cancel booking
                      </Button>
                    )}
                  </div>
                )}
              </section>
            )}

          </div>

          <aside className={cn('space-y-4 lg:col-start-2 lg:row-start-1', b.statusHistory.length > 0 && 'lg:row-span-2')} aria-label="Hotel details">
            <section className="rounded-2xl border bg-card p-5 shadow-xs sm:p-6 lg:sticky lg:top-24" aria-labelledby="getting-there-title">
              <h2 id="getting-there-title" className="text-lg font-semibold tracking-tight">
                Getting there
              </h2>
              <p className="mt-3 flex items-start gap-2.5 text-sm">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-brand" aria-hidden />
                <span>
                  {b.property.address}
                  <br />
                  {b.property.city}, {b.property.state} {b.property.zipCode}
                </span>
              </p>
              <div className="mt-4 grid gap-2">
                <Button asChild variant="outline" className="h-11 justify-start">
                  <a href={mapsUrl} target="_blank" rel="noreferrer">
                    <NavIcon aria-hidden /> Directions<span className="sr-only"> (opens in a new tab)</span>
                  </a>
                </Button>
                <Button asChild variant="outline" className="h-11 justify-start">
                  <a href={`tel:${b.property.phone}`}>
                    <Phone aria-hidden /> <span className="sr-only">Call the hotel: </span>
                    {b.property.phone}
                  </a>
                </Button>
                {b.property.email && (
                  <Button asChild variant="outline" className="h-11 justify-start">
                    <a href={`mailto:${b.property.email}?subject=${encodeURIComponent(`Booking ${b.code}`)}`}>
                      <Mail aria-hidden /> Email the hotel
                    </a>
                  </Button>
                )}
                {!cancelled && b.status !== 'CHECKED_OUT' && (
                  <Button variant="outline" className="h-11 justify-start" onClick={downloadIcs}>
                    <CalendarPlus aria-hidden /> Add to calendar
                  </Button>
                )}
              </div>
              {(b.status === 'CHECKED_OUT' || cancelled) && (
                <Button asChild variant="brand" className="mt-4 h-11 w-full">
                  <Link href={`/properties/${b.property.id}`}>Book {b.property.name} again</Link>
                </Button>
              )}
              {justBooked && (
                <p className="mt-4 flex items-start gap-2 text-xs text-muted-foreground">
                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /> You can find this booking any time under My trips.
                </p>
              )}
            </section>
          </aside>

          {/* Timeline: after "Getting there" on phones, under the stay on desktop. */}
          {b.statusHistory.length > 0 && (
            <section className="min-w-0 rounded-2xl border bg-card p-5 shadow-xs sm:p-6 lg:col-start-1 lg:row-start-2" aria-labelledby="history-title">
              <h2 id="history-title" className="text-lg font-semibold tracking-tight">
                History
              </h2>
              <ol className="relative mt-4 space-y-4 border-l pl-5">
                {[...b.statusHistory].reverse().map((h, i) => (
                  <li key={i} className="relative">
                    <span className={cn('absolute -left-[25px] top-1.5 h-2.5 w-2.5 rounded-full ring-4 ring-card', i === 0 ? 'bg-brand' : 'bg-border-strong')} aria-hidden />
                    <p className="text-sm">{h.notes ?? BOOKING_STATUS[h.status as BookingStatus]?.label ?? h.status}</p>
                    <p className="text-xs text-muted-foreground">
                      <time dateTime={h.createdAt}>{new Date(h.createdAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</time>
                    </p>
                  </li>
                ))}
              </ol>
            </section>
          )}
        </div>
      </div>

      <ChangeDatesDialog booking={b} open={changeOpen} onOpenChange={setChangeOpen} onDone={() => void mutate()} scope={scope} />
      <CancelDialog b={b} open={cancelOpen && b.canCancel} onOpenChange={setCancelOpen} onDone={() => mutate()} />
    </GuestShell>
  );
}

export default function Page() {
  return (
    <React.Suspense fallback={<LoadingState />}>
      <BookingPage />
    </React.Suspense>
  );
}
