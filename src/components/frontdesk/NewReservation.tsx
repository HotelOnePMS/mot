'use client';

import * as React from 'react';
import useSWR from 'swr';
import { toast } from 'sonner';
import { BedDouble, Users } from 'lucide-react';
import type { BookingSummary, StayQuote } from '@/lib/dto';
import { api, fetcher } from '@/lib/fetcher';
import { fmtDay } from '@/lib/format';
import { money } from '@/lib/status';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Callout, Skeleton } from '@/components/ui/primitives';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useConsole, usePropertyUrl } from '@/components/console/ConsoleProvider';

interface RoomTypeOption {
  id: string;
  name: string;
  capacity: number;
  available: number;
  quote: StayQuote | null;
}

const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

const blankGuest = { firstName: '', lastName: '', email: '', phone: '' };

/**
 * New reservation at the desk: a walk-in or a phone booking. Live
 * availability and the hotel's exact price (taxes and fees included), then
 * the guest's details. Guests arriving now can be checked straight in.
 */
export function NewReservationDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated?: (b: BookingSummary) => void }) {
  const { propertyId, today, currency, refresh } = useConsole();
  const [checkIn, setCheckIn] = React.useState('');
  const [nights, setNights] = React.useState(1);
  const [guests, setGuests] = React.useState(2);
  const [rooms, setRooms] = React.useState(1);
  const [roomTypeId, setRoomTypeId] = React.useState<string | null>(null);
  const [guest, setGuest] = React.useState(blankGuest);
  const [notes, setNotes] = React.useState('');
  const [paid, setPaid] = React.useState(false);
  const [checkInNow, setCheckInNow] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const formId = React.useId();

  React.useEffect(() => {
    if (open) {
      setCheckIn(today);
      setNights(1);
      setGuests(2);
      setRooms(1);
      setRoomTypeId(null);
      setGuest(blankGuest);
      setNotes('');
      setPaid(false);
      setCheckInNow(false);
      setErrors({});
    }
  }, [open, today]);

  const checkOut = checkIn ? addDays(checkIn, Math.max(1, nights)) : '';
  const url = usePropertyUrl('/api/admin/reservations', { checkIn, checkOut, guests, rooms });
  const { data: options, error, isLoading } = useSWR<RoomTypeOption[]>(open && checkIn && nights >= 1 ? url : null, fetcher);
  const arrivingToday = checkIn === today;
  const picked = options?.find((o) => o.id === roomTypeId) ?? null;
  const fits = (o: RoomTypeOption) => o.capacity * rooms >= guests && o.available >= rooms && !!o.quote;

  React.useEffect(() => {
    // Keep a valid choice as the stay changes: the cheapest room type that fits.
    if (!options) return;
    if (picked && fits(picked)) return;
    setRoomTypeId(options.filter(fits).sort((a, b) => (a.quote?.total ?? 0) - (b.quote?.total ?? 0))[0]?.id ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options, guests, rooms]);

  React.useEffect(() => {
    if (!arrivingToday) setCheckInNow(false);
  }, [arrivingToday]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (!guest.firstName.trim()) next.firstName = 'Enter the guest’s first name.';
    if (!guest.lastName.trim()) next.lastName = 'Enter the guest’s last name.';
    if (guest.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(guest.email.trim())) next.email = 'Enter an email like name@example.com, or leave it empty.';
    if (!roomTypeId) next.roomType = 'Choose a room type that’s free for these dates.';
    setErrors(next);
    if (Object.keys(next).length || !propertyId || !roomTypeId) return;
    setBusy(true);
    try {
      const booking = await api<BookingSummary>('/api/admin/reservations', {
        method: 'POST',
        json: { propertyId, roomTypeId, checkIn, checkOut, guests, rooms, guest, notes: notes.trim() || null, paid, checkInNow },
      });
      toast.success(
        checkInNow && booking.room
          ? `${booking.guest.name} is checked in to room ${booking.room.number} (${booking.code})`
          : `Reservation ${booking.code} for ${booking.guest.name} is confirmed`,
      );
      refresh();
      onCreated?.(booking);
      onOpenChange(false);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>New reservation</DialogTitle>
          <DialogDescription>A walk-in or a phone booking. It’s confirmed straight away at the hotel’s current price.</DialogDescription>
        </DialogHeader>
        <form id={formId} onSubmit={submit} className="space-y-5" noValidate>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Field label="Check-in" htmlFor={`${formId}-in`}>
              <Input id={`${formId}-in`} type="date" min={today} value={checkIn} onChange={(e) => setCheckIn(e.target.value)} />
            </Field>
            <Field label="Nights" htmlFor={`${formId}-nights`}>
              <Input id={`${formId}-nights`} type="number" min={1} max={30} value={nights} onChange={(e) => setNights(Math.min(30, Math.max(1, Number(e.target.value) || 1)))} />
            </Field>
            <Field label="Guests" htmlFor={`${formId}-guests`}>
              <Input id={`${formId}-guests`} type="number" min={1} max={40} value={guests} onChange={(e) => setGuests(Math.min(40, Math.max(1, Number(e.target.value) || 1)))} />
            </Field>
            <Field label="Rooms" htmlFor={`${formId}-rooms`}>
              <Input id={`${formId}-rooms`} type="number" min={1} max={9} value={rooms} onChange={(e) => setRooms(Math.min(9, Math.max(1, Number(e.target.value) || 1)))} />
            </Field>
          </div>
          {checkIn && <p className="-mt-2 text-xs text-muted-foreground">Check-out {fmtDay(checkOut, 'weekday')}</p>}

          <fieldset>
            <legend className="text-sm font-medium">Room type</legend>
            {error ? (
              <Callout tone="danger" className="mt-2">
                {(error as Error).message}
              </Callout>
            ) : isLoading || !options ? (
              <div className="mt-2 grid gap-2 sm:grid-cols-2" aria-hidden>
                <Skeleton className="h-[72px] rounded-xl" />
                <Skeleton className="h-[72px] rounded-xl" />
              </div>
            ) : (
              <div className="mt-2 grid max-h-64 gap-2 overflow-y-auto p-0.5 sm:grid-cols-2" role="radiogroup" aria-label="Room type">
                {options.map((o) => {
                  const ok = fits(o);
                  const checked = o.id === roomTypeId;
                  return (
                    <button
                      key={o.id}
                      type="button"
                      role="radio"
                      aria-checked={checked}
                      disabled={!ok}
                      onClick={() => setRoomTypeId(o.id)}
                      className={cn(
                        'rounded-xl border p-3 text-left transition-[border-color,background-color] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-popover disabled:cursor-not-allowed disabled:opacity-55',
                        checked ? 'border-primary bg-primary-soft ring-1 ring-primary' : 'border-border-strong/40 hover:border-border-strong'
                      )}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="font-medium">{o.name}</span>
                        {o.quote && <span className="font-semibold tabular">{money(o.quote.total, { currency: o.quote.currency })}</span>}
                      </span>
                      <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        <span className="inline-flex items-center gap-1">
                          <Users className="size-3" aria-hidden /> Sleeps {o.capacity}
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <BedDouble className="size-3" aria-hidden /> {o.available} free
                        </span>
                        {o.capacity * rooms < guests && <Badge variant="neutral" size="sm">Too small</Badge>}
                        {o.available < rooms && <Badge variant="neutral" size="sm">Sold out</Badge>}
                      </span>
                    </button>
                  );
                })}
                {options.length === 0 && <p className="text-sm text-muted-foreground">This hotel has no active room types yet.</p>}
              </div>
            )}
            {errors.roomType && <p className="mt-2 text-xs font-medium text-destructive">{errors.roomType}</p>}
            {picked?.quote && picked.quote.charges.length > 0 && (
              <p className="mt-2 text-xs text-muted-foreground">
                {money(picked.quote.subtotal, { currency })} for the room plus {picked.quote.charges.map((c) => `${c.name} ${money(c.amount, { currency })}`).join(', ')}.
              </p>
            )}
          </fieldset>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="First name" htmlFor={`${formId}-first`} error={errors.firstName}>
              <Input id={`${formId}-first`} autoComplete="off" value={guest.firstName} onChange={(e) => setGuest({ ...guest, firstName: e.target.value })} />
            </Field>
            <Field label="Last name" htmlFor={`${formId}-last`} error={errors.lastName}>
              <Input id={`${formId}-last`} autoComplete="off" value={guest.lastName} onChange={(e) => setGuest({ ...guest, lastName: e.target.value })} />
            </Field>
            <Field label="Email" htmlFor={`${formId}-email`} optional error={errors.email} hint="We send the confirmation here.">
              <Input id={`${formId}-email`} type="email" autoComplete="off" value={guest.email} onChange={(e) => setGuest({ ...guest, email: e.target.value })} />
            </Field>
            <Field label="Phone" htmlFor={`${formId}-phone`} optional>
              <Input id={`${formId}-phone`} type="tel" autoComplete="off" value={guest.phone} onChange={(e) => setGuest({ ...guest, phone: e.target.value })} />
            </Field>
          </div>
          <Field label="Notes" htmlFor={`${formId}-notes`} optional>
            <Textarea id={`${formId}-notes`} rows={2} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Late arrival, cot, anniversary…" />
          </Field>

          <div className="flex flex-col gap-3 rounded-xl border p-3 sm:flex-row sm:flex-wrap sm:gap-6">
            <label className="flex items-center gap-3 text-sm">
              <Switch checked={paid} onCheckedChange={setPaid} aria-label="Paid in full at the desk" />
              Paid in full at the desk
            </label>
            <label className={cn('flex items-center gap-3 text-sm', !arrivingToday && 'opacity-60')}>
              <Switch checked={checkInNow} disabled={!arrivingToday} onCheckedChange={setCheckInNow} aria-label="Check in now" />
              Check in now {arrivingToday ? '(best ready room)' : '(arrivals today only)'}
            </label>
          </div>
        </form>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form={formId} loading={busy} disabled={!roomTypeId}>
            {checkInNow ? 'Book and check in' : 'Confirm reservation'}
            {picked?.quote ? ` · ${money(picked.quote.total, { currency: picked.quote.currency })}` : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
