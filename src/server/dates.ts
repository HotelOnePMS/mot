/**
 * Hotel calendar-day helpers.
 *
 * Booking dates are calendar days, stored as Date at 12:00 UTC (see
 * src/lib/date-utils.ts). All day arithmetic here works on 'YYYY-MM-DD'
 * strings so the server's timezone never shifts a stay by a day.
 * "Today" is evaluated in the hotel's own time zone (Property.timezone,
 * see services/hotels.ts) — a 11:30 PM walk-in is still "today" at the desk.
 * HOTEL_TIMEZONE (default America/Los_Angeles) is the platform default for
 * hotels that never set one and for platform-wide pages.
 */
import { toDateString, parseBookingDate } from '@/lib/date-utils';

export const HOTEL_TIMEZONE = process.env.HOTEL_TIMEZONE || 'America/Los_Angeles';

export type ISODate = string; // YYYY-MM-DD

/** A valid IANA time zone name ("Europe/Lisbon"). */
export function isTimeZone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || !tz || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** The hour (0–23) on the hotel's clock. */
export function hourIn(tz: string = HOTEL_TIMEZONE, now: Date = new Date()): number {
  return Number(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hourCycle: 'h23' }).format(now));
}

export function hotelToday(now: Date = new Date(), tz: string = HOTEL_TIMEZONE): ISODate {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export function addDaysISO(day: ISODate, n: number): ISODate {
  const d = parseBookingDate(day);
  d.setUTCDate(d.getUTCDate() + n);
  return toDateString(d);
}

export function diffDays(from: ISODate, to: ISODate): number {
  return Math.round((parseBookingDate(to).getTime() - parseBookingDate(from).getTime()) / 86_400_000);
}

export function eachNight(checkIn: ISODate, checkOut: ISODate): ISODate[] {
  const out: ISODate[] = [];
  for (let d = checkIn; d < checkOut; d = addDaysISO(d, 1)) out.push(d);
  return out;
}

/** Inclusive start / exclusive end of a calendar day, as UTC instants. */
export function dayBounds(day: ISODate): { gte: Date; lt: Date } {
  return { gte: new Date(`${day}T00:00:00.000Z`), lt: new Date(`${addDaysISO(day, 1)}T00:00:00.000Z`) };
}

export function toISODate(d: Date | string): ISODate {
  return toDateString(d);
}

export function atNoonUTC(day: ISODate): Date {
  return parseBookingDate(day);
}

export function isISODate(s: unknown): s is ISODate {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  // A real calendar day: "2026-02-30" parses (as March 2), so it must also round-trip.
  const t = Date.parse(`${s}T12:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === s;
}

export function dayOfWeek(day: ISODate): number {
  return parseBookingDate(day).getUTCDay(); // 0 = Sunday
}

export function formatDay(day: ISODate, style: 'short' | 'long' | 'weekday' = 'short'): string {
  const d = parseBookingDate(day);
  const opts: Intl.DateTimeFormatOptions =
    style === 'long'
      ? { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' }
      : style === 'weekday'
        ? { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }
        : { month: 'short', day: 'numeric', timeZone: 'UTC' };
  return d.toLocaleDateString('en-US', opts);
}
