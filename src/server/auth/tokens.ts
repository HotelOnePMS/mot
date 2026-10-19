/**
 * Single-use tokens sent by email (password reset, email verification) or
 * handed from the SSO callback to the sign-in page. Only the SHA-256 is
 * stored; a token works once and before it expires.
 */
import { prisma } from '@/lib/prisma';
import { randomToken, sha256 } from '../vault';

export type AuthTokenKind = 'RESET_PASSWORD' | 'VERIFY_EMAIL' | 'SSO_TICKET';

export const TOKEN_TTL_MS: Record<AuthTokenKind, number> = {
  RESET_PASSWORD: 60 * 60_000,
  VERIFY_EMAIL: 3 * 24 * 60 * 60_000,
  SSO_TICKET: 2 * 60_000,
};

/** A new token for this person; earlier unused tokens of the same kind stop working. */
export async function issueToken(userId: string, kind: AuthTokenKind): Promise<string> {
  const token = randomToken(32);
  await prisma.$transaction([
    prisma.authToken.updateMany({ where: { userId, kind, usedAt: null }, data: { usedAt: new Date() } }),
    prisma.authToken.create({ data: { userId, kind, tokenHash: sha256(`${kind}:${token}`), expiresAt: new Date(Date.now() + TOKEN_TTL_MS[kind]) } }),
  ]);
  return token;
}

/**
 * Marks the token used and returns its user id, or null when it is unknown,
 * used or expired. Claiming is atomic, so a token can't be spent twice.
 */
export async function consumeToken(token: string, kind: AuthTokenKind): Promise<string | null> {
  if (!token || token.length > 200) return null;
  const tokenHash = sha256(`${kind}:${token}`);
  const row = await prisma.authToken.findUnique({ where: { tokenHash }, select: { id: true, userId: true, kind: true, usedAt: true, expiresAt: true } });
  if (!row || row.kind !== kind || row.usedAt || row.expiresAt < new Date()) return null;
  const claimed = await prisma.authToken.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } });
  return claimed.count === 1 ? row.userId : null;
}
