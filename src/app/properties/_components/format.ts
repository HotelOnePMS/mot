import { money } from '@/lib/status';

/**
 * Prices on guest pages: whole amounts without cents ("$643"), cents only
 * when there are some ("$642.50"), so the same stay reads the same on every page.
 */
export function price(n: number, currency = 'USD'): string {
  const cents = Math.round(Math.abs(Number(n)) * 100) % 100 !== 0;
  return money(n, { cents, currency });
}

/** plural(3, 'night') → "3 nights". */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Calendar day (YYYY-MM-DD) n days away. */
export function shiftDay(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** A calendar day (YYYY-MM-DD) as links carry them; anything else in a URL is not a date. */
export function isDay(v: string | null | undefined): v is string {
  return !!v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T12:00:00Z`));
}
