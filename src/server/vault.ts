/**
 * Small authenticated-encryption vault for secrets we must keep (a hotel's
 * PMS login for the cloud bridge). AES-256-GCM with a random IV; the key
 * comes from HOTELONE_VAULT_KEY (32 bytes, base64) — or STAYOS_VAULT_KEY, the
 * name from before the rename, which is still accepted. Moving to the new
 * name means copying the exact same value: a different key can't open the
 * logins already stored. In development only, a key is derived from
 * NEXTAUTH_SECRET so the demo works out of the box.
 */
import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes, timingSafeEqual } from 'crypto';

let cached: Buffer | null = null;

function key(): Buffer {
  if (cached) return cached;
  const current = process.env.HOTELONE_VAULT_KEY;
  const legacy = process.env.STAYOS_VAULT_KEY;
  const raw = current || legacy;
  if (raw) {
    const name = current ? 'HOTELONE_VAULT_KEY' : 'STAYOS_VAULT_KEY';
    const k = Buffer.from(raw, 'base64');
    if (k.length !== 32) throw new Error(`${name} must be 32 bytes, base64-encoded (openssl rand -base64 32).`);
    if (current && legacy && current !== legacy) {
      console.warn('HOTELONE_VAULT_KEY and STAYOS_VAULT_KEY differ — using HOTELONE_VAULT_KEY. Logins sealed with the other key can’t be opened; give both the same value.');
    }
    cached = k;
    return k;
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('HOTELONE_VAULT_KEY is not set (STAYOS_VAULT_KEY is also accepted) — stored credentials are disabled until it is configured.');
  }
  // Never change these labels or the fallback secret: they derive the key that
  // opens logins already sealed in development databases.
  const secret = process.env.NEXTAUTH_SECRET || 'stayos-dev-secret';
  cached = Buffer.from(hkdfSync('sha256', secret, 'stayos-vault', 'credentials-v1', 32));
  return cached;
}

export function vaultAvailable(): boolean {
  try {
    key();
    return true;
  } catch {
    return false;
  }
}

/** Seal a JSON value. Output: `v1.<iv>.<tag>.<ciphertext>` (base64url parts). */
export function seal(value: unknown, aad = ''): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  if (aad) cipher.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ct.toString('base64url')].join('.');
}

export function open<T = unknown>(sealed: string, aad = ''): T {
  const [v, iv, tag, ct] = sealed.split('.');
  if (v !== 'v1' || !iv || !tag || !ct) throw new Error('Unrecognised sealed value.');
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'));
  if (aad) decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  const pt = Buffer.concat([decipher.update(Buffer.from(ct, 'base64url')), decipher.final()]);
  return JSON.parse(pt.toString('utf8')) as T;
}

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');
