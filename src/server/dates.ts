/**
 * Hotel calendar-day helpers.
 *
 * Booking dates are calendar days, stored as Date at 12:00 UTC (see
 * src/lib/date-utils.ts). All day arithmetic here works on 'YYYY-MM-DD'
 * strings so the server's timezone never shifts a stay by a day.
 * "Today" is evaluated in the hotel's timezone (HOTEL_TIMEZONE, default
 * America/Los_Angeles) — a 11:30 PM walk-in is still "today" at the desk.
 */
import { toDateString, parseBookingDate } from '@/lib/date-utils';

export const HOTEL_TIMEZONE = process.env.HOTEL_TIMEZONE || 'America/Los_Angeles';

export type ISODate = string; // YYYY-MM-DD

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
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T12:00:00Z`));
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
