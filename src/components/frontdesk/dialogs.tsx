'use client';

import * as React from 'react';
import useSWR from 'swr';
import { BedDouble, LogOut } from 'lucide-react';
import type { RoomOption } from '@/lib/agent/blocks';
import { CARD_NUMBER_REFUSED, containsCardNumber } from '@/lib/desk-payments';
import type { BookingSummary } from '@/lib/dto';
import { fetcher } from '@/lib/fetcher';
import { fmtRange } from '@/lib/format';
import { money } from '@/lib/status';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field } from '@/components/ui/label';
import { Callout } from '@/components/ui/primitives';
import { Textarea } from '@/components/ui/textarea';
import { useConsole } from '@/components/console/ConsoleProvider';
import { CollectPaymentDialog, useDeskPayments } from '@/components/payments/DeskPayments';
import { RoomPicker } from './RoomPicker';
import { useBookingActions } from './useBookingActions';

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

/** Quick picks that fill in a reason box; one is pressed while it's what the box says. */
export function QuickReasons({ label, options, value, onPick }: { label: string; options: readonly string[]; value: string; onPick: (reason: string) => void }) {
  const current = value.replace(/\s+/g, ' ').trim();
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o}
          type="button"
          aria-pressed={current === o}
          onClick={() => onPick(o)}
          className={cn(
            'inline-flex min-h-9 items-center rounded-full border px-3.5 py-1 text-left text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
            current === o ? 'border-primary/50 bg-primary-soft text-primary-soft-foreground' : 'border-border-strong/50 bg-surface text-muted-foreground hover:border-border-strong hover:text-foreground'
          )}
        >
          {o}
        </button>
      ))}
    </div>
  );
}

const OWING_REASONS = ['Billed to company', 'Guest pays later', 'Disputed charges'];

/**
 * Check-out needs the balance at zero: the guest pays (or the payment is recorded) first. A manager
 * (booking.checkoutWithBalance) can check the guest out with it owing instead, saying why; it stays collectable.
 */
export function CheckOutDialog({ booking: given, open, onOpenChange, today }: { booking: BookingSummary | null; open: boolean; onOpenChange: (o: boolean) => void; today: string }) {
  const { transition, pending } = useBookingActions();
  const { can } = useConsole();
  const { data: desk } = useDeskPayments(open ? given?.id : null);
  // The booking as it is now: a payment taken from this dialog refreshes it (screens may pass a copy from when it opened).
  const { data: live } = useSWR<{ booking: BookingSummary }>(open && given ? `/api/admin/bookings/${given.id}` : null, fetcher);
  const [collecting, setCollecting] = React.useState(false);
  const [owingOk, setOwingOk] = React.useState(false);
  const [reason, setReason] = React.useState('');
  React.useEffect(() => {
    if (open) {
      setOwingOk(false);
      setReason('');
    }
  }, [open]);
  if (!given) return null;
  const booking = live?.booking.id === given.id ? live.booking : given;
  const early = booking.checkOut > today;
  // The same figure the server checks: room and extras less allowances and everything paid, online or at the desk (the
  // reservation's, for a room type of a shared reservation).
  const due = booking.checkOutDue;
  const unpaid = due > 0.004;
  const canCollect = can('payments.collect');
  const canOwe = can('booking.checkoutWithBalance');
  const owed = money(due, { currency: booking.currency });
  // Checking out with the balance owing: a manager ticked it and says why (no card numbers, as the server refuses them).
  const owing = unpaid && canOwe && owingOk;
  const why = reason.replace(/\s+/g, ' ').trim();
  const cardNumber = containsCardNumber(why);
  const whyOk = why.length >= 3 && !cardNumber;
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
            {unpaid && (
              <Callout
                tone="warning"
                role="status"
                action={
                  canCollect ? (
                    <Button size="sm" variant="outline" onClick={() => setCollecting(true)}>
                      Take payment
                    </Button>
                  ) : undefined
                }
              >
                <p className="font-semibold">
                  Balance of {owed} to pay{booking.reservationCode && due > booking.balance + 0.004 ? ` on reservation ${booking.reservationCode}` : ''}
                </p>
                <p>{canCollect ? 'Take the payment, or record one taken another way, before the guest checks out.' : 'Ask someone who can take payments to settle it before the guest checks out.'}</p>
                {!canOwe && <p>A manager can check the guest out with the balance owing, for example when it’s billed to a company.</p>}
              </Callout>
            )}
          </div>
        )}
        {unpaid && canOwe && (
          <div className="rounded-xl border p-3">
            <label htmlFor="checkout-owing" className="flex min-h-10 cursor-pointer items-start gap-3 text-sm">
              <input
                id="checkout-owing"
                type="checkbox"
                checked={owingOk}
                onChange={(e) => setOwingOk(e.target.checked)}
                className="mt-0.5 size-4 shrink-0 cursor-pointer rounded-sm border-input accent-[hsl(var(--primary))]"
              />
              <span className="min-w-0">
                <span className="block font-medium">Check out with the balance owing</span>
                <span className="block text-xs text-muted-foreground">The {owed} stays on the reservation to collect later. What was owed and why are kept with your name.</span>
              </span>
            </label>
            {owingOk && (
              <Field
                label="Why"
                required
                htmlFor="checkout-owing-reason"
                hint="At least 3 characters. The guest doesn’t see it."
                error={cardNumber ? CARD_NUMBER_REFUSED : undefined}
                className="mt-3"
              >
                <QuickReasons label="Common reasons" options={OWING_REASONS} value={reason} onPick={setReason} />
                <Textarea
                  id="checkout-owing-reason"
                  required
                  value={reason}
                  maxLength={200}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="e.g. Billed to Acme Corp, invoice to follow"
                />
              </Field>
            )}
          </div>
        )}
        {desk && desk.deposit.held > 0.004 && (
          <Callout tone="info">
            {money(desk.deposit.held, { currency: booking.currency })} security deposit still held. Return it, or keep part of it for incidentals (minibar, damage), from the{' '}
            <a href={`/admin/bookings/${booking.id}`} className="font-medium underline underline-offset-2">
              reservation page
            </a>
            . Deposit money doesn’t pay the room balance.
          </Callout>
        )}
        <CollectPaymentDialog booking={booking} kind="PAYMENT" open={collecting} onOpenChange={setCollecting} />
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Not yet
          </Button>
          <Button
            disabled={unpaid && !(owing && whyOk)}
            loading={pending === `${booking.id}:CHECKED_OUT`}
            loadingText="Checking out…"
            onClick={async () => {
              const r = await transition(booking, 'CHECKED_OUT', owing ? { balanceOverride: { reason: why } } : {});
              if (r) onOpenChange(false);
            }}
          >
            <LogOut aria-hidden /> {owing ? `Check out with ${owed} owing` : 'Check out'}
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
  // Opened from code (no DialogTrigger), so remember what had focus and give it back on close.
  const opener = React.useRef<HTMLElement | null>(null);
  React.useLayoutEffect(() => {
    if (open && document.activeElement instanceof HTMLElement && document.activeElement !== document.body) opener.current = document.activeElement;
  }, [open]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        onCloseAutoFocus={(e) => {
          const el = opener.current;
          if (el?.isConnected) {
            e.preventDefault();
            el.focus();
          }
        }}
      >
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
