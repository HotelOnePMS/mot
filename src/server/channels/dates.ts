/**
 * Calendar helpers for the channel manager, on top of the hotel day helpers
 * in ../dates. Channel ranges are inclusive (first night .. last night), the
 * way OTAs and the rate screens talk about them.
 */
import { addDaysISO, dayOfWeek, eachNight, hotelToday, HOTEL_TIMEZONE, isISODate, toISODate } from '../dates';

export { hotelToday, HOTEL_TIMEZONE, toISODate };

export const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export const isDateString = isISODate;
export const addDays = addDaysISO;

/** Every date from `from` to `to`, both inclusive */
export function eachDate(from: string, to: string): string[] {
  return eachNight(from, addDaysISO(to, 1));
}

export function weekdayOf(date: string): Weekday {
  return WEEKDAYS[dayOfWeek(date)];
}

/** Value for a Prisma `@db.Date` column */
export function toDbDate(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}
