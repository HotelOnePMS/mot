/**
 * Password rules for new passwords (sign-up, reset, staff accounts). Existing
 * passwords keep working; the rules apply the next time one is set.
 */
import bcrypt from 'bcryptjs';

export const PASSWORD_MIN = 10;
export const BCRYPT_ROUNDS = 12;

// The most common passwords that still pass the length rule.
const COMMON = new Set([
  'password12', 'password123', 'password1234', '1234567890', '0123456789', 'qwertyuiop', 'iloveyou12', 'letmein123', 'welcome123',
  'admin12345', 'qwerty1234', 'abcdefghij', 'abc1234567', 'passw0rd12', 'hotelone12', 'hotelone123', 'changeme12', 'football12',
]);

/** Why this password can't be used, or null when it's fine. */
export function passwordProblem(password: string, context: { email?: string | null; name?: string | null } = {}): string | null {
  if (password.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters.`;
  if (password.length > 200) return 'Use at most 200 characters.';
  const lower = password.toLowerCase();
  if (COMMON.has(lower)) return 'That password is too common. Choose another one.';
  if (/^(.)\1+$/.test(password)) return 'Don’t repeat one character.';
  const local = context.email?.split('@')[0]?.toLowerCase();
  if (local && local.length >= 4 && lower.includes(local)) return 'Don’t use your email address in your password.';
  return null;
}

export const hashPassword = (password: string) => bcrypt.hash(password, BCRYPT_ROUNDS);
