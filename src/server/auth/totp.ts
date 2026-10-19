/**
 * Two-step sign-in codes: TOTP (RFC 6238 — HMAC-SHA1, 6 digits, 30-second
 * steps), the same codes Google Authenticator, 1Password, Authy and Microsoft
 * Authenticator show. Recovery codes are single-use and stored as SHA-256.
 */
import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'crypto';
import { sha256 } from '../vault';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP_SECONDS = 30;
const DIGITS = 6;

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = ALPHABET.indexOf(ch);
    if (idx < 0) throw new Error('Invalid base32 character.');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A new 160-bit secret, base32 (what authenticator apps expect). */
export const newTotpSecret = () => base32Encode(randomBytes(20));

/** The code for one 30-second step. */
export function totpAt(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  const bin = ((mac[offset] & 0x7f) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3];
  return String(bin % 10 ** DIGITS).padStart(DIGITS, '0');
}

export const stepAt = (ms: number = Date.now()) => Math.floor(ms / 1000 / STEP_SECONDS);

/**
 * True when `code` matches the current step or one step either side (clock
 * drift). Returns the matching step so callers could refuse a replay.
 */
export function verifyTotp(secret: string, code: string, ms: number = Date.now()): number | null {
  const given = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(given)) return null;
  const now = stepAt(ms);
  for (const step of [now, now - 1, now + 1]) {
    const expected = totpAt(secret, step);
    if (timingSafeEqual(Buffer.from(expected), Buffer.from(given))) return step;
  }
  return null;
}

/** otpauth:// URI the authenticator app scans. */
export function otpauthUri(secret: string, account: string, issuer: string): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`;
}

// ---------------------------------------------------------------------------
// Recovery codes
// ---------------------------------------------------------------------------

const RECOVERY_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

const normaliseRecovery = (code: string) => code.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Ten codes like "k7m2-9qxp", shown once; store `hashRecoveryCode` of each. */
export function newRecoveryCodes(count = 10): string[] {
  return Array.from({ length: count }, () => {
    let s = '';
    for (let i = 0; i < 8; i++) s += RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)];
    return `${s.slice(0, 4)}-${s.slice(4)}`;
  });
}

export const hashRecoveryCode = (code: string) => sha256(`recovery:${normaliseRecovery(code)}`);

/** The stored hashes without the one that matched, or null when none did. */
export function spendRecoveryCode(hashes: string[], code: string): string[] | null {
  const h = hashRecoveryCode(code);
  if (normaliseRecovery(code).length !== 8 || !hashes.includes(h)) return null;
  return hashes.filter((x) => x !== h);
}
