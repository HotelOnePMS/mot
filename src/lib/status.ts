/**
 * Human labels + visual tones for every status in the system, so a status
 * reads the same in tables, cards, the agent and emails. Client-safe.
 */
import type { BookingStatus, HousekeepingStatus, Occupancy, RoomStatus } from './dto';

export type Tone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info' | 'agent';

export const BOOKING_STATUS: Record<BookingStatus, { label: string; tone: Tone }> = {
  PENDING: { label: 'Pending', tone: 'warning' },
  CONFIRMED: { label: 'Confirmed', tone: 'info' },
  CHECKED_IN: { label: 'In house', tone: 'success' },
  CHECKED_OUT: { label: 'Checked out', tone: 'neutral' },
  CANCELLED: { label: 'Cancelled', tone: 'danger' },
  NO_SHOW: { label: 'No-show', tone: 'danger' },
};

export const ROOM_STATUS: Record<RoomStatus, { label: string; tone: Tone }> = {
  CLEAN: { label: 'Clean', tone: 'success' },
  INSPECTED: { label: 'Inspected', tone: 'info' },
  DIRTY: { label: 'Dirty', tone: 'warning' },
  OUT_OF_ORDER: { label: 'Out of order', tone: 'danger' },
};

export const HOUSEKEEPING_STATUS: Record<HousekeepingStatus, { label: string; tone: Tone }> = {
  PENDING: { label: 'To do', tone: 'warning' },
  IN_PROGRESS: { label: 'Cleaning', tone: 'info' },
  COMPLETED: { label: 'Done', tone: 'success' },
  INSPECTED: { label: 'Inspected', tone: 'success' },
};

export const OCCUPANCY: Record<Occupancy, { label: string; tone: Tone }> = {
  VACANT: { label: 'Vacant', tone: 'neutral' },
  OCCUPIED: { label: 'Occupied', tone: 'brand' },
  ARRIVING: { label: 'Arriving', tone: 'info' },
  DEPARTING: { label: 'Departing', tone: 'warning' },
  // Same-day departure + arrival: the room must be turned around in time.
  TURNOVER: { label: 'Turnover', tone: 'warning' },
};

export const PAYMENT_STATUS: Record<string, { label: string; tone: Tone }> = {
  PAID: { label: 'Paid', tone: 'success' },
  UNPAID: { label: 'Pay at property', tone: 'neutral' },
  PAY_AT_PROPERTY: { label: 'Pay at property', tone: 'neutral' },
  AWAITING_PAYMENT: { label: 'Awaiting payment', tone: 'warning' },
  EXPIRED: { label: 'Payment expired', tone: 'neutral' },
  REFUNDED: { label: 'Refunded', tone: 'neutral' },
  FAILED: { label: 'Payment failed', tone: 'danger' },
};

export function paymentLabel(status: string | null | undefined) {
  return PAYMENT_STATUS[status ?? 'UNPAID'] ?? { label: status ?? 'Unknown', tone: 'neutral' as Tone };
}

export function roleLabel(role: string): string {
  return (
    {
      ADMIN: 'Platform admin',
      OWNER: 'Owner',
      MANAGER: 'Manager',
      FRONT_DESK: 'Front desk',
      HOUSEKEEPER: 'Housekeeping',
      CUSTOMER: 'Guest',
    } as Record<string, string>
  )[role] ?? role;
}

const moneyFormatters = new Map<string, Intl.NumberFormat>();

function moneyFormatter(currency: string, digits: number) {
  const key = `${currency}:${digits}`;
  let f = moneyFormatters.get(key);
  if (!f) {
    f = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
    moneyFormatters.set(key, f);
  }
  return f;
}

/**
 * Format an amount of money, e.g. money(1234.5) → "$1,234.50",
 * money(1234.5, { cents: false }) → "$1,235". Rounds to whole cents first
 * (no 0.1 + 0.2 artefacts, no "-$0.00"); non-finite input renders as "—".
 */
export const money = (n: number, opts: { cents?: boolean; currency?: string } = {}) => {
  // Number() also unwraps Decimal-like values that reach here untyped.
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  const digits = opts.cents === false ? 0 : 2;
  const factor = 10 ** digits;
  // Half away from zero, like a till: 1.005 → 1.01, -12.345 → -12.35.
  const rounded = (Math.sign(v) * Math.round((Math.abs(v) + Number.EPSILON) * factor)) / factor;
  return moneyFormatter(opts.currency ?? 'USD', digits).format(rounded === 0 ? 0 : rounded);
};

const numberFormatter = new Intl.NumberFormat('en-US');
const percentFormatter = new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 0 });

/** 1234 → "1,234". */
export const formatNumber = (n: number) => (Number.isFinite(Number(n)) ? numberFormatter.format(Number(n)) : '—');

/** A 0–100 value → "72%". */
export const formatPercent = (pct: number) => (Number.isFinite(Number(pct)) ? percentFormatter.format(Number(pct) / 100) : '—');
