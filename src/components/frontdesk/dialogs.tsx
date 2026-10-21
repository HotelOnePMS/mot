'use client';

import * as React from 'react';
import useSWR from 'swr';
import { BedDouble, LogOut } from 'lucide-react';
import type { RoomOption } from '@/lib/agent/blocks';
import type { BookingSummary } from '@/lib/dto';
import { fmtRange } from '@/lib/format';
import { money } from '@/lib/status';
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

/** Check-out needs the balance at zero: the guest pays (or the payment is recorded) first. */
export function CheckOutDialog({ booking, open, onOpenChange, today }: { booking: BookingSummary | null; open: boolean; onOpenChange: (o: boolean) => void; today: string }) {
  const { transition, pending } = useBookingActions();
  const { can } = useConsole();
  const { data: desk } = useDeskPayments(open ? booking?.id : null);
  const [collecting, setCollecting] = React.useState(false);
  if (!booking) return null;
  const early = booking.checkOut > today;
  // The same balance the server checks: room and extras less everything paid, online or at the desk.
  const unpaid = booking.balance > 0.004;
  const canCollect = can('payments.collect');
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
                <p className="font-semibold">Balance of {money(booking.balance, { currency: booking.currency })} to pay</p>
                <p>{canCollect ? 'Take the payment, or record one taken another way, before the guest checks out.' : 'Ask someone who can take payments to settle it before the guest checks out.'}</p>
              </Callout>
            )}
          </div>
        )}
        {desk && desk.deposit.held > 0.004 && (
          <Callout tone="info">
            {money(desk.deposit.held, { currency: booking.currency })} security deposit still held. Return it (or keep what’s owed) from the{' '}
            <a href={`/admin/bookings/${booking.id}`} className="font-medium underline underline-offset-2">
              reservation page
            </a>
            .
          </Callout>
        )}
        <CollectPaymentDialog booking={booking} kind="PAYMENT" open={collecting} onOpenChange={setCollecting} />
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Not yet
          </Button>
          <Button
            disabled={unpaid}
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
