'use client';

import * as React from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { useParams } from 'next/navigation';
import {
  ArrowLeft,
  BedDouble,
  CalendarClock,
  Check,
  Copy,
  CreditCard,
  DoorOpen,
  LogIn,
  LogOut,
  Mail,
  MessageSquarePlus,
  MessageSquareText,
  MoreHorizontal,
  Phone,
  Sparkles,
  TriangleAlert,
  Undo2,
  UserX,
  Users,
  XCircle,
} from 'lucide-react';
import type { ActivityEntry, BookingStatus, BookingSummary } from '@/lib/dto';
import { fetcher } from '@/lib/fetcher';
import { fmtDay, formatMoney, formatNights, formatPhone, formatPhonesIn, nightsBetween, relativeDay, telHref, timeAgo } from '@/lib/format';
import { BOOKING_STATUS } from '@/lib/status';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Avatar, EmptyState, Skeleton } from '@/components/ui/primitives';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { BookingStatusBadge, PaymentBadge, SourceBadge } from '@/components/hotel/badges';
import { AssignRoomDialog, CheckInDialog, CheckOutDialog, ConfirmDialog, NoteDialog } from '@/components/frontdesk/dialogs';
import { useBookingActions } from '@/components/frontdesk/useBookingActions';
import { useConsole } from '@/components/console/ConsoleProvider';
import { useCopy } from '@/components/setup/CopyButton';

interface Detail {
  booking: BookingSummary;
  history: { id: string; status: BookingStatus; notes: string | null; createdAt: string }[];
  activity: ActivityEntry[];
  actions: BookingStatus[];
}

interface Payment {
  paymentStatus: string;
  cardLast4: string | null;
  cardBrand: string | null;
  billingName: string | null;
  stripeCheckoutSessionId: string | null;
}

type DialogKind = 'checkin' | 'checkout' | 'note' | 'assign' | 'noshow' | 'cancel' | 'reinstate';

const FRAME = 'mx-auto w-full max-w-7xl px-4 pb-12 pt-5 sm:px-6 sm:pt-6 lg:px-8 lg:pt-8';

function parseNotes(notes: string | null) {
  if (!notes) return [];
  return notes
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const m = line.match(/^\[([^\]·]+)·\s*([^\]]+)\]\s*(.*)$/);
      return m ? { day: m[1].trim(), by: m[2].trim(), text: m[3] } : { day: null, by: null, text: line };
    })
    .reverse();
}

/** Where the reservation came from, read from its first history note ("Booked online — pay at property"). */
function bookingSource(note: string | null | undefined): string | null {
  const n = (note ?? '').toLowerCase();
  if (!n) return null;
  if (n.includes('whatsapp')) return 'On WhatsApp';
  if (n.includes('phone') || n.includes('call')) return 'By phone';
  if (n.includes('online')) return 'On your booking page';
  if (n.includes('agent')) return 'Through the agent';
  if (n.includes('walk')) return 'Walk-in';
  return null;
}

/** "Today" / "Tomorrow" / "Yesterday", else "in 5 days" / "5 days ago" (never the date again). */
function fromToday(day: string, today: string) {
  if (!today) return '';
  const ahead = nightsBetween(today, day);
  const behind = nightsBetween(day, today);
  if (ahead <= 1 && behind <= 1) return relativeDay(day, today);
  return ahead > 0 ? `in ${ahead} days` : `${behind} days ago`;
}

function Fact({ icon: Icon, label, children }: { icon: React.ElementType; label: string; children: React.ReactNode }) {
  return (
    // dt and dd must be direct children of the dl's group div, so the icon rides inside the dt.
    <div className="relative min-h-9 min-w-0 pl-11">
      <dt className="text-xs text-muted-foreground">
        <span className="absolute left-0 top-0.5 flex size-8 items-center justify-center rounded-lg bg-muted text-muted-foreground" aria-hidden>
          <Icon className="size-4" />
        </span>
        {label}
      </dt>
      <dd className="text-sm font-medium">{children}</dd>
    </div>
  );
}

function SectionTitle({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex min-h-9 items-center justify-between gap-3">
      <h2 className="text-base font-semibold tracking-tight">{children}</h2>
      {action}
    </div>
  );
}

function BackLink() {
  return (
    <Link
      href="/admin/bookings"
      className="-ml-2 inline-flex h-10 items-center gap-1.5 rounded-lg px-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <ArrowLeft className="size-4" aria-hidden /> Reservations
    </Link>
  );
}

export default function BookingDetailPage() {
  const { bookingId } = useParams<{ bookingId: string }>();
  const { ctx, can, askAgent } = useConsole();
  const today = ctx?.today ?? '';
  const { data, error, isLoading } = useSWR<Detail>(`/api/admin/bookings/${bookingId}`, fetcher);
  const { data: payment } = useSWR<Payment>(can('booking.payment.view') ? `/api/admin/bookings/${bookingId}/payment` : null, fetcher);
  const { transition, pending } = useBookingActions();
  const [dialog, setDialog] = React.useState<DialogKind | null>(null);
  const { copy, copied } = useCopy();

  if (error) {
    return (
      <div className={FRAME}>
        <BackLink />
        <Card className="mt-4">
          <EmptyState
            icon={TriangleAlert}
            title="We couldn’t find that reservation"
            description="It may have been removed, or it belongs to a property you don’t have access to."
            action={
              <Button asChild variant="outline">
                <Link href="/admin/bookings">Back to reservations</Link>
              </Button>
            }
          />
        </Card>
      </div>
    );
  }

  if (isLoading || !data) {
    return (
      <div className={cn(FRAME, 'space-y-6')} aria-busy>
        <Skeleton className="h-10 w-36" />
        <div className="flex items-center gap-4">
          <Skeleton className="size-12 rounded-full" />
          <div className="space-y-2">
            <Skeleton className="h-8 w-56" />
            <Skeleton className="h-5 w-40" />
          </div>
        </div>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <Skeleton className="h-[420px] rounded-2xl" />
          <Skeleton className="h-[420px] rounded-2xl" />
        </div>
        <span className="sr-only" role="status">
          Loading reservation…
        </span>
      </div>
    );
  }

  const b = data.booking;
  const has = (s: BookingStatus) => data.actions.includes(s);
  const closed = b.status === 'CHECKED_OUT' || b.status === 'CANCELLED' || b.status === 'NO_SHOW';
  const reinstatable = (b.status === 'CANCELLED' || b.status === 'NO_SHOW') && has('CONFIRMED') && can('booking.reinstate');
  const notes = parseNotes(b.notes);
  const nightly = b.nights ? b.totalPrice / b.nights / Math.max(1, b.rooms) : b.totalPrice;
  const stayProgress =
    b.status === 'CHECKED_IN' && today ? Math.min(1, Math.max(0, nightsBetween(b.checkIn, today) / Math.max(1, b.nights))) : b.status === 'CHECKED_OUT' ? 1 : 0;
  const late = !!today && (b.status === 'CONFIRMED' || b.status === 'PENDING') && b.checkIn < today;
  const overdue = !!today && b.status === 'CHECKED_IN' && b.checkOut < today;
  const busy = !!pending?.startsWith(b.id);
  const source = bookingSource([...data.history].sort((x, y) => x.createdAt.localeCompare(y.createdAt))[0]?.notes);

  const timeline = [
    ...data.history.map((h) => ({
      id: `h-${h.id}`,
      at: h.createdAt,
      title: BOOKING_STATUS[h.status]?.label ?? h.status,
      detail: h.notes,
      agent: false,
    })),
    ...data.activity
      .filter((a) => a.action !== 'BOOKING_STATUS')
      .map((a) => ({ id: `a-${a.id}`, at: a.at, title: formatPhonesIn(a.summary), detail: a.user.name, agent: a.source === 'agent' })),
  ].sort((x, y) => y.at.localeCompare(x.at));

  const primary =
    b.status === 'CONFIRMED' || b.status === 'PENDING'
      ? has('CHECKED_IN') && can('booking.checkin') && b.checkIn <= today
        ? { label: 'Check in', icon: LogIn, onClick: () => setDialog('checkin') }
        : b.status === 'PENDING' && can('booking.confirm')
          ? { label: 'Confirm', icon: Check, onClick: () => transition(b, 'CONFIRMED') }
          : null
      : b.status === 'CHECKED_IN' && can('booking.checkout')
        ? { label: 'Check out', icon: LogOut, onClick: () => setDialog('checkout') }
        : reinstatable
          ? { label: 'Reinstate', icon: Undo2, onClick: () => setDialog('reinstate') }
          : null;

  const canAssign = !closed && can('booking.assignRoom');
  const canNote = can('booking.note');
  const canConfirm = b.status === 'PENDING' && has('CONFIRMED') && can('booking.confirm') && primary?.label !== 'Confirm';
  const canNoShow = has('NO_SHOW') && b.checkIn <= today && can('booking.noShow');
  const canCancel = has('CANCELLED') && can('booking.cancel');
  const hasMenu = canAssign || canNote || canConfirm || canNoShow || canCancel;

  return (
    <div className={cn(FRAME, 'space-y-6')}>
      <BackLink />

      {/* Header: who, the code, where it stands, and what to do next */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          <Avatar name={b.guest.name} size="lg" />
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-semibold tracking-tight sm:text-3xl">{b.guest.name}</h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void copy(b.code, 'Couldn’t copy — select the code instead.')}
                className="inline-flex h-7 items-center gap-1.5 rounded-md border bg-surface-sunken px-2 font-mono text-xs tracking-wider transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={`Confirmation code ${b.code}. Copy`}
              >
                {b.code}
                {copied ? <Check className="size-3.5 text-success" aria-hidden /> : <Copy className="size-3.5 text-muted-foreground" aria-hidden />}
              </button>
              <span role="status" aria-live="polite" className="sr-only">
                {copied ? 'Code copied' : ''}
              </span>
              <BookingStatusBadge status={b.status} />
              {late && <Badge variant="warning">Late arrival</Badge>}
              {overdue && <Badge variant="danger">Past check-out</Badge>}
            </div>
          </div>
        </div>
        {(primary || hasMenu) && (
          <div className="flex items-center gap-2" role="group" aria-label="Reservation actions">
            {primary && (
              <Button onClick={primary.onClick} loading={busy} className="flex-1 sm:flex-none">
                <primary.icon aria-hidden /> {primary.label}
              </Button>
            )}
            {hasMenu && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon" aria-label="More actions" title="More actions">
                    <MoreHorizontal aria-hidden />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  {(canAssign || canNote || canConfirm) && (
                    <DropdownMenuGroup>
                      {canConfirm && (
                        <DropdownMenuItem onSelect={() => transition(b, 'CONFIRMED')}>
                          <Check aria-hidden /> Confirm reservation
                        </DropdownMenuItem>
                      )}
                      {canAssign && (
                        <DropdownMenuItem onSelect={() => setDialog('assign')}>
                          <DoorOpen aria-hidden /> {b.room ? 'Move to another room' : 'Choose a room'}
                        </DropdownMenuItem>
                      )}
                      {canNote && (
                        <DropdownMenuItem onSelect={() => setDialog('note')}>
                          <MessageSquarePlus aria-hidden /> Add a note
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuGroup>
                  )}
                  {(canNoShow || canCancel) && (
                    <>
                      {(canAssign || canNote || canConfirm) && <DropdownMenuSeparator />}
                      <DropdownMenuLabel>Asks you to confirm</DropdownMenuLabel>
                      {canNoShow && (
                        <DropdownMenuItem destructive onSelect={() => setDialog('noshow')}>
                          <UserX aria-hidden /> Mark as no-show…
                        </DropdownMenuItem>
                      )}
                      {canCancel && (
                        <DropdownMenuItem destructive onSelect={() => setDialog('cancel')}>
                          <XCircle aria-hidden /> Cancel reservation…
                        </DropdownMenuItem>
                      )}
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          {/* Stay */}
          <Card className="p-5 sm:p-6">
            <SectionTitle action={<span className="truncate text-xs text-muted-foreground">{b.propertyName}</span>}>Stay</SectionTitle>
            <div className="mt-4 grid grid-cols-[1fr_auto_1fr] items-center gap-2 rounded-xl border bg-surface-sunken/60 p-3 sm:gap-3 sm:p-4">
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">Check-in</p>
                <p className="whitespace-nowrap text-base font-semibold tabular sm:text-lg">{fmtDay(b.checkIn, 'weekday')}</p>
                {today && <p className="text-xs text-muted-foreground">{fromToday(b.checkIn, today)}</p>}
              </div>
              <div className="flex flex-col items-center px-1 text-xs text-muted-foreground sm:px-2">
                <span className="tabular">{formatNights(b.nights)}</span>
                <div
                  className="mt-1.5 h-1.5 w-12 overflow-hidden rounded-full bg-muted sm:w-20"
                  role="progressbar"
                  aria-label="Stay progress"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(stayProgress * 100)}
                >
                  <div className="h-full rounded-full bg-primary" style={{ width: `${stayProgress * 100}%` }} />
                </div>
              </div>
              <div className="min-w-0 text-right">
                <p className="text-xs text-muted-foreground">Check-out</p>
                <p className="whitespace-nowrap text-base font-semibold tabular sm:text-lg">{fmtDay(b.checkOut, 'weekday')}</p>
                {today && <p className="text-xs text-muted-foreground">{fromToday(b.checkOut, today)}</p>}
              </div>
            </div>
            <dl className="mt-5 grid gap-4 sm:grid-cols-3">
              <Fact icon={BedDouble} label="Room">
                {b.room ? (
                  <>
                    Room {b.room.number}
                    <span className="block font-normal text-muted-foreground">{b.roomType.name}</span>
                  </>
                ) : (
                  <>
                    <span className="block font-normal text-muted-foreground">{b.roomType.name} · not assigned</span>
                    {canAssign && (
                      <Button variant="link" className="mt-0.5 text-xs" onClick={() => setDialog('assign')}>
                        Choose a room
                      </Button>
                    )}
                  </>
                )}
              </Fact>
              <Fact icon={Users} label="Party">
                {b.guests} guest{b.guests === 1 ? '' : 's'}
                {b.rooms > 1 && ` · ${b.rooms} rooms`}
              </Fact>
              <Fact icon={CalendarClock} label="Booked">
                <time dateTime={b.createdAt} title={new Date(b.createdAt).toLocaleString()}>
                  {timeAgo(b.createdAt)}
                </time>
                {source && <span className="block font-normal text-muted-foreground">{source}</span>}
              </Fact>
            </dl>
          </Card>

          {/* Notes */}
          <Card className="p-5 sm:p-6">
            <SectionTitle
              action={
                canNote ? (
                  <Button variant="ghost" size="sm" onClick={() => setDialog('note')}>
                    <MessageSquarePlus aria-hidden /> Add note
                  </Button>
                ) : undefined
              }
            >
              Notes and requests
            </SectionTitle>
            {notes.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">No notes yet. Add preferences, special occasions or anything the next shift should know.</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {notes.map((n, i) => (
                  <li key={i} className="flex gap-3 rounded-xl bg-muted/60 px-3 py-2.5">
                    <MessageSquareText className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                    <div className="min-w-0">
                      <p className="text-sm">{n.text}</p>
                      {n.by && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          {n.by}
                          {n.day ? ` · ${fmtDay(n.day)}` : ''}
                        </p>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {/* Timeline */}
          <Card className="p-5 sm:p-6">
            <SectionTitle>History</SectionTitle>
            {timeline.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">Nothing has happened yet. Check-ins, room moves and notes will show up here.</p>
            ) : (
              <ol className="relative mt-4 space-y-4 border-l pl-5">
                {timeline.map((t) => (
                  <li key={t.id} className="relative">
                    <span
                      className={cn('absolute -left-[25px] top-1.5 size-2.5 rounded-full ring-4 ring-card', t.agent ? 'bg-agent' : 'bg-primary/70')}
                      aria-hidden
                    />
                    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                      {t.title}
                      {t.agent && <SourceBadge source="agent" />}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      <time dateTime={t.at} title={new Date(t.at).toLocaleString()}>
                        {timeAgo(t.at)}
                      </time>
                      {t.detail ? ` · ${t.detail}` : ''}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          {/* Guest */}
          <Card className="p-5 sm:p-6">
            <SectionTitle>Guest</SectionTitle>
            <ul className="-mx-2 mt-2 space-y-0.5">
              <li>
                <a
                  href={`mailto:${b.guest.email}`}
                  className="flex min-h-10 items-center gap-2.5 rounded-lg px-2 text-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Mail className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="sr-only">Email </span>
                  <span className="truncate">{b.guest.email}</span>
                </a>
              </li>
              <li>
                {b.guest.phone ? (
                  <a
                    href={telHref(b.guest.phone)}
                    className="flex min-h-10 items-center gap-2.5 rounded-lg px-2 text-sm tabular transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <Phone className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="sr-only">Call </span>
                    {formatPhone(b.guest.phone)}
                  </a>
                ) : (
                  <p className="flex min-h-10 items-center gap-2.5 px-2 text-sm text-muted-foreground">
                    <Phone className="size-4 shrink-0" aria-hidden /> No phone number on file
                  </p>
                )}
              </li>
            </ul>
          </Card>

          {/* Payment */}
          <Card className="p-5 sm:p-6">
            <SectionTitle action={<PaymentBadge status={b.paymentStatus} />}>Payment</SectionTitle>
            <p className="mt-3 text-3xl font-semibold tracking-tight tabular">{formatMoney(b.totalPrice, 'USD', { cents: true })}</p>
            <p className="text-xs text-muted-foreground">
              {formatMoney(nightly, 'USD', { cents: true })} average a night · {formatNights(b.nights)}
              {b.rooms > 1 ? ` × ${b.rooms} rooms` : ''}
            </p>
            {payment && (payment.cardLast4 || payment.stripeCheckoutSessionId) && (
              <p className="mt-4 flex items-center gap-2 rounded-lg bg-muted/60 px-3 py-2 text-sm">
                <CreditCard className="size-4 text-muted-foreground" aria-hidden />
                {payment.cardLast4 ? `${payment.cardBrand ?? 'Card'} ending ${payment.cardLast4}` : 'Paid online by card'}
              </p>
            )}
            {b.paymentStatus !== 'PAID' && b.status !== 'CANCELLED' && b.status !== 'NO_SHOW' && (
              <p className="mt-4 text-sm text-muted-foreground">The balance is collected at the property, on arrival.</p>
            )}
          </Card>

          {/* Agent (AI feature) */}
          {can('agent.use') && !closed && (
            <Card className="relative overflow-hidden p-5 sm:p-6">
              <div className="bg-aurora pointer-events-none absolute inset-0 opacity-[0.06]" aria-hidden />
              <div className="relative">
                <h2 className="flex items-center gap-2 text-base font-semibold tracking-tight">
                  <Sparkles className="size-4 text-agent" aria-hidden /> Ask the agent
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">One tap sends it; you confirm before anything changes.</p>
                <ul className="mt-3 space-y-1.5">
                  {[
                    b.status === 'CHECKED_IN' ? null : { cmd: `Best room for ${b.guest.name}`, label: `Find the best room for ${b.guest.name.split(' ')[0]}` },
                    b.status === 'CHECKED_IN'
                      ? { cmd: `Check out ${b.guest.name}`, label: `Check out ${b.guest.name.split(' ')[0]}` }
                      : { cmd: `Check in ${b.guest.name}, quiet room on a high floor`, label: 'Check in to a quiet room on a high floor' },
                    { cmd: `Add a note to ${b.guest.name}: `, label: 'Add a note…' },
                  ]
                    .filter((x): x is { cmd: string; label: string } => !!x)
                    .map((s) => (
                      <li key={s.cmd}>
                        <Button
                          variant="ghost"
                          className="h-auto min-h-10 w-full justify-start whitespace-normal rounded-lg border border-agent/20 bg-card/70 px-3 py-2 text-left font-normal hover:border-agent/40 hover:bg-agent-soft/60"
                          onClick={() => askAgent(s.cmd)}
                        >
                          <Sparkles className="text-agent" aria-hidden />
                          {s.label}
                        </Button>
                      </li>
                    ))}
                </ul>
              </div>
            </Card>
          )}
        </div>
      </div>

      <CheckInDialog booking={dialog === 'checkin' ? b : null} open={dialog === 'checkin'} onOpenChange={(o) => !o && setDialog(null)} />
      <CheckOutDialog booking={dialog === 'checkout' ? b : null} open={dialog === 'checkout'} onOpenChange={(o) => !o && setDialog(null)} today={today} />
      <NoteDialog booking={dialog === 'note' ? b : null} open={dialog === 'note'} onOpenChange={(o) => !o && setDialog(null)} />
      <AssignRoomDialog booking={dialog === 'assign' ? b : null} open={dialog === 'assign'} onOpenChange={(o) => !o && setDialog(null)} />
      <ConfirmDialog
        open={dialog === 'noshow' || dialog === 'cancel' || dialog === 'reinstate'}
        onOpenChange={(o) => !o && setDialog(null)}
        title={
          dialog === 'reinstate'
            ? `Reinstate ${b.guest.name}’s reservation?`
            : dialog === 'noshow'
              ? `Mark ${b.guest.name} as a no-show?`
              : `Cancel ${b.guest.name}’s reservation?`
        }
        description={
          dialog === 'reinstate'
            ? 'It becomes confirmed again if the room type is still available for those nights.'
            : 'The room is released back to sale. A manager can reinstate it later.'
        }
        confirmLabel={dialog === 'reinstate' ? 'Reinstate' : dialog === 'noshow' ? 'Mark no-show' : 'Cancel reservation'}
        destructive={dialog !== 'reinstate'}
        loading={busy}
        onConfirm={async () => {
          const to: BookingStatus = dialog === 'reinstate' ? 'CONFIRMED' : dialog === 'noshow' ? 'NO_SHOW' : 'CANCELLED';
          const r = await transition(b, to);
          if (r) setDialog(null);
        }}
      />
    </div>
  );
}
