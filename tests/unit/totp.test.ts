import { describe, expect, it } from 'vitest';
import { base32Decode, base32Encode, hashRecoveryCode, newRecoveryCodes, newTotpSecret, otpauthUri, totpAt, spendRecoveryCode, verifyTotp } from '@/server/auth/totp';

// RFC 6238 appendix B: SHA-1 seed "12345678901234567890", 8 digits; we use the last 6.
const SEED = base32Encode(Buffer.from('12345678901234567890'));

describe('TOTP', () => {
  it('round-trips base32', () => {
    const buf = Buffer.from([0, 1, 2, 250, 251, 255, 17]);
    expect(base32Decode(base32Encode(buf))).toEqual(buf);
    expect(newTotpSecret()).toMatch(/^[A-Z2-7]{32}$/);
  });

  it('matches the RFC 6238 test vectors', () => {
    expect(totpAt(SEED, Math.floor(59 / 30))).toBe('287082');
    expect(totpAt(SEED, Math.floor(1111111109 / 30))).toBe('081804');
    expect(totpAt(SEED, Math.floor(1234567890 / 30))).toBe('005924');
    expect(totpAt(SEED, Math.floor(2000000000 / 30))).toBe('279037');
  });

  it('accepts the current code and one step of drift, nothing else', () => {
    const t = 1234567890_000;
    const step = Math.floor(t / 30_000);
    expect(verifyTotp(SEED, totpAt(SEED, step), t)).toBe(step);
    expect(verifyTotp(SEED, totpAt(SEED, step - 1), t)).toBe(step - 1);
    expect(verifyTotp(SEED, totpAt(SEED, step + 2), t)).toBeNull();
    expect(verifyTotp(SEED, '12345', t)).toBeNull();
    expect(verifyTotp(SEED, 'abcdef', t)).toBeNull();
  });

  it('builds the otpauth URI apps scan', () => {
    const uri = otpauthUri('ABC', 'maya@hotel.com', 'HotelOne');
    expect(uri).toBe('otpauth://totp/HotelOne%3Amaya%40hotel.com?secret=ABC&issuer=HotelOne&algorithm=SHA1&digits=6&period=30');
  });
});

describe('recovery codes', () => {
  it('works once each, whatever the formatting', () => {
    const codes = newRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    const hashes = codes.map(hashRecoveryCode);
    const left = spendRecoveryCode(hashes, codes[3].toUpperCase().replace('-', ' '));
    expect(left).toHaveLength(9);
    expect(spendRecoveryCode(left!, codes[3])).toBeNull();
    expect(spendRecoveryCode(hashes, 'nope-nope')).toBeNull();
  });
});
