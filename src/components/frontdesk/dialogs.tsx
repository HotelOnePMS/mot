'use client';

import * as React from 'react';
import useSWR from 'swr';
import { BedDouble, CheckCircle2, LogOut, MessageSquareText, Moon } from 'lucide-react';
import type { RoomOption } from '@/lib/agent/blocks';
import type { BookingSummary } from '@/lib/dto';
import { fetcher } from '@/lib/fetcher';
import { fmtRange } from '@/lib/format';
import { money } from '@/lib/status';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Callout, Skeleton } from '@/components/ui/primitives';
import { Textarea } from '@/components/ui/textarea';
import { useBookingActions } from './useBookingActions';

type Prefs = { highFloor: boolean; quiet: boolean };

function RoomPicker({
  booking,
  value,
  onChange,
  readyOnly,
}: {
  booking: BookingSummary;
  value: string | null;
  onChange: (id: string, option: RoomOption) => void;
  readyOnly: boolean;
}) {
  const [prefs, setPrefs] = React.useState<Prefs>({ highFloor: false, quiet: false });
  const q = new URLSearchParams();
  if (prefs.highFloor) q.set('highFloor', '1');
  if (prefs.quiet) q.set('tags', 'quiet');
  const { data, isLoading } = useSWR<RoomOption[]>(`/api/admin/bookings/${booking.id}/room?${q}`, fetcher);
  const options = (data ?? []).filter((o) => !readyOnly || o.ready || o.room.id === value);

  // Preselect the best match.
  React.useEffect(() => {
    if (!value && options[0]) onChange(options[0].room.id, options[0]);
  }, [options, value, onChange]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Room preferences">
        <span className="text-xs text-muted-foreground">Prefer</span>
        {(
          [
            ['highFloor', 'High floor'],
            ['quiet', 'Quiet'],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            aria-pressed={prefs[k]}
            onClick={() => setPrefs((p) => ({ ...p, [k]: !p[k] }))}
            className={cn(
              'inline-flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-popover',
              prefs[k]
                ? 'border-primary/50 bg-primary-soft text-primary-soft-foreground'
                : 'border-border-strong/50 bg-surface text-muted-foreground hover:border-border-strong hover:text-foreground'
            )}
          >
            {prefs[k] && <CheckCircle2 className="size-3.5" aria-hidden />}
            {label}
          </button>
        ))}
      </div>
      {isLoading ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" role="status">
          <span className="sr-only">Finding free rooms…</span>
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-[66px] rounded-xl" />
          ))}
        </div>
      ) : options.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border-strong/50 p-4 text-center text-sm text-muted-foreground">
          No {readyOnly ? 'ready ' : ''}
          {booking.roomType.name} room is free for these nights.
          {readyOnly ? ' Tick “Show rooms that still need cleaning” to see the rest.' : ''}
        </p>
      ) : (
        <div className="grid max-h-64 grid-cols-2 gap-2 overflow-y-auto p-0.5 pr-1 sm:grid-cols-3" role="radiogroup" aria-label="Room">
          {options.map((o, i) => {
            const checked = value === o.room.id;
            return (
              <button
                key={o.room.id}
                type="button"
                role="radio"
                aria-checked={checked}
                onClick={() => onChange(o.room.id, o)}
                className={cn(
                  'relative min-h-[66px] rounded-xl border p-2.5 text-left transition-[border-color,background-color,box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-popover',
                  checked ? 'border-primary bg-primary-soft ring-1 ring-primary' : 'border-border-strong/40 hover:border-border-strong',
                  !o.ready && !checked && 'border-dashed'
                )}
              >
                <span className="flex items-center justify-between gap-1">
                  <span className="font-semibold tabular">{o.room.number}</span>
                  {i === 0 && (
                    <Badge variant="highlight" size="sm">
                      Best match
                    </Badge>
                  )}
                </span>
                <span className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                  {o.room.floor ? `Floor ${o.room.floor}` : 'No floor'} · {o.ready ? (o.room.status === 'INSPECTED' ? 'Inspected' : 'Clean') : 'Needs cleaning'}
                  {o.room.tags.includes('quiet') && (
                    <>
                      <Moon className="ml-auto size-3 shrink-0" aria-hidden />
                      <span className="sr-only">, quiet</span>
                    </>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function CheckInDialog({ booking, open, onOpenChange }: { booking: BookingSummary | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { transition, pending } = useBookingActions();
  const [roomId, setRoomId] = React.useState<string | null>(null);
  const [option, setOption] = React.useState<RoomOption | null>(null);
  const [showAll, setShowAll] = React.useState(false);
  React.useEffect(() => {
    if (open) {
      setRoomId(booking?.room?.id ?? null);
      setOption(null);
      setShowAll(false);
    }
  }, [open, booking]);
  if (!booking) return null;
  const onChange = (id: string, o: RoomOption) => {
    setRoomId(id);
    setOption(o);
  };
  const dirty = option ? !option.ready : false;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Check in {booking.guest.name}</DialogTitle>
          <DialogDescription>
            {booking.roomType.name} · {fmtRange(booking.checkIn, booking.checkOut)} · {booking.nights} night{booking.nights === 1 ? '' : 's'} · {booking.guests} guest
            {booking.guests === 1 ? '' : 's'}
          </DialogDescription>
        </DialogHeader>
        {booking.notes && (
          <p className="flex items-start gap-2 rounded-xl bg-muted px-3 py-2 text-sm">
            <MessageSquareText className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span>
              <span className="sr-only">Latest note: </span>
              {booking.notes.split('\n').slice(-1)[0]?.replace(/^\[[^\]]+\]\s*/, '')}
            </span>
          </p>
        )}
        <RoomPicker booking={booking} value={roomId} onChange={onChange} readyOnly={!showAll} />
        <label className="flex min-h-10 cursor-pointer items-center gap-2.5 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={showAll}
            onChange={(e) => setShowAll(e.target.checked)}
            className="size-4 shrink-0 cursor-pointer rounded-sm border-input accent-[hsl(var(--primary))]"
          />
          Show rooms that still need cleaning
        </label>
        {dirty && (
          <Callout tone="warning" role="status">
            Room {option?.room.number} hasn’t been cleaned yet. The guest will be checked into it anyway.
          </Callout>
        )}
        {booking.paymentStatus === 'AWAITING_PAYMENT' && (
          <Callout tone="warning">Online payment didn’t complete — collect {money(booking.totalPrice)} at the desk.</Callout>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!roomId}
            loading={pending === `${booking.id}:CHECKED_IN`}
            loadingText="Checking in…"
            onClick={async () => {
              const r = await transition(booking, 'CHECKED_IN', { roomId: roomId!, allowDirtyRoom: dirty });
              if (r) onOpenChange(false);
            }}
          >
            <CheckCircle2 aria-hidden /> Check in{option ? ` to room ${option.room.number}` : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AssignRoomDialog({ booking, open, onOpenChange }: { booking: BookingSummary | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { assignRoom, pending } = useBookingActions();
  const [roomId, setRoomId] = React.useState<string | null>(null);
  const [option, setOption] = React.useState<RoomOption | null>(null);
  React.useEffect(() => {
    if (open) {
      setRoomId(null);
      setOption(null);
    }
  }, [open]);
  if (!booking) return null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{booking.room ? `Move ${booking.guest.name}` : `Choose a room for ${booking.guest.name}`}</DialogTitle>
          <DialogDescription>
            {booking.roomType.name} · {fmtRange(booking.checkIn, booking.checkOut)}
            {booking.room ? ` · currently Room ${booking.room.number}` : ''}
          </DialogDescription>
        </DialogHeader>
        <RoomPicker
          booking={booking}
          value={roomId}
          onChange={(id, o) => {
            setRoomId(id);
            setOption(o);
          }}
          readyOnly={false}
        />
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!roomId || roomId === booking.room?.id}
            loading={pending === `${booking.id}:room`}
            loadingText="Assigning…"
            onClick={async () => {
              const r = await assignRoom(booking, roomId!);
              if (r) onOpenChange(false);
            }}
          >
            <BedDouble aria-hidden /> Assign{option ? ` room ${option.room.number}` : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function CheckOutDialog({ booking, open, onOpenChange, today }: { booking: BookingSummary | null; open: boolean; onOpenChange: (o: boolean) => void; today: string }) {
  const { transition, pending } = useBookingActions();
  if (!booking) return null;
  const early = booking.checkOut > today;
  const unpaid = booking.paymentStatus !== 'PAID';
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Check out {booking.guest.name}?</DialogTitle>
          <DialogDescription>
            {booking.room ? `Room ${booking.room.number} will be marked dirty and added to the housekeeping queue.` : 'This stay will be closed.'}
          </DialogDescription>
        </DialogHeader>
        {(early || unpaid) && (
          <div className="space-y-2">
            {early && <Callout tone="info">Early departure — the unused nights go back on sale.</Callout>}
            {unpaid && <Callout tone="warning">Balance of {money(booking.totalPrice)} to settle before the guest leaves.</Callout>}
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Not yet
          </Button>
          <Button
            loading={pending === `${booking.id}:CHECKED_OUT`}
            loadingText="Checking out…"
            onClick={async () => {
              const r = await transition(booking, 'CHECKED_OUT');
              if (r) onOpenChange(false);
            }}
          >
            <LogOut aria-hidden /> Check out
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function NoteDialog({ booking, open, onOpenChange }: { booking: BookingSummary | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { addNote, pending } = useBookingActions();
  const [note, setNote] = React.useState('');
  React.useEffect(() => {
    if (open) setNote('');
  }, [open]);
  if (!booking) return null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Note for {booking.guest.name}</DialogTitle>
          <DialogDescription>Visible to the whole team on this reservation, stamped with your name.</DialogDescription>
        </DialogHeader>
        <Field label="Note" htmlFor="booking-note" hint={`${note.length}/1000 characters`}>
          <Textarea id="booking-note" autoFocus value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Celebrating an anniversary — leave a card in the room" maxLength={1000} />
        </Field>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!note.trim()}
            loading={pending === `${booking.id}:note`}
            loadingText="Saving…"
            onClick={async () => {
              const r = await addNote(booking, note);
              if (r) onOpenChange(false);
            }}
          >
            Save note
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel = 'Keep it',
  destructive,
  loading,
  onConfirm,
  children,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description?: React.ReactNode;
  confirmLabel: string;
  /** The button that closes without doing anything (default "Keep it", which suits cancellations and deletions). */
  cancelLabel?: string;
  destructive?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  children?: React.ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        {children}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {cancelLabel}
          </Button>
          <Button variant={destructive ? 'destructive' : 'default'} loading={loading} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
