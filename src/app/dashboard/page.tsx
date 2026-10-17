'use client';

import * as React from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { useSession } from 'next-auth/react';
import { motion, useReducedMotion } from 'framer-motion';
import { ArrowRight, CalendarDays, LayoutDashboard, Luggage, MapPin, RefreshCw, Search } from 'lucide-react';
import type { BookingStatus } from '@/lib/dto';
import { fetcher } from '@/lib/fetcher';
import { fmtDay, fmtRange, localToday, nightsBetween } from '@/lib/format';
import { isStaffRole } from '@/lib/routes';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Callout, EmptyState, Skeleton } from '@/components/ui/primitives';
import { SmartImage } from '@/components/ui/smart-image';
import { BookingStatusBadge } from '@/components/hotel/badges';
import { brandScope } from '@/components/guest/brand';
import { useVoicePage } from '@/components/voice/page-context';
import { GuestShell } from '@/app/properties/_components/guest-shell';
import { plural, price } from '@/app/properties/_components/format';

interface Trip {
  id: string;
  code: string | null;
  status: BookingStatus;
  checkIn: string;
  checkOut: string;
  guests: number;
  rooms: number;
  totalPrice: number;
  paymentStatus: string;
  property: { id: string; name: string; city: string; state: string; primaryColor: string | null; photos: { url: string }[] };
  roomType: { name: string; photos: { url: string }[] };
  room: { roomNumber: string } | null;
}

const photoOf = (t: Trip) => t.property.photos[0]?.url ?? t.roomType.photos[0]?.url;

function NextTrip({ trip }: { trip: Trip }) {
  const reduce = useReducedMotion();
  const days = nightsBetween(localToday(), trip.checkIn);
  const inHouse = trip.status === 'CHECKED_IN';
  const scope = brandScope(trip.property.primaryColor);
  return (
    <motion.div initial={reduce ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} style={scope.style} className={scope.className}>
      <Link
        href={`/bookings/${trip.id}`}
        className="group grid overflow-hidden rounded-2xl border bg-card shadow-soft transition-shadow hover:shadow-lifted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background md:grid-cols-[1.15fr_1fr]"
      >
        <SmartImage src={photoOf(trip)} alt="" priority sizes="(min-width: 768px) 55vw, 100vw" className="aspect-[16/10] md:aspect-auto md:h-full md:min-h-80" />
        <div className="flex flex-col p-6 sm:p-8">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-soft px-2.5 py-1 text-xs font-semibold text-brand-soft-foreground">
              <CalendarDays className="h-3.5 w-3.5" aria-hidden />
              {inHouse ? 'You’re staying here now' : days <= 0 ? 'Check-in today' : days === 1 ? 'Tomorrow' : `In ${days} days`}
            </span>
            <BookingStatusBadge status={trip.status} />
          </div>
          <h3 className="mt-4 font-display text-3xl leading-tight tracking-tight">{trip.property.name}</h3>
          <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
            <MapPin className="h-3.5 w-3.5" aria-hidden /> {trip.property.city}, {trip.property.state}
          </p>
          <dl className="mt-6 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
            <div>
              <dt className="text-xs text-muted-foreground">Check in</dt>
              <dd className="font-semibold">{fmtDay(trip.checkIn, 'weekday')}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Check out</dt>
              <dd className="font-semibold">{fmtDay(trip.checkOut, 'weekday')}</dd>
            </div>
            <div className="min-w-0">
              <dt className="text-xs text-muted-foreground">Room</dt>
              <dd className="truncate font-semibold">
                {trip.roomType.name}
                {trip.room ? ` · ${trip.room.roomNumber}` : ''}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Confirmation</dt>
              <dd className="font-mono font-semibold tracking-wider">{trip.code ?? '—'}</dd>
            </div>
          </dl>
          <span className="mt-auto inline-flex items-center gap-1.5 pt-6 text-sm font-semibold text-brand">
            Manage booking <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" aria-hidden />
          </span>
        </div>
      </Link>
    </motion.div>
  );
}

/** A trip as a card; the whole card opens the booking, and past stays get a "Book again" link. */
function TripCard({ trip, bookAgain }: { trip: Trip; bookAgain?: boolean }) {
  const nights = nightsBetween(trip.checkIn, trip.checkOut);
  const cancelled = trip.status === 'CANCELLED' || trip.status === 'NO_SHOW';
  return (
    <li className="group relative flex flex-col overflow-hidden rounded-2xl border bg-card shadow-xs transition-shadow focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-background hover:shadow-soft">
      <SmartImage src={photoOf(trip)} alt="" aspectRatio="16 / 9" sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw" className={cn(cancelled && 'grayscale')} />
      <div className="flex flex-1 flex-col p-4">
        <div className="flex items-start justify-between gap-3">
          <h3 className="min-w-0 truncate font-semibold tracking-tight">
            <Link href={`/bookings/${trip.id}`} className="after:absolute after:inset-0 after:content-[''] focus-visible:outline-none">
              {trip.property.name}
            </Link>
          </h3>
          <BookingStatusBadge status={trip.status} className="shrink-0" />
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {fmtRange(trip.checkIn, trip.checkOut)} · {plural(nights, 'night')}
        </p>
        <p className="truncate text-sm text-muted-foreground">
          {trip.roomType.name} · <span className="tabular">{price(trip.totalPrice)}</span>
        </p>
        {bookAgain && (
          <div className="mt-auto pt-4">
            <Button asChild variant="outline" size="sm" className="relative z-10">
              <Link href={`/properties/${trip.property.id}`}>
                <RefreshCw aria-hidden /> Book again<span className="sr-only"> at {trip.property.name}</span>
              </Link>
            </Button>
          </div>
        )}
      </div>
    </li>
  );
}

function Group({ id, title, count, children }: { id: string; title: string; count?: number; children: React.ReactNode }) {
  return (
    <section className="mt-12" aria-labelledby={id}>
      <h2 id={id} className="flex items-baseline gap-2 text-xl font-semibold tracking-tight">
        {title}
        {count ? <span className="text-sm font-normal text-muted-foreground">{count}</span> : null}
      </h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

const CARD_GRID = 'grid gap-4 sm:grid-cols-2 lg:grid-cols-3';

export default function TripsPage() {
  const { data: session } = useSession();
  const { data, error, isLoading, mutate } = useSWR<Trip[]>('/api/bookings', fetcher);
  const today = localToday();
  const firstName = session?.user?.name?.split(' ')[0];

  const upcoming = (data ?? [])
    .filter((t) => (t.status === 'CONFIRMED' || t.status === 'PENDING' || t.status === 'CHECKED_IN') && t.checkOut >= today)
    .sort((a, b) => a.checkIn.localeCompare(b.checkIn));
  const past = (data ?? [])
    .filter((t) => t.status === 'CHECKED_OUT' || ((t.status === 'CONFIRMED' || t.status === 'CHECKED_IN') && t.checkOut < today))
    .sort((a, b) => b.checkIn.localeCompare(a.checkIn));
  const cancelled = (data ?? []).filter((t) => t.status === 'CANCELLED' || t.status === 'NO_SHOW').sort((a, b) => b.checkIn.localeCompare(a.checkIn));
  const [next, ...later] = upcoming;

  // The voice concierge knows the guest is looking at their trips (and the next one).
  useVoicePage({
    kind: 'trips',
    summary: data
      ? `their trips: ${plural(upcoming.length, 'upcoming stay')}${next ? `, next at ${next.property.name} on ${fmtDay(next.checkIn, 'weekday')} (confirmation ${next.code ?? 'on screen'})` : ''}`
      : 'their trips',
  });

  return (
    <GuestShell>
      <div className="mx-auto max-w-7xl px-4 pb-16 pt-8 sm:px-6 sm:pt-12">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            {firstName && <p className="text-sm font-medium text-muted-foreground">Welcome back, {firstName}</p>}
            <h1 className="mt-1 font-display text-4xl tracking-tight sm:text-5xl">My trips</h1>
            <p className="mt-2 text-muted-foreground" aria-live="polite">
              {!data ? ' ' : upcoming.length ? `You have ${plural(upcoming.length, 'upcoming stay')}.` : 'No stays coming up — where to next?'}
            </p>
          </div>
          <Button asChild variant="outline" className="self-start sm:self-auto">
            <Link href="/properties">
              <Search aria-hidden /> Find a stay
            </Link>
          </Button>
        </div>

        {isStaffRole(session?.user?.role) && (
          <Callout
            tone="neutral"
            icon={LayoutDashboard}
            className="mt-6 items-center"
            action={
              <Button asChild size="sm" variant="outline">
                <Link href="/admin">Open console</Link>
              </Button>
            }
          >
            You also have access to a hotel console.
          </Callout>
        )}

        {error && !data ? (
          <div className="mt-10 rounded-2xl border bg-card">
            <EmptyState
              icon={RefreshCw}
              title="We couldn’t load your trips"
              description="Check your connection and try again."
              action={
                <Button variant="outline" onClick={() => void mutate()}>
                  Try again
                </Button>
              }
            />
          </div>
        ) : isLoading || !data ? (
          <div className="mt-12" role="status" aria-label="Loading your trips">
            <Skeleton className="h-6 w-32" />
            <div className="mt-4 grid overflow-hidden rounded-2xl border md:grid-cols-[1.15fr_1fr]">
              <Skeleton className="aspect-[16/10] h-auto rounded-none md:aspect-auto md:h-80" />
              <div className="space-y-3 p-6 sm:p-8">
                <Skeleton className="h-6 w-28 rounded-full" />
                <Skeleton className="h-9 w-3/4" />
                <Skeleton className="h-4 w-1/3" />
                <Skeleton className="mt-6 h-24 w-full" />
              </div>
            </div>
          </div>
        ) : !data.length ? (
          <div className="mt-10 rounded-2xl border bg-card">
            <EmptyState
              icon={Luggage}
              title="No trips yet"
              description="When you book a stay it shows up here — with your confirmation, directions and free changes until the day before."
              action={
                <Button asChild size="lg">
                  <Link href="/properties">Find a stay</Link>
                </Button>
              }
            />
          </div>
        ) : (
          <>
            <Group id="upcoming-title" title="Upcoming" count={upcoming.length}>
              {next ? (
                <>
                  <NextTrip trip={next} />
                  {later.length > 0 && (
                    <ul className={cn(CARD_GRID, 'mt-4')}>
                      {later.map((t) => (
                        <TripCard key={t.id} trip={t} />
                      ))}
                    </ul>
                  )}
                </>
              ) : (
                <div className="rounded-2xl border border-dashed bg-card">
                  <EmptyState
                    icon={CalendarDays}
                    title="Nothing planned yet"
                    description="Find your next stay — book direct for the best rate and free changes until the day before."
                    action={
                      <Button asChild>
                        <Link href="/properties">Find a stay</Link>
                      </Button>
                    }
                  />
                </div>
              )}
            </Group>

            {past.length > 0 && (
              <Group id="past-title" title="Past stays" count={past.length}>
                <ul className={CARD_GRID}>
                  {past.map((t) => (
                    <TripCard key={t.id} trip={t} bookAgain />
                  ))}
                </ul>
              </Group>
            )}

            {cancelled.length > 0 && (
              <Group id="cancelled-title" title="Cancelled" count={cancelled.length}>
                <ul className={CARD_GRID}>
                  {cancelled.map((t) => (
                    <TripCard key={t.id} trip={t} bookAgain />
                  ))}
                </ul>
              </Group>
            )}

            <p className="mt-10 text-sm text-muted-foreground">Upcoming stays can be changed or cancelled free until 3 PM the day before arrival.</p>
          </>
        )}
      </div>
    </GuestShell>
  );
}
