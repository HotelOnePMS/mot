'use client';

import * as React from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { toast } from 'sonner';
import { CheckCircle2, MoonStar } from 'lucide-react';
import type { BookingSummary } from '@/lib/dto';
import { api, fetcher } from '@/lib/fetcher';
import { fmtDay } from '@/lib/format';
import { formatNumber, money } from '@/lib/status';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Callout, Skeleton } from '@/components/ui/primitives';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useConsole, usePropertyUrl } from '@/components/console/ConsoleProvider';

interface Numbers {
  roomsSold: number;
  totalRooms: number;
  occupancyPct: number;
  roomRevenue: number;
  adr: number;
  arrivals: number;
  departures: number;
}

interface Rooms {
  total: number;
  occupied: number;
  dirty: number;
  outOfOrder: number;
  ready: number;
}

interface AuditRecord {
  id: string;
  businessDate: string;
  closedAt: string;
  closedBy: string;
  notes: string | null;
  summary: {
    numbers: Numbers;
    rooms: Rooms;
    noShowsMarked: { code: string; guest: string }[];
    stillOpen: { overdueDepartures: number; unpaidInHouse: number; arrivalsLeft: number; openRequests: number };
    roomsFlaggedForCleaning: number;
    currency: string;
  };
}

interface Preview {
  propertyId: string;
  businessDate: string;
  today: string;
  currency: string;
  closed: AuditRecord | null;
  noShows: BookingSummary[];
  overdueDepartures: BookingSummary[];
  unpaidInHouse: BookingSummary[];
  rooms: Rooms;
  numbers: Numbers;
  openRequests: number;
  history: AuditRecord[];
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border px-3 py-2.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-lg font-semibold tabular">{value}</p>
    </div>
  );
}

function Step({ n, title, count, children }: { n: number; title: string; count?: number; children: React.ReactNode }) {
  const id = React.useId();
  return (
    <section aria-labelledby={id} className="space-y-3 border-t pt-5">
      <h3 id={id} className="flex items-center gap-2 text-sm font-semibold">
        <span className="flex size-6 items-center justify-center rounded-full bg-muted text-xs tabular">{n}</span>
        {title}
        {count !== undefined && (
          <Badge variant={count ? 'warning' : 'success'} size="sm">
            {count ? formatNumber(count) : 'None'}
          </Badge>
        )}
      </h3>
      {children}
    </section>
  );
}

function Report({ record, currency }: { record: AuditRecord; currency: string }) {
  const s = record.summary;
  return (
    <div className="space-y-4">
      <Callout tone="success" icon={CheckCircle2}>
        {fmtDay(record.businessDate, 'long')} was closed by {record.closedBy} at{' '}
        {new Date(record.closedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}.
      </Callout>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Occupancy" value={`${s.numbers.occupancyPct}%`} />
        <Stat label="Rooms sold" value={`${formatNumber(s.numbers.roomsSold)} / ${formatNumber(s.numbers.totalRooms)}`} />
        <Stat label="Room revenue" value={money(s.numbers.roomRevenue, { cents: false, currency: s.currency ?? currency })} />
        <Stat label="ADR" value={money(s.numbers.adr, { cents: false, currency: s.currency ?? currency })} />
      </div>
      <ul className="space-y-1 text-sm">
        <li>
          No-shows marked: {s.noShowsMarked.length ? s.noShowsMarked.map((b) => `${b.guest} (${b.code})`).join(', ') : 'none'}
        </li>
        {s.roomsFlaggedForCleaning > 0 && <li>Rooms flagged for stayover cleaning: {s.roomsFlaggedForCleaning}</li>}
        <li>
          Left open: {s.stillOpen.overdueDepartures} overdue departure{s.stillOpen.overdueDepartures === 1 ? '' : 's'}, {s.stillOpen.unpaidInHouse} unpaid in house,{' '}
          {s.stillOpen.openRequests} guest message{s.stillOpen.openRequests === 1 ? '' : 's'}
        </li>
        {record.notes && <li className="whitespace-pre-line">Notes: {record.notes}</li>}
      </ul>
    </div>
  );
}

/**
 * Night audit: close the business day. Works through what's still open —
 * arrivals who never came, guests past check-out, unpaid balances, rooms —
 * then marks the no-shows and saves the day's report.
 */
export function NightAuditSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { propertyId, today, currency, refresh } = useConsole();
  const [date, setDate] = React.useState('');
  const url = usePropertyUrl('/api/admin/night-audit', { date: date || undefined });
  const { data, error, isLoading, mutate } = useSWR<Preview>(open ? url : null, fetcher);
  const [noShows, setNoShows] = React.useState<string[]>([]);
  const [flagRooms, setFlagRooms] = React.useState(true);
  const [notes, setNotes] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setDate('');
      setNotes('');
      setFlagRooms(true);
    }
  }, [open]);
  // Everyone still due is a no-show unless the desk says otherwise.
  React.useEffect(() => setNoShows(data?.noShows.map((b) => b.id) ?? []), [data]);

  const cur = data?.currency ?? currency;

  async function close() {
    if (!data || !propertyId) return;
    setBusy(true);
    try {
      await api('/api/admin/night-audit', {
        method: 'POST',
        json: { propertyId, businessDate: data.businessDate, noShowBookingIds: noShows, flagOccupiedRooms: flagRooms, notes: notes.trim() || null },
      });
      toast.success(`${fmtDay(data.businessDate, 'weekday')} is closed`);
      refresh();
      await mutate();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <MoonStar className="size-5 text-muted-foreground" aria-hidden /> Night audit
          </SheetTitle>
          <SheetDescription>Close the business day: resolve what’s still open, then save the day’s report.</SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-5 px-1 pb-6">
          <Field label="Business day" htmlFor="audit-date" className="max-w-[12rem]">
            <Input id="audit-date" type="date" max={today} value={date || data?.businessDate || today} onChange={(e) => setDate(e.target.value)} />
          </Field>

          {error ? (
            <Callout tone="danger">{(error as Error).message}</Callout>
          ) : isLoading || !data ? (
            <div className="space-y-3" aria-hidden>
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-32 w-full" />
            </div>
          ) : data.closed ? (
            <Report record={data.closed} currency={cur} />
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Stat label="Occupancy" value={`${data.numbers.occupancyPct}%`} />
                <Stat label="Rooms sold" value={`${formatNumber(data.numbers.roomsSold)} / ${formatNumber(data.numbers.totalRooms)}`} />
                <Stat label="Room revenue" value={money(data.numbers.roomRevenue, { cents: false, currency: cur })} />
                <Stat label="ADR" value={money(data.numbers.adr, { cents: false, currency: cur })} />
              </div>
              <p className="text-xs text-muted-foreground">
                {formatNumber(data.numbers.arrivals)} checked in and {formatNumber(data.numbers.departures)} checked out on {fmtDay(data.businessDate, 'weekday')}. Revenue
                is room revenue before taxes and fees.
              </p>

              <Step n={1} title="Arrivals who didn’t come" count={data.noShows.length}>
                {data.noShows.length > 0 && (
                  <>
                    <p className="text-sm text-muted-foreground">Ticked reservations become no-shows and their rooms go back on sale. Untick anyone still on their way.</p>
                    <ul className="divide-y rounded-xl border">
                      {data.noShows.map((b) => (
                        <li key={b.id}>
                          <label className="flex min-h-12 cursor-pointer items-center gap-3 px-3 py-2 text-sm">
                            <input
                              type="checkbox"
                              className="size-4 accent-[hsl(var(--primary))]"
                              checked={noShows.includes(b.id)}
                              onChange={(e) => setNoShows(e.target.checked ? [...noShows, b.id] : noShows.filter((x) => x !== b.id))}
                            />
                            <span className="min-w-0 flex-1">
                              <span className="font-medium">{b.guest.name}</span>{' '}
                              <span className="text-muted-foreground">
                                · {b.code} · {b.roomType.name} · due {fmtDay(b.checkIn, 'weekday')}
                              </span>
                            </span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </Step>

              <Step n={2} title="Past check-out, still in house" count={data.overdueDepartures.length}>
                {data.overdueDepartures.length > 0 && (
                  <ul className="space-y-1 text-sm">
                    {data.overdueDepartures.map((b) => (
                      <li key={b.id}>
                        <Link href={`/admin/bookings/${b.id}`} className="font-medium text-primary underline-offset-4 hover:underline">
                          {b.guest.name}
                        </Link>{' '}
                        <span className="text-muted-foreground">
                          · room {b.room?.number ?? 'not assigned'} · due out {fmtDay(b.checkOut, 'weekday')}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Step>

              <Step n={3} title="Balances not settled (in house)" count={data.unpaidInHouse.length}>
                {data.unpaidInHouse.length > 0 && (
                  <ul className="space-y-1 text-sm">
                    {data.unpaidInHouse.map((b) => (
                      <li key={b.id} className="flex justify-between gap-3">
                        <span>
                          {b.guest.name} <span className="text-muted-foreground">· room {b.room?.number ?? 'not assigned'}</span>
                        </span>
                        <span className="tabular">{money(b.checkOutDue, { currency: b.currency })}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Step>

              <Step n={4} title="Rooms">
                <p className="text-sm text-muted-foreground">
                  {formatNumber(data.rooms.occupied)} occupied · {formatNumber(data.rooms.ready)} ready · {formatNumber(data.rooms.dirty)} dirty · {formatNumber(data.rooms.outOfOrder)} out of
                  order
                </p>
                <label className="flex items-center gap-3 text-sm">
                  <Switch checked={flagRooms} onCheckedChange={setFlagRooms} aria-label="Flag occupied rooms for stayover cleaning" />
                  Flag occupied rooms for stayover cleaning tomorrow
                </label>
              </Step>

              <Step n={5} title="Guest messages waiting" count={data.openRequests}>
                {data.openRequests > 0 && (
                  <Link href="/admin/voice" className="text-sm font-medium text-primary underline-offset-4 hover:underline">
                    Open messages
                  </Link>
                )}
              </Step>

              <Field label="Notes for the morning shift" htmlFor="audit-notes" optional>
                <Textarea id="audit-notes" rows={3} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} />
              </Field>

              <Button className="w-full" size="lg" loading={busy} onClick={close}>
                Close {fmtDay(data.businessDate, 'weekday')}
                {noShows.length ? ` · ${noShows.length} no-show${noShows.length === 1 ? '' : 's'}` : ''}
              </Button>
            </>
          )}

          {data && data.history.filter((h) => h.businessDate !== data.businessDate).length > 0 && (
            <section aria-labelledby="audit-history" className="space-y-2 border-t pt-5">
              <h3 id="audit-history" className="text-sm font-semibold">
                Recently closed
              </h3>
              <ul className="space-y-1 text-sm">
                {data.history
                  .filter((h) => h.businessDate !== data.businessDate)
                  .map((h) => (
                    <li key={h.id}>
                      <button type="button" className="text-primary underline-offset-4 hover:underline" onClick={() => setDate(h.businessDate)}>
                        {fmtDay(h.businessDate, 'weekday')}
                      </button>{' '}
                      <span className="text-muted-foreground">
                        · {h.summary.numbers.occupancyPct}% · {h.summary.noShowsMarked.length} no-show{h.summary.noShowsMarked.length === 1 ? '' : 's'} · {h.closedBy}
                      </span>
                    </li>
                  ))}
              </ul>
            </section>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
