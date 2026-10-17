/**
 * Client-safe formatting for calendar days (YYYY-MM-DD) and money.
 * Calendar days are rendered in UTC so they never shift with the viewer's
 * timezone (a stay on Oct 12 is Oct 12 everywhere).
 */
import type { ISODate } from './dto';
import { money as moneyFn } from './status';

const at = (day: ISODate) => new Date(`${day}T12:00:00Z`);

export function fmtDay(day: ISODate, style: 'short' | 'weekday' | 'long' | 'numeric' = 'short'): string {
  const opts: Intl.DateTimeFormatOptions =
    style === 'long'
      ? { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }
      : style === 'weekday'
        ? { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }
        : style === 'numeric'
          ? { month: 'numeric', day: 'numeric', timeZone: 'UTC' }
          : { month: 'short', day: 'numeric', timeZone: 'UTC' };
  return at(day).toLocaleDateString('en-US', opts);
}

export function fmtRange(a: ISODate, b: ISODate): string {
  const sameMonth = a.slice(0, 7) === b.slice(0, 7);
  return sameMonth ? `${fmtDay(a)} – ${at(b).getUTCDate()}` : `${fmtDay(a)} – ${fmtDay(b)}`;
}

export function addDays(day: ISODate, n: number): ISODate {
  const d = at(day);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function nightsBetween(a: ISODate, b: ISODate): number {
  return Math.max(0, Math.round((at(b).getTime() - at(a).getTime()) / 86_400_000));
}

/** "Today", "Tomorrow", "Yesterday" or "Fri, Oct 16". */
export function relativeDay(day: ISODate, today: ISODate): string {
  const diff = Math.round((at(day).getTime() - at(today).getTime()) / 86_400_000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  return fmtDay(day, 'weekday');
}

export function weekday(day: ISODate): number {
  return at(day).getUTCDay();
}

export function localToday(): ISODate {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function timeAgo(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? 'yesterday' : `${d}d ago`;
}

export function greeting(date = new Date()): string {
  const h = date.getHours();
  return h < 5 ? 'Good evening' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

export { money } from './status';

/* ------------------------------------------------------------------------ */
/* Phone numbers, money and date ranges for people (not machines).          */
/* ------------------------------------------------------------------------ */

// E.164 country codes are prefix-free: these are the 1- and 2-digit ones,
// everything else is 3 digits.
const CC1 = new Set(['1', '7']);
const CC2 = new Set([
  '20', '27', '30', '31', '32', '33', '34', '36', '39', '40', '41', '43', '44', '45', '46', '47', '48', '49',
  '51', '52', '53', '54', '55', '56', '57', '58', '60', '61', '62', '63', '64', '65', '66',
  '81', '82', '84', '86', '90', '91', '92', '93', '94', '95', '98',
]);

/** Group a national number for reading aloud: "2079460000" → "207 946 0000". */
function groupDigits(n: string): string {
  if (n.length <= 4) return n;
  const tail = n.slice(-4);
  const head = n.slice(0, -4);
  const groups: string[] = [];
  // Leading group takes the remainder so the rest are threes (never a lone digit).
  const rem = head.length % 3;
  const lead = rem === 1 && head.length > 3 ? 4 : rem || 3;
  groups.push(head.slice(0, lead));
  for (let i = lead; i < head.length; i += 3) groups.push(head.slice(i, i + 3));
  return [...groups, tail].join(' ');
}

/**
 * A phone number as people read it. E.164 in, readable out:
 * - "+14155550166" → "+1 (415) 555-0166" (or "(415) 555-0166" with `national`)
 * - "+442079460000" → "+44 207 946 0000"
 * Anything that isn't an international number comes back unchanged (trimmed),
 * so a hotel's own formatting is never mangled. Empty input gives "".
 */
export function formatPhone(raw: string | null | undefined, opts: { national?: boolean } = {}): string {
  if (!raw) return '';
  const trimmed = raw.trim();
  let n = trimmed.replace(/\(\s*0\s*\)/g, '').replace(/[\s().-]/g, '');
  if (n.startsWith('00')) n = `+${n.slice(2)}`;
  if (!/^\+[1-9]\d{6,14}$/.test(n)) return trimmed;
  const digits = n.slice(1);
  if (digits.length === 11 && digits.startsWith('1')) {
    // North American Numbering Plan: +1 NPA NXX XXXX.
    const local = `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
    return opts.national ? local : `+1 ${local}`;
  }
  const ccLen = CC1.has(digits[0]) ? 1 : CC2.has(digits.slice(0, 2)) ? 2 : 3;
  return `+${digits.slice(0, ccLen)} ${groupDigits(digits.slice(ccLen))}`;
}

/**
 * Make phone numbers inside a sentence readable, e.g. an activity line
 * "callers go to +442079460000" → "callers go to +44 207 946 0000".
 * Only bare E.164 numbers (a + and 7–15 digits) are touched.
 */
export function formatPhonesIn(text: string): string {
  return text.replace(/(^|[^\w+])(\+[1-9]\d{6,14})(?!\d)/g, (_, pre: string, num: string) => `${pre}${formatPhone(num)}`);
}

const EXTENSION = /^(.*?)\s*(?:;\s*ext=|\bext(?:ension)?\.?|\bx|#|,)\s*(\d{1,6})\s*$/i;

/**
 * The `tel:` form of a number for links: digits and a leading +, with any
 * extension kept apart (";ext=23") so it isn't dialled as part of the number.
 * Numbers with letters (1-800-FLOWERS) are left as typed.
 */
export function telHref(raw: string | null | undefined): string {
  const typed = (raw ?? '').trim();
  const m = typed.match(EXTENSION);
  const main = m ? m[1] : typed;
  const digits = main.replace(/[^\d+]/g, '').replace(/(?!^)\+/g, '');
  if (/[a-z]/i.test(main) || digits.replace('+', '').length < 3) return `tel:${encodeURI(typed)}`;
  return `tel:${digits}${m ? `;ext=${m[2]}` : ''}`;
}

/**
 * Money with Intl, e.g. formatMoney(1234.5) → "$1,234.50",
 * formatMoney(189, 'EUR') → "€189". By default cents show only when the
 * amount has them; pass `{ cents: true | false }` to keep a column aligned.
 */
export function formatMoney(
  amount: number | string | null | undefined,
  currency = 'USD',
  opts: { cents?: boolean } = {},
): string {
  const v = Number(amount);
  if (amount === null || amount === undefined || amount === '' || !Number.isFinite(v)) return '—';
  const hasCents = Math.round(Math.abs(v) * 100) % 100 !== 0;
  return moneyFn(v, { currency, cents: opts.cents ?? hasCents });
}

/**
 * A stay or any range of calendar days, read naturally:
 * "Oct 12 – 15", "Oct 30 – Nov 2", "Dec 30, 2026 – Jan 2, 2027".
 * `year` always adds the year; `weekday` leads with the day name
 * ("Fri, Oct 16 – Sun, Oct 18").
 */
export function formatDateRange(a: ISODate, b: ISODate, opts: { year?: boolean; weekday?: boolean } = {}): string {
  if (!a) return '';
  if (!b || a === b) return `${fmtDay(a, opts.weekday ? 'weekday' : 'short')}${opts.year ? `, ${a.slice(0, 4)}` : ''}`;
  const crossYear = a.slice(0, 4) !== b.slice(0, 4);
  const withYear = (d: ISODate) => `${fmtDay(d, opts.weekday ? 'weekday' : 'short')}, ${d.slice(0, 4)}`;
  if (crossYear) return `${withYear(a)} – ${withYear(b)}`;
  const sameMonth = a.slice(0, 7) === b.slice(0, 7);
  const start = fmtDay(a, opts.weekday ? 'weekday' : 'short');
  const end = opts.weekday ? fmtDay(b, 'weekday') : sameMonth ? String(at(b).getUTCDate()) : fmtDay(b);
  return `${start} – ${end}${opts.year ? `, ${b.slice(0, 4)}` : ''}`;
}

/** "1 night", "3 nights". */
export const formatNights = (n: number) => `${n} night${n === 1 ? '' : 's'}`;

/** "15:00" → "3:00 PM"; anything else is shown as typed. */
export function formatClock(value: string): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m || Number(m[1]) > 23) return value.trim();
  const h = Number(m[1]);
  return `${h % 12 || 12}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`;
}

/** Every half hour of the day as "HH:MM", for check-in and check-out pickers. */
export const HALF_HOURS: string[] = Array.from({ length: 48 }, (_, i) => `${String(Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`);
