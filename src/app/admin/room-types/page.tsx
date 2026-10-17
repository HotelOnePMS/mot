'use client';

import * as React from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { toast } from 'sonner';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { BedDouble, ChevronRight, EyeOff, Plus, Tag, TriangleAlert, Users } from 'lucide-react';
import { api, fetcher } from '@/lib/fetcher';
import { formatMoney } from '@/lib/format';
import { ROOM_STATUS, formatNumber } from '@/lib/status';
import { parseRoomNumbers } from '@/lib/rooms';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { EmptyState, PageHeader, Skeleton } from '@/components/ui/primitives';
import { SmartImage } from '@/components/ui/smart-image';
import { useConsole, usePropertyUrl } from '@/components/console/ConsoleProvider';

interface RoomTypeRow {
  id: string;
  name: string;
  description: string | null;
  capacity: number;
  basePrice: number | string;
  totalRooms: number;
  amenities: string[];
  isActive: boolean;
  photos: { url: string }[];
  _count: { bookings: number; rooms: number };
}
interface RoomRow {
  id: string;
  roomNumber: string;
  floor: string | null;
  roomTypeId: string;
  status: 'CLEAN' | 'DIRTY' | 'INSPECTED' | 'OUT_OF_ORDER';
  isOutOfOrder: boolean;
}

const FRAME = 'mx-auto w-full max-w-7xl px-4 pb-12 pt-5 sm:px-6 sm:pt-6 lg:px-8 lg:pt-8';

// Same tones as the room status badges elsewhere.
const DOT: Record<RoomRow['status'], string> = {
  CLEAN: 'bg-success',
  INSPECTED: 'bg-info',
  DIRTY: 'bg-warning',
  OUT_OF_ORDER: 'bg-destructive',
};

function Legend() {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-label="Room status colors">
      {(Object.keys(DOT) as RoomRow['status'][]).map((s) => (
        <li key={s} className="inline-flex items-center gap-1.5">
          <span className={cn('size-2 rounded-full', DOT[s])} aria-hidden />
          {ROOM_STATUS[s].label}
        </li>
      ))}
    </ul>
  );
}

function AddRooms({ roomType, propertyId, onDone }: { roomType: RoomTypeRow; propertyId: string; onDone: () => void }) {
  const [open, setOpen] = React.useState(false);
  const [text, setText] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const id = React.useId();
  const parsed = text.trim() ? parseRoomNumbers(text) : null;
  const error = parsed && 'error' in parsed ? parsed.error : null;
  const numbers = parsed && 'numbers' in parsed ? parsed.numbers : [];

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!numbers.length) return;
    setBusy(true);
    try {
      await api('/api/admin/rooms', { method: 'POST', json: { propertyId, roomTypeId: roomType.id, roomNumbers: numbers } });
      toast.success(`Added ${numbers.length} ${roomType.name} room${numbers.length > 1 ? 's' : ''}`);
      setText('');
      setOpen(false);
      onDone();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <Button variant="outline" size="sm" className="border-dashed px-2.5 text-muted-foreground hover:text-foreground" onClick={() => setOpen(true)} aria-label={`Add rooms to ${roomType.name}`}>
        <Plus aria-hidden /> Add rooms
      </Button>
    );
  }
  return (
    <form onSubmit={save} className="mt-2 w-full space-y-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        Room numbers to add to {roomType.name}
      </label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          id={id}
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
          placeholder="e.g. 101-110, 201, 203"
          aria-invalid={error ? true : undefined}
          aria-describedby={`${id}-help`}
          autoComplete="off"
        />
        <div className="flex gap-2">
          <Button type="submit" loading={busy} loadingText="Adding…" disabled={!numbers.length}>
            Add{numbers.length ? ` ${numbers.length}` : ''}
          </Button>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        </div>
      </div>
      <p id={`${id}-help`} className={cn('text-xs', error ? 'font-medium text-destructive' : 'text-muted-foreground')} aria-live="polite">
        {error ?? (numbers.length ? `${numbers.slice(0, 12).join(', ')}${numbers.length > 12 ? ` … +${numbers.length - 12}` : ''} · floors are read from the number` : 'Ranges and lists both work.')}
      </p>
    </form>
  );
}

export default function RoomTypesPage() {
  const { propertyId, property, can } = useConsole();
  const reduce = useReducedMotion();
  const typesUrl = usePropertyUrl('/api/admin/room-types');
  const roomsUrl = usePropertyUrl('/api/admin/rooms');
  const { data: types, isLoading, mutate } = useSWR<RoomTypeRow[]>(typesUrl, fetcher);
  const { data: rooms, mutate: mutateRooms } = useSWR<RoomRow[]>(roomsUrl, fetcher);
  const editable = can('inventory.write');
  const byType = React.useMemo(() => {
    const m = new Map<string, RoomRow[]>();
    for (const r of rooms ?? []) m.set(r.roomTypeId, [...(m.get(r.roomTypeId) ?? []), r]);
    return m;
  }, [rooms]);
  const totalRooms = (types ?? []).filter((t) => t.isActive).reduce((s, t) => s + t.totalRooms, 0);
  // Voice-only hotels keep bookings in their own system: room counts and room numbers don't apply.
  const voiceOnly = property?.setupPath === 'VOICE';

  return (
    <div className={FRAME}>
      <div className="space-y-6">
        <PageHeader
          title="Rooms"
          description={
            types
              ? voiceOnly
                ? `${formatNumber(types.length)} room type${types.length === 1 ? '' : 's'} your voice front desk quotes`
                : `${formatNumber(types.length)} room type${types.length === 1 ? '' : 's'} · ${formatNumber(totalRooms)} sellable room${totalRooms === 1 ? '' : 's'}${property ? ` at ${property.name}` : ''}`
              : 'Loading rooms…'
          }
          actions={
            editable ? (
              <Button asChild>
                <Link href="/admin/room-types/add">
                  <Plus aria-hidden /> Add room type
                </Link>
              </Button>
            ) : undefined
          }
        />

        {isLoading ? (
          <div className="space-y-4" aria-busy>
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-[180px] rounded-2xl" />
            ))}
          </div>
        ) : !types?.length ? (
          <Card>
            <EmptyState
              icon={BedDouble}
              title="No room types yet"
              description="Start with the kinds of rooms you sell — like “Ocean King” or “Family Suite” — then add the room numbers."
              action={
                editable ? (
                  <Button asChild>
                    <Link href="/admin/room-types/add">
                      <Plus aria-hidden /> Add your first room type
                    </Link>
                  </Button>
                ) : undefined
              }
            />
          </Card>
        ) : (
          <>
            {(rooms?.length ?? 0) > 0 && <Legend />}
            <ul className="space-y-4">
              <AnimatePresence initial={false}>
                {types.map((t) => {
                  const list = byType.get(t.id) ?? [];
                  const gap = t.totalRooms - list.length;
                  const photo = t.photos[0]?.url;
                  return (
                    <motion.li key={t.id} layout={!reduce} initial={reduce ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
                      <Card className="overflow-hidden p-0">
                        <div className="flex flex-col sm:flex-row">
                          {photo && (
                            <Link href={`/admin/room-types/${t.id}`} className="relative block shrink-0 sm:w-56" tabIndex={-1} aria-hidden>
                              <SmartImage src={photo} alt="" aspectRatio="16 / 10" sizes="(min-width: 640px) 224px, 100vw" className={cn('w-full sm:h-full', !t.isActive && 'opacity-60')} />
                            </Link>
                          )}
                          <div className="flex min-w-0 flex-1 flex-col p-5">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <h2 className="flex flex-wrap items-center gap-2 text-lg font-semibold tracking-tight">
                                  <Link href={`/admin/room-types/${t.id}`} className="rounded-sm hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                                    {t.name}
                                  </Link>
                                  {!t.isActive && (
                                    <Badge variant="neutral" size="sm" icon={EyeOff}>
                                      Hidden from sale
                                    </Badge>
                                  )}
                                </h2>
                                <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                                  <span className="flex items-center gap-1.5">
                                    <Users className="size-4" aria-hidden /> Sleeps {t.capacity}
                                  </span>
                                  <span className="flex items-center gap-1.5">
                                    <Tag className="size-4" aria-hidden /> {formatMoney(t.basePrice, 'USD', { cents: false })} a night
                                  </span>
                                  {!voiceOnly && (
                                    <span className="flex items-center gap-1.5">
                                      <BedDouble className="size-4" aria-hidden /> {formatNumber(t.totalRooms)} sellable
                                    </span>
                                  )}
                                </div>
                              </div>
                              <Button asChild variant="ghost" size="sm" className="shrink-0">
                                <Link href={`/admin/room-types/${t.id}`} aria-label={`${editable ? 'Edit' : 'View'} ${t.name}`}>
                                  {editable ? 'Edit' : 'View'} <ChevronRight aria-hidden />
                                </Link>
                              </Button>
                            </div>
                            {t.amenities.length > 0 && <p className="mt-2 line-clamp-1 text-sm text-muted-foreground">{t.amenities.join(' · ')}</p>}

                            {!voiceOnly && (
                              <ul className="mt-4 flex flex-wrap items-center gap-1.5" aria-label={`${t.name} room numbers`}>
                                {list.map((r) => {
                                  const s = r.isOutOfOrder ? 'OUT_OF_ORDER' : r.status;
                                  return (
                                    <li key={r.id} className="inline-flex h-8 items-center gap-1.5 rounded-md border bg-surface px-2 text-xs font-medium tabular" title={ROOM_STATUS[s].label}>
                                      <span className={cn('size-2 rounded-full', DOT[s])} aria-hidden />
                                      {r.roomNumber}
                                      <span className="sr-only">, {ROOM_STATUS[s].label.toLowerCase()}</span>
                                    </li>
                                  );
                                })}
                                {can('room.manage') && propertyId && (
                                  <li className="contents">
                                    <AddRooms
                                      roomType={t}
                                      propertyId={propertyId}
                                      onDone={() => {
                                        void mutateRooms();
                                        void mutate();
                                      }}
                                    />
                                  </li>
                                )}
                              </ul>
                            )}
                            {gap > 0 && !voiceOnly && (
                              <p className="mt-3 flex items-start gap-2 rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning-soft-foreground">
                                <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                                {list.length === 0
                                  ? `Add room numbers so guests can be given a room (${formatNumber(t.totalRooms)} to set up).`
                                  : `${formatNumber(gap)} more sellable room${gap > 1 ? 's' : ''} than room numbers — add the rest so every guest can get a key.`}
                              </p>
                            )}
                          </div>
                        </div>
                      </Card>
                    </motion.li>
                  );
                })}
              </AnimatePresence>
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
