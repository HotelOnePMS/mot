'use client';

import * as React from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion, useReducedMotion } from 'framer-motion';
import { BadgeCheck, Building2, CalendarX2, Clock, Info, MapPin, RefreshCw, SearchX, ShieldCheck, Users, Zap } from 'lucide-react';
import { fetcher } from '@/lib/fetcher';
import { fmtRange, nightsBetween } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Callout, EmptyState, Skeleton } from '@/components/ui/primitives';
import { SmartImage } from '@/components/ui/smart-image';
import { StaySearch, defaultStay, type StayQuery } from '@/components/guest/StaySearch';
import { useVoicePage } from '@/components/voice/page-context';
import { GuestShell } from './_components/guest-shell';
import { plural, price } from './_components/format';

interface PropertyCard {
  id: string;
  name: string;
  tagline: string | null;
  type: string | null;
  description: string | null;
  city: string;
  state: string;
  primaryColor: string | null;
  amenities: string[];
  mainPhoto: string | null;
  roomTypeCount: number;
  maxCapacity: number;
  fromPrice: number | null;
  available: boolean | null;
  isDemo: boolean;
}

type Query = StayQuery & { dated: boolean; q: string };

function readQuery(params: URLSearchParams): Query {
  const d = defaultStay();
  const checkIn = params.get('checkIn');
  const checkOut = params.get('checkOut');
  const dated = !!checkIn && !!checkOut && checkOut > checkIn;
  return {
    q: params.get('q') ?? '',
    checkIn: dated ? checkIn! : d.checkIn,
    checkOut: dated ? checkOut! : d.checkOut,
    guests: Number(params.get('guests')) || 2,
    dated,
  };
}

type Blocker = { kind: 'closed' | 'capacity' | 'sold-out'; label: string; detail: string };

/** Why a hotel can't take this search as it stands (shown as text; the card sorts last). */
function blocker(p: PropertyCard, q: Query): Blocker | null {
  if (p.roomTypeCount === 0) return { kind: 'closed', label: 'Not taking bookings yet', detail: 'Rooms coming soon' };
  if (p.maxCapacity > 0 && p.maxCapacity < q.guests) {
    const rooms = Math.ceil(q.guests / p.maxCapacity);
    // With dates, "unavailable" also covers "no single room fits the party", so a sold-out hotel looks
    // the same as a small one: don't promise rooms, send the guest to the hotel page to check.
    const detail = q.dated && p.available === false ? `Check ${plural(rooms, 'room')} for your dates` : `Book ${plural(rooms, 'room')} for ${q.guests} guests`;
    return { kind: 'capacity', label: `Rooms sleep up to ${p.maxCapacity}`, detail };
  }
  if (p.available === false) return { kind: 'sold-out', label: 'Sold out for your dates', detail: 'Try other dates' };
  return null;
}

const BLOCKER_ICON = { closed: Clock, capacity: Users, 'sold-out': CalendarX2 } as const;

const GRID = 'grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4';

function CardSkeleton() {
  return (
    <div aria-hidden>
      <Skeleton className="aspect-[4/3] h-auto rounded-2xl" />
      <Skeleton className="mt-3 h-5 w-2/3" />
      <Skeleton className="mt-2 h-4 w-1/2" />
      <Skeleton className="mt-2 h-4 w-5/6" />
      <Skeleton className="mt-3 h-6 w-1/3" />
    </div>
  );
}

function StayCard({ p, query, nights, index, href }: { p: PropertyCard; query: Query; nights: number; index: number; href: string }) {
  const reduce = useReducedMotion();
  const block = blocker(p, query);
  // Sold out or closed: greyed out. Too small for the party is still bookable with more rooms.
  const dim = !!block && block.kind !== 'capacity';
  return (
    <motion.li
      initial={reduce ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index, 8) * 0.04, duration: 0.3 }}
      className="min-w-0"
    >
      <Link
        href={href}
        className="group block rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 focus-visible:ring-offset-background"
      >
        <div className="relative overflow-hidden rounded-2xl">
          <SmartImage
            src={p.mainPhoto}
            icon={Building2}
            aspectRatio="4 / 3"
            sizes="(min-width: 1280px) 25vw, (min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
            className={cn('w-full transition-transform duration-700 group-hover:scale-[1.03] motion-reduce:transition-none motion-reduce:group-hover:scale-100', dim && 'grayscale-[70%]')}
            imgClassName={cn(dim && 'opacity-70')}
            loading={index < 4 ? 'eager' : 'lazy'}
          />
          {block && (
            <Badge variant="outline" icon={BLOCKER_ICON[block.kind]} className="absolute left-3 top-3 border-transparent bg-surface/95 text-foreground shadow-xs backdrop-blur">
              {block.label}
            </Badge>
          )}
        </div>
        <div className="mt-3 min-w-0">
          <h3 className="truncate text-base font-semibold tracking-tight underline-offset-4 group-hover:underline">{p.name}</h3>
          <p className="mt-0.5 flex items-center gap-1 truncate text-sm text-muted-foreground">
            <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <span className="truncate">
              {p.city}, {p.state}
              {p.type ? ` · ${p.type}` : ''}
            </span>
          </p>
          {p.tagline && <p className="mt-1 line-clamp-1 text-sm text-muted-foreground">{p.tagline}</p>}
          <div className="mt-2.5 min-h-12">
            {block && block.kind !== 'capacity' ? (
              <p className="text-sm text-muted-foreground">{block.detail}</p>
            ) : block ? (
              <>
                {p.fromPrice !== null && (
                  <p className="text-sm text-muted-foreground">
                    From <span className="font-semibold text-foreground tabular">{price(Math.round(p.fromPrice))}</span> / night per room
                  </p>
                )}
                <p className="text-xs text-muted-foreground">{block.detail}</p>
              </>
            ) : p.fromPrice !== null ? (
              <>
                <p className="text-sm text-muted-foreground">
                  From <span className="text-lg font-semibold text-foreground tabular">{price(Math.round(p.fromPrice))}</span> / night
                </p>
                {query.dated && nights > 0 && (
                  <p className="text-xs text-muted-foreground tabular">
                    {price(Math.round(p.fromPrice * nights))} total · {plural(nights, 'night')}
                  </p>
                )}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">See rooms and prices</p>
            )}
          </div>
        </div>
      </Link>
    </motion.li>
  );
}

function Directory() {
  const router = useRouter();
  const params = useSearchParams();
  const query = React.useMemo(() => readQuery(params), [params]);
  const apiParams = new URLSearchParams();
  if (query.q) apiParams.set('q', query.q);
  apiParams.set('guests', String(query.guests));
  if (query.dated) {
    apiParams.set('checkIn', query.checkIn);
    apiParams.set('checkOut', query.checkOut);
  }
  const { data, error, isLoading, isValidating, mutate } = useSWR<PropertyCard[]>(`/api/properties?${apiParams}`, fetcher, { keepPreviousData: true });
  const nights = nightsBetween(query.checkIn, query.checkOut);

  const go = (v: Partial<StayQuery> & { q?: string }) => {
    const p = new URLSearchParams({ checkIn: v.checkIn ?? query.checkIn, checkOut: v.checkOut ?? query.checkOut, guests: String(v.guests ?? query.guests) });
    const q = (v.q ?? '').trim();
    if (q) p.set('q', q);
    router.replace(`/properties?${p}`, { scroll: false });
  };

  const stayParams = new URLSearchParams({ checkIn: query.checkIn, checkOut: query.checkOut, guests: String(query.guests) });
  // Hotels that can take this search first; the rest keep their order but sort last.
  // (Hotels that need several rooms for the party come before sold-out ones.)
  const rank = (p: PropertyCard) => ({ none: 0, capacity: 1, 'sold-out': 2, closed: 3 })[blocker(p, query)?.kind ?? 'none'];
  const sorted = (data ?? [])
    .map((p, i) => ({ p, i, r: rank(p) }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.p);
  const anyDemo = sorted.some((p) => p.isDemo);
  const bookable = sorted.filter((p) => !blocker(p, query)).length;
  const multiRoom = sorted.filter((p) => blocker(p, query)?.kind === 'capacity').length;
  const searching = isValidating && !!data;

  // The voice concierge knows what the guest is browsing.
  useVoicePage({
    kind: 'directory',
    stay: query.dated ? { checkIn: query.checkIn, checkOut: query.checkOut, guests: query.guests, rooms: 1 } : null,
    summary: `the list of hotels${query.q ? ` matching “${query.q}”` : ''}${query.dated ? ` for ${fmtRange(query.checkIn, query.checkOut)}` : ''}, ${plural(query.guests, 'guest')}${
      data ? ` — ${plural(sorted.length, 'hotel')} shown${sorted.length ? `: ${sorted.slice(0, 5).map((p) => `${p.name} (${p.city})`).join(', ')}${sorted.length > 5 ? '…' : ''}` : ''}` : ''
    }`,
  });

  return (
    <>
      <section className="relative overflow-hidden border-b bg-gradient-to-b from-primary-soft/70 via-background to-background">
        <div className="relative mx-auto max-w-7xl px-4 pb-10 pt-10 sm:px-6 sm:pb-12 sm:pt-16">
          <p className="text-2xs font-semibold uppercase tracking-wider text-primary-soft-foreground">Book direct</p>
          <h1 className="mt-2 max-w-2xl text-balance font-display text-4xl leading-[1.1] tracking-tight sm:text-5xl">Find your next stay</h1>
          <p className="mt-3 max-w-xl text-pretty text-base text-muted-foreground sm:text-lg">Independent hotels with live prices, instant confirmation and no booking fees.</p>
          <StaySearch className="mt-8" value={query} onSubmit={(v) => go(v)} pending={searching} />
          <ul className="mt-5 flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground">
            {[
              { icon: Zap, text: 'Instant confirmation' },
              { icon: ShieldCheck, text: 'Free changes until 3 PM the day before' },
              { icon: BadgeCheck, text: 'No booking fees' },
            ].map((f) => (
              <li key={f.text} className="flex items-center gap-2">
                <f.icon className="h-4 w-4 text-primary" aria-hidden /> {f.text}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-10 sm:px-6" aria-labelledby="results-heading" aria-busy={isLoading || searching}>
        <div className="mb-6 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
          <div className="min-w-0">
            <h2 id="results-heading" className="text-xl font-semibold tracking-tight">
              {query.q ? `Stays matching “${query.q}”` : 'All stays'}
            </h2>
            <p className="mt-0.5 text-sm text-muted-foreground" role="status">
              {query.dated ? `${fmtRange(query.checkIn, query.checkOut)} · ${plural(nights, 'night')} · ` : ''}
              {plural(query.guests, 'guest')}
              {data ? ` · ${bookable || !multiRoom ? `${plural(bookable, 'stay')} available` : `${plural(multiRoom, 'stay')} can host ${query.guests} guests across several rooms`}` : ''}
            </p>
          </div>
          {/* With no results, the empty state carries this button instead. */}
          {query.q && sorted.length > 0 && (
            <Button variant="ghost" size="sm" onClick={() => go({ q: '' })}>
              Clear search
            </Button>
          )}
        </div>

        {anyDemo && (
          <Callout tone="info" icon={Info} className="mb-8">
            These are demo hotels — look around and book freely. Nothing is charged.
          </Callout>
        )}

        {error && !data ? (
          <div className="rounded-2xl border bg-card">
            <EmptyState
              icon={RefreshCw}
              title="We couldn’t load stays"
              description="Check your connection and try again."
              action={
                <Button variant="outline" onClick={() => void mutate()}>
                  Try again
                </Button>
              }
            />
          </div>
        ) : isLoading && !data ? (
          <div className={GRID} role="status" aria-label="Loading stays">
            {Array.from({ length: 4 }).map((_, i) => (
              <CardSkeleton key={i} />
            ))}
          </div>
        ) : !sorted.length ? (
          <div className="rounded-2xl border bg-card">
            <EmptyState
              icon={SearchX}
              title={query.q ? `No stays match “${query.q}”` : 'No hotels are taking bookings yet'}
              description={query.q ? 'Check the spelling, or try a nearby city or the hotel’s name.' : 'Check back soon — new hotels are added all the time.'}
              action={
                query.q ? (
                  <Button variant="outline" onClick={() => go({ q: '' })}>
                    Clear search
                  </Button>
                ) : undefined
              }
            />
          </div>
        ) : (
          <ul className={cn(GRID, 'transition-opacity', searching && 'opacity-60')}>
            {sorted.map((p, i) => (
              <StayCard key={p.id} p={p} query={query} nights={nights} index={i} href={`/properties/${p.id}?${stayParams}`} />
            ))}
          </ul>
        )}

        {data && sorted.length > 0 && bookable === 0 && (
          <p className="mt-10 text-center text-sm text-muted-foreground">
            {multiRoom ? `No single room sleeps ${query.guests} — open a hotel to book several rooms together.` : 'Nothing is free for this search — try other dates or fewer guests.'}
          </p>
        )}
      </section>
    </>
  );
}

export default function PropertiesPage() {
  return (
    <GuestShell>
      <React.Suspense>
        <Directory />
      </React.Suspense>
    </GuestShell>
  );
}
