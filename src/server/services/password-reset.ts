/**
 * Password reset: one-time, hashed, expiring tokens.
 *
 * The emailed token is random (256 bits); only its SHA-256 is stored, so a
 * database leak does not hand out working reset links. A token works once and
 * for RESET_TTL_MINUTES. Requesting a new link voids the previous ones.
 */
import { createHash, randomBytes } from 'crypto';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { PRODUCT_URL, isDemoEmail } from '@/config/product';
import { publicSiteUrl } from '@/server/public-url';
import { sendPasswordResetEmail } from '@/server/email';
import { badRequest } from '@/server/errors';

export const RESET_TTL_MINUTES = 60;

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

/** Where reset links point. Never taken from request headers (host-header poisoning): a configured address, else the product domain in production. */
function resetBaseUrl(fallbackOrigin: string): string {
  return publicSiteUrl() || (process.env.NODE_ENV === 'production' ? PRODUCT_URL : fallbackOrigin);
}

/**
 * Creates a reset link for the account with this email and sends it. Does nothing
 * (and says nothing) when there is no such active password account, so the
 * caller can answer every request the same way.
 */
export async function requestPasswordReset(email: string, fallbackOrigin: string): Promise<void> {
  const user = await prisma.user.findFirst({
    where: { email: { equals: email.trim(), mode: 'insensitive' }, isActive: true },
    select: { id: true, email: true, firstName: true, password: true },
  });
  // Shared demo logins can't be reset; Google-only accounts have no password to reset.
  if (!user || !user.password || isDemoEmail(user.email)) return;

  const token = randomBytes(32).toString('base64url');
  await prisma.$transaction([
    prisma.passwordResetToken.deleteMany({ where: { userId: user.id } }),
    prisma.passwordResetToken.create({
      data: { userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + RESET_TTL_MINUTES * 60_000) },
    }),
  ]);

  await sendPasswordResetEmail({
    to: user.email,
    firstName: user.firstName,
    resetUrl: `${resetBaseUrl(fallbackOrigin)}/reset-password?token=${encodeURIComponent(token)}`,
    expiresInMinutes: RESET_TTL_MINUTES,
  });
}

/** Sets a new password from a valid link. Throws a user-safe error for an unknown, used or expired link. */
export async function resetPassword(token: string, newPassword: string): Promise<void> {
  const invalid = () => badRequest('This reset link is invalid or has expired. Request a new one.');
  const row = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: hashToken(token) },
    select: { id: true, userId: true, expiresAt: true, usedAt: true, user: { select: { isActive: true, email: true } } },
  });
  if (!row || row.usedAt || row.expiresAt.getTime() < Date.now() || !row.user.isActive || isDemoEmail(row.user.email)) throw invalid();

  const passwordHash = await bcrypt.hash(newPassword, 12);
  // Claim the token first (atomic), so two simultaneous uses can't both win.
  const claimed = await prisma.passwordResetToken.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } });
  if (claimed.count !== 1) throw invalid();
  await prisma.$transaction([
    prisma.user.update({ where: { id: row.userId }, data: { password: passwordHash } }),
    prisma.passwordResetToken.deleteMany({ where: { userId: row.userId, id: { not: row.id } } }),
  ]);
}
