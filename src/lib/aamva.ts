/**
 * Reads the PDF417 barcode on the back of a US or Canadian driver's licence
 * or state ID (AAMVA format), and checks the name on it against the booking.
 * Pure functions, safe on the client: the browser decodes the barcode, this
 * turns its text into the few fields the front desk needs.
 */

export interface LicenceData {
  firstName: string | null;
  lastName: string | null;
  /** "First Last" as printed, for the name-on-ID field. */
  fullName: string | null;
  /** Last four characters of the licence number; the full number is never kept. */
  numberLast4: string | null;
  /** ISO date (YYYY-MM-DD). */
  expiresOn: string | null;
  /** ISO date; shown for an age check and never stored. */
  dateOfBirth: string | null;
  /** Issuing state or province, e.g. "CA". */
  jurisdiction: string | null;
}

/** True when the text looks like an AAMVA licence barcode. */
export function isAamva(text: string): boolean {
  return /ANSI\s?\d{6}/.test(text) || /(?:^|[\n\r])DAQ/.test(text) || /(?:DL|ID)DAQ/.test(text);
}

function elements(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const raw of text.split(/[\n\r\x1e]+/)) {
    let line = raw;
    if (!/^D[A-Z]{2}/.test(line)) {
      // The first element is glued to the header ("…DL00410278ZV03190008DLDAQ123…").
      const at = line.search(/(?:DL|ID)D[A-Z]{2}/);
      if (at < 0) continue;
      line = line.slice(at + 2);
    }
    const code = line.slice(0, 3);
    const value = line.slice(3).trim();
    if (value && !out.has(code)) out.set(code, value);
  }
  return out;
}

/** MMDDCCYY (US) or CCYYMMDD (Canada) to YYYY-MM-DD. */
export function aamvaDate(value: string | undefined, canadian = false): string | null {
  const d = (value ?? '').replace(/\D/g, '');
  if (d.length !== 8) return null;
  const ymdFirst = canadian || /^(19|20)\d{2}(0[1-9]|1[0-2])/.test(d);
  const [y, m, day] = ymdFirst ? [d.slice(0, 4), d.slice(4, 6), d.slice(6, 8)] : [d.slice(4, 8), d.slice(0, 2), d.slice(2, 4)];
  const mm = Number(m);
  const dd = Number(day);
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  return `${y}-${m}-${day}`;
}

const title = (s: string | null) =>
  s
    ? s
        .toLowerCase()
        .replace(/(^|[\s'-])\p{L}/gu, (c) => c.toUpperCase())
        .trim()
    : null;

export function parseAamva(text: string): LicenceData | null {
  if (!isAamva(text)) return null;
  const el = elements(text);
  if (!el.size) return null;
  const country = el.get('DCG');
  const canadian = country === 'CAN';
  // DAC/DCS (current); DCT is "first,middle" on older cards; DAA is "last,first,middle" on the oldest.
  let first = el.get('DAC') ?? el.get('DCT')?.split(/[,\s]/)[0] ?? null;
  let last = el.get('DCS') ?? el.get('DAB') ?? null;
  const daa = el.get('DAA');
  if ((!first || !last) && daa) {
    const parts = daa.split(',').map((p) => p.trim());
    last = last ?? parts[0] ?? null;
    first = first ?? parts[1] ?? null;
  }
  const number = el.get('DAQ')?.replace(/\s/g, '') ?? null;
  const firstName = title(first);
  const lastName = title(last);
  return {
    firstName,
    lastName,
    fullName: [firstName, lastName].filter(Boolean).join(' ') || null,
    numberLast4: number ? number.slice(-4) : null,
    expiresOn: aamvaDate(el.get('DBA'), canadian),
    dateOfBirth: aamvaDate(el.get('DBB'), canadian),
    jurisdiction: el.get('DAJ') ?? null,
  };
}

/** Whole years between an ISO birth date and an ISO day. */
export function ageOn(dateOfBirth: string, day: string): number {
  const [by, bm, bd] = dateOfBirth.split('-').map(Number);
  const [y, m, d] = day.split('-').map(Number);
  return y - by - (m < bm || (m === bm && d < bd) ? 1 : 0);
}

const tokens = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter(Boolean);

/**
 * Whether the name on an ID plausibly belongs to the booking's guest: the
 * same family name, and a first name that matches or starts the same way
 * ("Bob" vs "Robert" still needs a person to look). Order doesn't matter.
 */
export function namesMatch(nameOnId: string, guestName: string): boolean {
  const a = tokens(nameOnId);
  const b = tokens(guestName);
  if (!a.length || !b.length) return false;
  const lastB = b[b.length - 1];
  const lastA = a[a.length - 1];
  const familyMatch = a.includes(lastB) || b.includes(lastA);
  if (!familyMatch) return false;
  const firstA = a[0] === lastB && a.length > 1 ? a[1] : a[0];
  const firstB = b[0];
  return firstA === firstB || firstA.startsWith(firstB) || firstB.startsWith(firstA) || (a.length === 1 || b.length === 1);
}
