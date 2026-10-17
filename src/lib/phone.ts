/** "+1 (831) 555-0100", "+44 (0)20 7946 0000" or "0044 20 7946 0000" → E.164 ("+18315550100"); null if it isn't an international number. */
export function toE164(raw: string | null | undefined): string | null {
  if (!raw) return null;
  // "+44 (0)20 …": the bracketed 0 is a national trunk prefix, never dialled from abroad.
  let n = raw.trim().replace(/\(\s*0\s*\)/g, '').replace(/[\s().-]/g, '');
  if (n.startsWith('00')) n = `+${n.slice(2)}`;
  return /^\+[1-9]\d{6,14}$/.test(n) ? n : null;
}

/**
 * What Twilio puts in "From" for anonymous, restricted, unavailable, unknown
 * and blocked callers — they look like numbers but nobody answers them.
 */
const WITHHELD = new Set(['+266696687', '+7378742833', '+86282452253', '+8656696', '+2562533']);

/** A caller ID as carriers pass it: E.164 or bare digits. Withheld/anonymous/SIP URIs become null. */
export function callerNumber(raw: string | null | undefined): string | null {
  const n = (raw ?? '').trim().replace(/[\s().-]/g, '');
  if (!/^\+?\d{6,15}$/.test(n)) return null;
  return WITHHELD.has(n.startsWith('+') ? n : `+${n}`) ? null : n;
}
