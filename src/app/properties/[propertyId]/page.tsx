'use client';

import * as React from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { motion, useReducedMotion } from 'framer-motion';
import {
  ArrowLeft,
  AudioLines,
  BadgeCheck,
  BedDouble,
  CalendarX2,
  Check,
  Clock,
  Images,
  Lock,
  MapPin,
  Phone,
  ShieldCheck,
  TriangleAlert,
  Users,
  Zap,
} from 'lucide-react';
import type { StayQuote } from '@/lib/dto';
import { fetcher } from '@/lib/fetcher';
import { fmtRange, nightsBetween } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Callout, EmptyState, Skeleton } from '@/components/ui/primitives';
import { SmartImage } from '@/components/ui/smart-image';
import { StaySearch, defaultStay, type StayQuery } from '@/components/guest/StaySearch';
import { brandScope } from '@/components/guest/brand';
import { useVoicePage } from '@/components/voice/page-context';
import { useVoiceDock } from '@/components/voice/VoiceDock';
import { GuestShell } from '../_components/guest-shell';
import { usePropertyShell } from '../_components/property-shell';
import { plural, price } from '../_components/format';

interface Photo {
  id: string;
  url: string;
  isMain: boolean;
}
interface RoomType {
  id: string;
  name: string;
  description: string | null;
  capacity: number;
  basePrice: number;
  amenities: string[];
  photos: Photo[];
}
interface PublicProperty {
  id: string;
  name: string;
  tagline: string | null;
  type: string | null;
  description: string | null;
  address: string;
  city: string;
  state: string;
  zipCode: string;
  phone: string;
  email: string | null;
  amenities: string[];
  primaryColor: string | null;
  isDemo: boolean;
  voice?: { available: boolean };
  photos: Photo[];
  roomTypes: RoomType[];
}
interface RoomAvailability {
  id: string;
  name: string;
  capacity: number;
  available: number;
  quote: StayQuote | null;
  fitsParty: boolean;
  isAvailable: boolean;
}
interface Availability {
  roomTypes: RoomAvailability[];
}

const GALLERY_HEIGHT = { height: 'clamp(240px, 42vw, 480px)' } as const;

function readStay(params: URLSearchParams): StayQuery {
  const d = defaultStay();
  const checkIn = params.get('checkIn');
  const checkOut = params.get('checkOut');
  const ok = !!checkIn && !!checkOut && checkOut > checkIn;
  return {
    checkIn: ok ? checkIn! : d.checkIn,
    checkOut: ok ? checkOut! : d.checkOut,
    guests: Number(params.get('guests')) || 2,
    rooms: Number(params.get('rooms')) || 1,
  };
}

/** Fill the 4×2 mosaic with no gaps whatever the photo count (lead photo is 2×2). */
function spanFor(count: number, i: number): string {
  if (count === 2) return 'sm:col-span-2 sm:row-span-2';
  if (count === 3) return 'sm:col-span-2';
  if (count === 4 && i === 3) return 'sm:col-span-2';
  return '';
}

function Gallery({ photos, name, brandStyle }: { photos: Photo[]; name: string; brandStyle: ReturnType<typeof brandScope> }) {
  const [open, setOpen] = React.useState(false);
  const shown = photos.slice(0, 5);
  return (
    <>
      <div className="relative">
        <div className={cn('grid gap-2 overflow-hidden rounded-2xl', shown.length > 1 && 'sm:grid-cols-4 sm:grid-rows-2')} style={GALLERY_HEIGHT}>
          {shown.length === 0 ? (
            <SmartImage alt={name} className="h-full w-full" />
          ) : (
            shown.map((p, i) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setOpen(true)}
                className={cn(
                  'group relative overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                  i === 0 ? 'sm:col-span-2 sm:row-span-2' : cn('hidden sm:block', spanFor(shown.length, i)),
                  shown.length === 1 && 'sm:col-span-4'
                )}
                aria-label={`Open photo ${i + 1} of ${photos.length}`}
              >
                <SmartImage
                  src={p.url}
                  alt={i === 0 ? name : ''}
                  sizes={i === 0 ? '(min-width: 640px) 50vw, 100vw' : '25vw'}
                  priority={i === 0}
                  className="h-full w-full transition-transform duration-700 group-hover:scale-[1.03] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
                />
              </button>
            ))
          )}
        </div>
        {photos.length > 1 && (
          <Button variant="outline" size="sm" className="absolute bottom-3 right-3 border-transparent bg-surface/95 shadow-soft backdrop-blur" onClick={() => setOpen(true)}>
            <Images aria-hidden /> <span className="sm:hidden">{photos.length} photos</span>
            <span className="hidden sm:inline">Show all {photos.length} photos</span>
          </Button>
        )}
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent style={brandStyle.style} className={cn('max-h-[92dvh] max-w-5xl overflow-y-auto p-4 sm:p-6', brandStyle.className)}>
          <DialogHeader>
            <DialogTitle>{name}</DialogTitle>
            <DialogDescription>{plural(photos.length, 'photo')}</DialogDescription>
          </DialogHeader>
          <ul className="grid gap-3 sm:grid-cols-2">
            {photos.map((p, i) => (
              <li key={p.id}>
                <SmartImage src={p.url} alt={`${name}, photo ${i + 1} of ${photos.length}`} aspectRatio="4 / 3" sizes="(min-width: 640px) 50vw, 100vw" className="rounded-xl" />
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>
    </>
  );
}

type RoomState = 'bookable' | 'too-small' | 'sold-out' | 'unknown';

function roomState(a: RoomAvailability | undefined): RoomState {
  if (!a) return 'unknown';
  if (!a.isAvailable) return 'sold-out';
  if (!a.fitsParty) return 'too-small';
  return a.quote ? 'bookable' : 'unknown';
}

function RoomCard({
  rt,
  a,
  loading,
  stay,
  nights,
  index,
  onSelect,
  onRooms,
  onOtherDates,
}: {
  rt: RoomType;
  a: RoomAvailability | undefined;
  loading: boolean;
  stay: StayQuery;
  nights: number;
  index: number;
  onSelect: () => void;
  onRooms: (rooms: number) => void;
  onOtherDates: () => void;
}) {
  const reduce = useReducedMotion();
  const state = roomState(a);
  const q = a?.quote;
  const rooms = stay.rooms ?? 1;
  const off = state === 'sold-out' || state === 'too-small';
  const low = state === 'bookable' && a!.available <= 3;
  const neededRooms = Math.ceil(stay.guests / Math.max(1, rt.capacity));
  const titleId = `room-${rt.id}`;
  return (
    <motion.li
      initial={reduce ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.04, duration: 0.3 }}
      aria-labelledby={titleId}
      className="overflow-hidden rounded-2xl border bg-card shadow-xs transition-shadow hover:shadow-soft"
    >
      <div className="grid sm:grid-cols-[240px_1fr]">
        {/* The class (not the aspectRatio prop's inline style) sets the ratio, so from sm up the
            photo fills the 240px column at the card's height instead of widening past it. */}
        <SmartImage
          src={rt.photos[0]?.url}
          alt=""
          sizes="(min-width: 640px) 240px, 100vw"
          className={cn('aspect-[16/10] sm:aspect-auto sm:min-h-52', off && 'grayscale-[70%]')}
          imgClassName={cn(off && 'opacity-70')}
        />
        <div className="flex min-w-0 flex-col p-5">
          <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
            <div className="min-w-0">
              <h3 id={titleId} className="text-lg font-semibold tracking-tight">
                {rt.name}
              </h3>
              <p className="mt-0.5 flex items-center gap-1.5 text-sm text-muted-foreground">
                <Users className="h-4 w-4" aria-hidden /> Sleeps {rt.capacity}
              </p>
            </div>
            {low && (
              <Badge variant="warning" icon={Clock}>
                Only {a!.available} left
              </Badge>
            )}
            {state === 'sold-out' && (
              <Badge variant="neutral" icon={CalendarX2}>
                Sold out for these dates
              </Badge>
            )}
          </div>
          {rt.description && <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-muted-foreground">{rt.description}</p>}
          {rt.amenities.length > 0 && (
            <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Room features">
              {rt.amenities.slice(0, 5).map((am) => (
                <li key={am} className="rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                  {am}
                </li>
              ))}
              {rt.amenities.length > 5 && <li className="px-1 py-0.5 text-xs text-muted-foreground">+{rt.amenities.length - 5} more</li>}
            </ul>
          )}
          <div className="mt-auto flex flex-wrap items-end justify-between gap-3 pt-5">
            <div className="min-h-11">
              {loading && !a ? (
                <>
                  <Skeleton className="h-7 w-28" />
                  <Skeleton className="mt-1.5 h-4 w-36" />
                </>
              ) : q && state === 'bookable' ? (
                <>
                  <p className="text-sm text-muted-foreground">
                    <span className="text-2xl font-semibold text-foreground tabular">{price(Math.round(q.averageNightly))}</span> / night{rooms > 1 ? ' per room' : ''}
                  </p>
                  <p className="text-xs text-muted-foreground tabular">
                    {price(q.total)} total · {plural(nights, 'night')}
                    {rooms > 1 ? ` · ${plural(rooms, 'room')}` : ''}
                  </p>
                </>
              ) : state === 'too-small' ? (
                <p className="max-w-xs text-sm text-muted-foreground">
                  Sleeps {rt.capacity} per room — {stay.guests} guests need {plural(neededRooms, 'room')}.
                </p>
              ) : state === 'sold-out' ? (
                <p className="text-sm text-muted-foreground">No rooms left for {fmtRange(stay.checkIn, stay.checkOut)}.</p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  From <span className="font-semibold text-foreground tabular">{price(rt.basePrice)}</span> / night
                </p>
              )}
            </div>
            {state === 'bookable' ? (
              <Button variant="brand" className="h-11 px-5" onClick={onSelect}>
                Select<span className="sr-only"> {rt.name}</span>
              </Button>
            ) : state === 'too-small' && neededRooms <= 9 ? (
              <Button variant="outline" className="h-11" onClick={() => onRooms(neededRooms)}>
                Search {plural(neededRooms, 'room')}
              </Button>
            ) : state === 'sold-out' ? (
              <Button variant="outline" className="h-11" onClick={onOtherDates}>
                Try other dates
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    </motion.li>
  );
}

const PROMISES = [
  { icon: Zap, title: 'Instant confirmation', text: 'Your room is held the moment you book.' },
  { icon: ShieldCheck, title: 'Free changes', text: 'Cancel or move dates until 3 PM the day before.' },
  { icon: BadgeCheck, title: 'Best rate, direct', text: 'No booking fees, ever.' },
];

function PropertyPage() {
  const { propertyId } = useParams<{ propertyId: string }>();
  const router = useRouter();
  const params = useSearchParams();
  const shell = usePropertyShell();
  const stay = React.useMemo(() => readStay(params), [params]);
  const nights = nightsBetween(stay.checkIn, stay.checkOut);
  const roomsRef = React.useRef<HTMLElement>(null);
  const searchRef = React.useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();

  const { data: p, error } = useSWR<PublicProperty>(`/api/properties/${propertyId}`, fetcher);
  const availUrl = `/api/properties/${propertyId}/availability?checkIn=${stay.checkIn}&checkOut=${stay.checkOut}&guests=${stay.guests}&rooms=${stay.rooms ?? 1}`;
  const { data: avail, error: availError, isLoading: availLoading, isValidating } = useSWR<Availability>(p ? availUrl : null, fetcher, { keepPreviousData: true });

  const scrollTo = (el: HTMLElement | null) => el?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });

  const setStay = (v: StayQuery, scroll = true) => {
    const q = new URLSearchParams({ checkIn: v.checkIn, checkOut: v.checkOut, guests: String(v.guests), rooms: String(v.rooms ?? 1) });
    router.replace(`/properties/${propertyId}?${q}`, { scroll: false });
    if (scroll) setTimeout(() => scrollTo(roomsRef.current), 50);
  };

  const book = (roomTypeId: string) => {
    const q = new URLSearchParams({ roomTypeId, checkIn: stay.checkIn, checkOut: stay.checkOut, guests: String(stay.guests), rooms: String(stay.rooms ?? 1) });
    router.push(`/properties/${propertyId}/book?${q}`);
  };

  const otherDates = () => {
    // The sidebar search on desktop, the inline one on phones: whichever is showing.
    const target = [...document.querySelectorAll<HTMLElement>('[data-stay-search]')].find((el) => el.offsetParent !== null);
    scrollTo(target ?? searchRef.current);
    setTimeout(() => target?.querySelector<HTMLInputElement>('input[type="date"]')?.focus({ preventScroll: true }), 300);
  };

  const name = p?.name ?? shell?.name;
  const brandColor = p?.primaryColor ?? shell?.primaryColor;
  const scope = brandScope(brandColor);
  const directoryHref = `/properties?${new URLSearchParams({ checkIn: stay.checkIn, checkOut: stay.checkOut, guests: String(stay.guests) })}`;
  const dock = useVoiceDock();

  // The voice front desk (the dock in the root layout) sees this stay and can re-price the page or open checkout.
  const voiceRooms = (avail?.roomTypes ?? []).map((r) => ({ id: r.id, name: r.name, sleeps: r.capacity, available: roomState(r) === 'bookable', nightly: r.quote?.averageNightly ?? null, total: r.quote?.total ?? null }));
  const voiceCheapest = voiceRooms.filter((r) => r.available && r.nightly !== null).sort((a, b) => a.nightly! - b.nightly!)[0];
  useVoicePage({
    kind: 'hotel',
    propertyId,
    propertyName: name,
    brand: brandColor,
    stay: { checkIn: stay.checkIn, checkOut: stay.checkOut, guests: stay.guests, rooms: stay.rooms ?? 1 },
    roomOptions: voiceRooms,
    summary: name
      ? `${name}’s page, showing ${fmtRange(stay.checkIn, stay.checkOut)} for ${plural(stay.guests, 'guest')}${(stay.rooms ?? 1) > 1 ? `, ${plural(stay.rooms ?? 1, 'room')}` : ''}${
          avail ? (voiceCheapest ? ` — from ${price(Math.round(voiceCheapest.nightly!))} a night (${voiceCheapest.name})` : ' — nothing left for these dates') : ''
        }`
      : null,
    // Phones: clear the fixed booking bar (≈69px + safe area) at the bottom of the page.
    bottomOffset: p ? 64 : 0,
    actions: {
      // Re-price the room list for the dates the guest asked about (no scroll: the guest may be reading).
      setStay: (v) => {
        const q = new URLSearchParams({ checkIn: v.checkIn, checkOut: v.checkOut, guests: String(v.guests), rooms: String(v.rooms) });
        router.replace(`/properties/${propertyId}?${q}`, { scroll: false });
      },
      selectRoom: (roomTypeId, v) => {
        const s = v ?? { checkIn: stay.checkIn, checkOut: stay.checkOut, guests: stay.guests, rooms: stay.rooms ?? 1 };
        const q = new URLSearchParams({ roomTypeId, checkIn: s.checkIn, checkOut: s.checkOut, guests: String(s.guests), rooms: String(s.rooms) });
        router.push(`/properties/${propertyId}/book?${q}`);
      },
    },
  });

  if (error) {
    return (
      <GuestShell>
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
          <h1 className="sr-only">Hotel not available</h1>
          <div className="mx-auto max-w-xl rounded-2xl border bg-card">
            <EmptyState
              icon={TriangleAlert}
              title="This hotel isn’t taking bookings online"
              description="It may have moved or paused online booking. Browse other stays, or contact the hotel directly."
              action={
                <Button asChild variant="default">
                  <Link href="/properties">Browse stays</Link>
                </Button>
              }
            />
          </div>
        </div>
      </GuestShell>
    );
  }

  const list = avail?.roomTypes ?? [];
  const byId = new Map(list.map((r) => [r.id, r]));
  const bookable = list.filter((r) => roomState(r) === 'bookable').sort((a, b) => a.quote!.total - b.quote!.total);
  const cheapest = bookable[0];
  const order: Record<RoomState, number> = { bookable: 0, unknown: 1, 'too-small': 2, 'sold-out': 3 };
  const roomTypes = [...(p?.roomTypes ?? [])]
    .map((rt, i) => ({ rt, i }))
    .sort((a, b) => order[roomState(byId.get(a.rt.id))] - order[roomState(byId.get(b.rt.id))] || a.i - b.i)
    .map((x) => x.rt);
  const rooms = stay.rooms ?? 1;
  const voice = p?.voice?.available && dock?.available;

  const header = (
    <div>
      <p className="text-sm text-muted-foreground">
        {(p?.type ?? shell?.type) || 'Hotel'} · {p?.city ?? shell?.city}, {p?.state ?? shell?.state}
      </p>
      <h1 className="mt-1 text-balance font-display text-4xl leading-[1.1] tracking-tight sm:text-5xl">{name}</h1>
      {(p?.tagline ?? shell?.tagline) && <p className="mt-2 text-lg text-muted-foreground">{p?.tagline ?? shell?.tagline}</p>}
    </div>
  );

  return (
    <GuestShell
      brandColor={brandColor}
      brand={name ? { name, href: `/properties/${propertyId}` } : undefined}
      mainClassName="pb-12 lg:pb-16"
      // Room below the footer for the fixed booking bar (and the "Talk to us" button above it) on phones.
      className={cn('lg:pb-0', p ? (voice ? 'pb-40' : 'pb-24') : '')}
      after={
        <>
          {/* Phone booking bar (the voice dock's "Talk to us" sits above it: see bottomOffset). */}
          {p && (
            <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-surface/95 px-4 pt-3 shadow-float backdrop-blur pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:hidden">
              <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
                <div className="min-w-0" aria-live="polite">
                  {cheapest?.quote ? (
                    <p className="text-sm text-muted-foreground">
                      From <span className="text-lg font-semibold text-foreground tabular">{price(Math.round(cheapest.quote.averageNightly))}</span> / night
                    </p>
                  ) : (
                    <p className="text-sm font-medium">{avail ? 'No rooms for these dates' : 'Checking prices…'}</p>
                  )}
                  <p className="truncate text-xs text-muted-foreground">
                    {fmtRange(stay.checkIn, stay.checkOut)} · {plural(stay.guests, 'guest')}
                  </p>
                </div>
                <Button variant="brand" className="h-11 shrink-0 px-5" onClick={() => (cheapest ? scrollTo(roomsRef.current) : otherDates())}>
                  {cheapest ? 'Choose a room' : 'Change dates'}
                </Button>
              </div>
            </div>
          )}
        </>
      }
    >
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <Link
          href={directoryHref}
          className="-ml-1 mt-3 inline-flex min-h-10 items-center gap-1.5 rounded-md px-1 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden /> All stays
        </Link>

        <div className="mt-3">
          {p ? <Gallery photos={p.photos} name={p.name} brandStyle={scope} /> : <Skeleton className="w-full rounded-2xl" style={GALLERY_HEIGHT} />}
        </div>

        <div className="mt-8 grid gap-10 lg:grid-cols-[minmax(0,1fr)_380px] xl:gap-14">
          <div className="min-w-0">
            {name ? (
              header
            ) : (
              <div aria-hidden>
                <Skeleton className="h-4 w-48" />
                <Skeleton className="mt-3 h-12 w-2/3" />
                <Skeleton className="mt-3 h-5 w-1/2" />
              </div>
            )}

            <ul className="mt-6 grid gap-x-6 gap-y-4 rounded-2xl border bg-card p-4 sm:grid-cols-3 sm:p-5">
              {PROMISES.map((f) => (
                <li key={f.title} className="flex items-start gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand-soft-foreground" aria-hidden>
                    <f.icon className="h-[18px] w-[18px]" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold">{f.title}</span>
                    <span className="block text-sm leading-snug text-muted-foreground">{f.text}</span>
                  </span>
                </li>
              ))}
            </ul>

            {!p ? (
              <div className="mt-8 space-y-2" aria-hidden>
                <Skeleton className="h-4 w-full max-w-prose" />
                <Skeleton className="h-4 w-11/12 max-w-prose" />
                <Skeleton className="h-4 w-2/3 max-w-prose" />
              </div>
            ) : (
              <>
                {p.description && <p className="mt-8 max-w-prose whitespace-pre-line text-base leading-relaxed text-foreground/90">{p.description}</p>}

                {p.amenities.length > 0 && (
                  <section className="mt-10" aria-labelledby="amenities-heading">
                    <h2 id="amenities-heading" className="text-xl font-semibold tracking-tight">
                      What this place offers
                    </h2>
                    <ul className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
                      {p.amenities.map((a) => (
                        <li key={a} className="flex items-center gap-2.5 text-sm">
                          <Check className="h-4 w-4 shrink-0 text-brand" aria-hidden /> {a}
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
              </>
            )}

            {/* Rooms */}
            <section ref={roomsRef} className="mt-12 scroll-mt-24" aria-labelledby="rooms-heading" aria-busy={availLoading || isValidating}>
              <h2 id="rooms-heading" className="font-display text-3xl tracking-tight">
                Choose your room
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {fmtRange(stay.checkIn, stay.checkOut)} · {plural(nights, 'night')} · {plural(stay.guests, 'guest')}
                {rooms > 1 ? ` · ${plural(rooms, 'room')}` : ''}
              </p>
              <div ref={searchRef} data-stay-search className="mt-5 scroll-mt-24 lg:hidden">
                <StaySearch value={stay} onSubmit={(v) => setStay(v)} showDestination={false} showRooms submitLabel="Update" compact pending={isValidating && !!avail} />
              </div>
              {availError && (
                <Callout tone="warning" className="mt-5" role="alert">
                  {(availError as Error).message}
                </Callout>
              )}
              {p && avail && !cheapest && roomTypes.length > 0 && (
                <Callout tone="warning" className="mt-5" role="status">
                  Nothing left that fits {plural(stay.guests, 'guest')} for {fmtRange(stay.checkIn, stay.checkOut)}. Try other dates{rooms === 1 ? ' or more rooms' : ''}.
                </Callout>
              )}
              {!p ? (
                <div className="mt-5 space-y-4" aria-hidden>
                  {[0, 1].map((i) => (
                    <Skeleton key={i} className="h-60 rounded-2xl sm:h-52" />
                  ))}
                </div>
              ) : roomTypes.length === 0 ? (
                <div className="mt-5 rounded-2xl border bg-card">
                  <EmptyState
                    icon={BedDouble}
                    title="Rooms coming soon"
                    description={`${p.name} hasn’t published its rooms online yet. Call them to book${p.phone ? ` on ${p.phone}` : ''}.`}
                  />
                </div>
              ) : (
                <ul className={cn('mt-5 space-y-4 transition-opacity', isValidating && avail && 'opacity-60')}>
                  {roomTypes.map((rt, i) => (
                    <RoomCard
                      key={rt.id}
                      rt={rt}
                      a={byId.get(rt.id)}
                      loading={availLoading}
                      stay={stay}
                      nights={nights}
                      index={i}
                      onSelect={() => book(rt.id)}
                      onRooms={(n) => setStay({ ...stay, rooms: n })}
                      onOtherDates={otherDates}
                    />
                  ))}
                </ul>
              )}
            </section>

            {p && (
              <div className="mt-12 grid gap-8 border-t pt-10 sm:grid-cols-2">
                <section aria-labelledby="location-heading">
                  <h2 id="location-heading" className="text-xl font-semibold tracking-tight">
                    Where you’ll be
                  </h2>
                  <p className="mt-3 flex items-start gap-2.5 text-sm">
                    <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-brand" aria-hidden />
                    <span>
                      {p.address}
                      <br />
                      {p.city}, {p.state} {p.zipCode}
                    </span>
                  </p>
                  <a
                    href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${p.name}, ${p.address}, ${p.city}, ${p.state}`)}`}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 inline-flex min-h-10 items-center rounded-md text-sm font-medium text-brand underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    Open in Maps<span className="sr-only"> (opens in a new tab)</span>
                  </a>
                </section>
                <section aria-labelledby="policies-heading">
                  <h2 id="policies-heading" className="text-xl font-semibold tracking-tight">
                    Good to know
                  </h2>
                  <ul className="mt-3 space-y-2.5 text-sm text-muted-foreground">
                    <li className="flex items-start gap-2.5">
                      <Clock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> Check-in from 3:00 PM · check-out by 11:00 AM
                    </li>
                    <li className="flex items-start gap-2.5">
                      <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> Free changes and cancellation until 3:00 PM the day before you arrive
                    </li>
                    <li className="flex items-start gap-2.5">
                      <Phone className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                      <a href={`tel:${p.phone}`} className="rounded-sm text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                        {p.phone}
                      </a>
                    </li>
                  </ul>
                </section>
              </div>
            )}
          </div>

          {/* Booking summary (desktop) */}
          <aside className="hidden lg:block" aria-label="Your stay">
            {/* data-voice-avoid: the voice launcher folds (or moves up) instead of covering this card. */}
            <div data-voice-avoid className="sticky top-24 space-y-3">
              <div className="rounded-2xl border bg-card p-5 shadow-lifted">
                <div className="min-h-[3.75rem]" aria-live="polite">
                  {cheapest?.quote ? (
                    <>
                      <p className="text-sm text-muted-foreground">
                        From <span className="text-3xl font-semibold text-foreground tabular">{price(Math.round(cheapest.quote.averageNightly))}</span> / night
                      </p>
                      <p className="mt-0.5 text-sm text-muted-foreground tabular">
                        {price(cheapest.quote.total)} total · {plural(nights, 'night')}
                      </p>
                    </>
                  ) : avail ? (
                    <>
                      <p className="text-base font-semibold">Nothing left for these dates</p>
                      <p className="mt-0.5 text-sm text-muted-foreground">Try other dates{rooms === 1 ? ' or more rooms' : ''}.</p>
                    </>
                  ) : (
                    <>
                      <Skeleton className="h-8 w-40" />
                      <Skeleton className="mt-2 h-4 w-32" />
                    </>
                  )}
                </div>
                <div data-stay-search className="mt-4">
                  <StaySearch value={stay} onSubmit={(v) => setStay(v)} showDestination={false} showRooms layout="stacked" submitLabel="Check rooms" pending={isValidating && !!avail} />
                </div>
                {cheapest && (
                  <p className="mt-3 text-center text-sm text-muted-foreground">
                    {plural(bookable.length, 'room type')} available —{' '}
                    <button type="button" onClick={() => scrollTo(roomsRef.current)} className="rounded-sm font-medium text-brand underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      see rooms
                    </button>
                  </p>
                )}
              </div>
              <p className="flex items-center justify-center gap-1.5 px-2 text-center text-xs text-muted-foreground">
                <Lock className="h-3.5 w-3.5" aria-hidden />
                {(p?.isDemo ?? shell?.isDemo) ? 'Demo hotel — nothing is charged' : 'Secure booking · no booking fees'}
              </p>
              {p && voice && dock && (
                <div className="rounded-2xl border bg-card p-4 shadow-xs">
                  <p className="text-sm font-semibold">Questions before you book?</p>
                  <p className="mt-0.5 text-sm text-muted-foreground">Talk to the front desk — an AI voice that knows today’s rooms and prices.</p>
                  {/* Opens the site's one voice dock (the call keeps going as you move to checkout). */}
                  <Button type="button" variant="outline" className="mt-3 h-11 w-full rounded-xl" onClick={dock.start} onPointerEnter={dock.prepare} onFocus={dock.prepare}>
                    <AudioLines className="text-brand" aria-hidden /> Talk to us
                  </Button>
                </div>
              )}
            </div>
          </aside>
        </div>
      </div>
    </GuestShell>
  );
}

/**
 * First paint (and the server HTML, before the search params are read): the
 * hotel's own header and name from the layout, with placeholders sized like
 * the real gallery and booking card, so nothing jumps when the page fills in.
 */
function PropertyFallback() {
  const shell = usePropertyShell();
  return (
    <GuestShell brandColor={shell?.primaryColor} brand={shell ? { name: shell.name, href: `/properties/${shell.id}` } : undefined} mainClassName="pb-12 lg:pb-16">
      <div className="mx-auto max-w-7xl px-4 sm:px-6" role="status" aria-label="Loading the hotel">
        <div className="mt-3 h-10" />
        <Skeleton className="mt-3 w-full rounded-2xl" style={GALLERY_HEIGHT} />
        <div className="mt-8 grid gap-10 lg:grid-cols-[minmax(0,1fr)_380px] xl:gap-14">
          <div className="min-w-0">
            {shell ? (
              <>
                <p className="text-sm text-muted-foreground">
                  {shell.type || 'Hotel'} · {shell.city}, {shell.state}
                </p>
                <h1 className="mt-1 text-balance font-display text-4xl leading-[1.1] tracking-tight sm:text-5xl">{shell.name}</h1>
                {shell.tagline && <p className="mt-2 text-lg text-muted-foreground">{shell.tagline}</p>}
              </>
            ) : (
              <>
                <Skeleton className="h-4 w-48" />
                <Skeleton className="mt-3 h-12 w-2/3" />
              </>
            )}
            <Skeleton className="mt-6 h-40 rounded-2xl sm:h-24" />
          </div>
          <Skeleton className="hidden h-96 rounded-2xl lg:block" />
        </div>
      </div>
    </GuestShell>
  );
}

export default function Page() {
  return (
    <React.Suspense fallback={<PropertyFallback />}>
      <PropertyPage />
    </React.Suspense>
  );
}
