import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpFromLine,
  Ban,
  BadgeCheck,
  BedDouble,
  Brush,
  CheckCircle2,
  Circle,
  CircleCheck,
  CircleDashed,
  Clock3,
  Cog,
  CreditCard,
  LogOut,
  MousePointerClick,
  Repeat,
  RotateCcw,
  Sparkles,
  Timer,
  TimerOff,
  User,
  UserX,
  Wallet,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import type { BookingStatus, HousekeepingStatus, Occupancy, RoomStatus } from '@/lib/dto';
import { BOOKING_STATUS, HOUSEKEEPING_STATUS, OCCUPANCY, ROOM_STATUS, paymentLabel, type Tone } from '@/lib/status';
import { cn } from '@/lib/utils';

/**
 * Status pills for reservations, rooms, cleaning tasks and payments.
 * Each one pairs a soft tone with an icon and a word, so colour is never the
 * only signal, and within each set every status has its own tone and icon.
 * Status tones only (success / warning / danger / info / primary / neutral):
 * never the brass highlight, and the agent violet only for "via agent".
 */

type Look = { variant: BadgeProps['variant']; icon: LucideIcon; className?: string };

const variant = (tone: Tone): BadgeProps['variant'] => (tone === 'agent' ? 'neutral' : tone);

const BOOKING_LOOK: Record<BookingStatus, Look> = {
  PENDING: { variant: 'warning', icon: Clock3 },
  CONFIRMED: { variant: 'info', icon: CircleCheck },
  CHECKED_IN: { variant: 'success', icon: BedDouble },
  CHECKED_OUT: { variant: 'neutral', icon: LogOut },
  // Routine, so it stays quiet: an outlined pill, set apart from "Checked out".
  CANCELLED: { variant: 'outline', icon: Ban, className: 'text-muted-foreground' },
  // Lost revenue that may need a charge: the one that should catch the eye.
  NO_SHOW: { variant: 'danger', icon: UserX },
};

const ROOM_LOOK: Record<RoomStatus, Look> = {
  CLEAN: { variant: 'success', icon: CheckCircle2 },
  INSPECTED: { variant: 'info', icon: BadgeCheck },
  DIRTY: { variant: 'warning', icon: Brush },
  OUT_OF_ORDER: { variant: 'danger', icon: Wrench },
};

// Same icons as the room board (RoomGrid), so a room reads the same everywhere.
const OCCUPANCY_LOOK: Record<Occupancy, Look> = {
  VACANT: { variant: 'outline', icon: CircleDashed, className: 'text-muted-foreground' },
  OCCUPIED: { variant: 'primary', icon: User },
  ARRIVING: { variant: 'info', icon: ArrowDownToLine },
  DEPARTING: { variant: 'neutral', icon: ArrowUpFromLine },
  // Out and in on the same day: the one with a deadline.
  TURNOVER: { variant: 'warning', icon: Repeat },
};

const TASK_LOOK: Record<HousekeepingStatus, Look> = {
  PENDING: { variant: 'warning', icon: Circle },
  IN_PROGRESS: { variant: 'info', icon: Timer },
  COMPLETED: { variant: 'success', icon: CheckCircle2 },
  INSPECTED: { variant: 'primary', icon: BadgeCheck },
};

const PAYMENT_LOOK: Record<string, Look> = {
  PAID: { variant: 'success', icon: CreditCard },
  UNPAID: { variant: 'neutral', icon: Wallet },
  PAY_AT_PROPERTY: { variant: 'neutral', icon: Wallet },
  AWAITING_PAYMENT: { variant: 'warning', icon: Clock3 },
  EXPIRED: { variant: 'outline', icon: TimerOff, className: 'text-muted-foreground' },
  REFUNDED: { variant: 'info', icon: RotateCcw },
  FAILED: { variant: 'danger', icon: AlertTriangle },
};

type BadgeOpts = {
  className?: string;
  /** "sm" for dense tables and chips. */
  size?: 'default' | 'sm';
  /** Show the status icon (default true). Without it a dot keeps a non-colour cue. */
  icon?: boolean;
};

function StatusPill({ look, label, size, icon = true, className }: BadgeOpts & { look: Look; label: string }) {
  return (
    <Badge
      variant={look.variant}
      size={size === 'sm' ? 'sm' : 'default'}
      icon={icon ? look.icon : undefined}
      dot={!icon}
      className={cn(look.className, className)}
    >
      {label}
    </Badge>
  );
}

export function BookingStatusBadge({ status, ...opts }: { status: BookingStatus } & BadgeOpts) {
  const s = BOOKING_STATUS[status] ?? { label: status, tone: 'neutral' as Tone };
  const look = BOOKING_LOOK[status] ?? { variant: variant(s.tone), icon: Circle };
  return <StatusPill look={look} label={s.label} {...opts} />;
}

export function RoomStatusBadge({ status, ...opts }: { status: RoomStatus } & BadgeOpts) {
  const s = ROOM_STATUS[status] ?? { label: status, tone: 'neutral' as Tone };
  const look = ROOM_LOOK[status] ?? { variant: variant(s.tone), icon: Circle };
  return <StatusPill look={look} label={s.label} {...opts} />;
}

export function OccupancyBadge({ occupancy, ...opts }: { occupancy: Occupancy } & BadgeOpts) {
  const s = OCCUPANCY[occupancy] ?? { label: occupancy, tone: 'neutral' as Tone };
  const look = OCCUPANCY_LOOK[occupancy] ?? { variant: variant(s.tone), icon: Circle };
  return <StatusPill look={look} label={s.label} {...opts} />;
}

export function TaskStatusBadge({ status, ...opts }: { status: HousekeepingStatus } & BadgeOpts) {
  const s = HOUSEKEEPING_STATUS[status] ?? { label: status, tone: 'neutral' as Tone };
  const look = TASK_LOOK[status] ?? { variant: variant(s.tone), icon: Circle };
  return <StatusPill look={look} label={s.label} {...opts} />;
}

export function PaymentBadge({ status, ...opts }: { status: string | null | undefined } & BadgeOpts) {
  const s = paymentLabel(status);
  const look = PAYMENT_LOOK[status ?? 'UNPAID'] ?? { variant: variant(s.tone), icon: Wallet };
  return <StatusPill look={look} label={s.label} {...opts} />;
}

const SOURCE_LOOK: Record<'agent' | 'classic' | 'system', Look & { label: string }> = {
  // The one AI mark: violet belongs to the agent.
  agent: { label: 'Via agent', variant: 'agent', icon: Sparkles },
  classic: { label: 'Manual', variant: 'outline', icon: MousePointerClick, className: 'text-muted-foreground' },
  system: { label: 'Automatic', variant: 'neutral', icon: Cog },
};

/**
 * Who or what made a change: "Via agent" (AI), "Manual" or "Automatic".
 * Pass `quiet` to render nothing for hand-made changes, the usual case.
 */
export function SourceBadge({ source, quiet = false, ...opts }: { source: 'agent' | 'classic' | 'system' | string; quiet?: boolean } & BadgeOpts) {
  const look = SOURCE_LOOK[source as keyof typeof SOURCE_LOOK];
  if (!look || (quiet && source === 'classic')) return null;
  return <StatusPill look={look} label={look.label} size="sm" {...opts} />;
}
