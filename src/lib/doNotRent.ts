/**
 * Do Not Rent matching keys. Client-safe: the New reservation form and the
 * server compare guests the same way.
 */

/** Lower-cased, trimmed email, or null when there isn't a usable one. */
export function emailKey(email: string | null | undefined): string | null {
  const e = (email ?? '').trim().toLowerCase();
  return e.includes('@') ? e : null;
}

/**
 * The last 10 digits of a phone number, so "+1 (555) 010-2030" and
 * "555.010.2030" match. Fewer than 7 digits is too little to match on.
 */
export function phoneKey(phone: string | null | undefined): string | null {
  const digits = (phone ?? '').replace(/\D/g, '');
  return digits.length >= 7 ? digits.slice(-10) : null;
}
