/**
 * Rate limits and lockouts for sign-in, sign-up, password reset and
 * verification emails, shared by every server instance (rows in
 * auth_attempts). Keys are hashed, so the table holds no emails or IPs.
 *
 * Sign-in: 8 failed attempts for one email in 15 minutes locks that email
 * for the rest of the window; 40 failures from one IP blocks the IP. A
 * success clears neither (the window simply passes), so guessing stays slow.
 */
import { createHash } from 'crypto';
import { prisma } from '@/lib/prisma';
import { DomainError } from '../errors';

const MINUTE = 60_000;

export interface LimitRule {
  /** Already-hashed key from `limitKey`. */
  key: string;
  max: number;
  windowMs: number;
  /** Count only failures (sign-in) or every attempt (sign-up, reset emails). */
  failuresOnly?: boolean;
}

export const limitKey = (kind: string, value: string) =>
  `${kind}:${createHash('sha256').update(`${kind}|${value.trim().toLowerCase()}`).digest('hex').slice(0, 40)}`;

export const LOGIN_EMAIL = (email: string): LimitRule => ({ key: limitKey('login-email', email), max: 8, windowMs: 15 * MINUTE, failuresOnly: true });
export const LOGIN_IP = (ip: string): LimitRule => ({ key: limitKey('login-ip', ip), max: 40, windowMs: 15 * MINUTE, failuresOnly: true });
export const SIGNUP_IP = (ip: string): LimitRule => ({ key: limitKey('signup-ip', ip), max: Number(process.env.SIGNUP_MAX_PER_IP_HOUR || 10), windowMs: 60 * MINUTE });
export const RESET_IP = (ip: string): LimitRule => ({ key: limitKey('reset-ip', ip), max: 10, windowMs: 60 * MINUTE });
export const RESET_EMAIL = (email: string): LimitRule => ({ key: limitKey('reset-email', email), max: 3, windowMs: 60 * MINUTE });
export const VERIFY_USER = (userId: string): LimitRule => ({ key: limitKey('verify-user', userId), max: 5, windowMs: 60 * MINUTE });
export const MFA_USER = (userId: string): LimitRule => ({ key: limitKey('mfa-user', userId), max: 8, windowMs: 15 * MINUTE, failuresOnly: true });

async function used(rule: LimitRule): Promise<number> {
  return prisma.authAttempt.count({
    where: { key: rule.key, createdAt: { gte: new Date(Date.now() - rule.windowMs) }, ...(rule.failuresOnly ? { ok: false } : {}) },
  });
}

/** The first rule that is already at its limit, or null. */
export async function blockedBy(rules: LimitRule[]): Promise<LimitRule | null> {
  for (const rule of rules) if ((await used(rule)) >= rule.max) return rule;
  return null;
}

/** Throws 429 when any rule is at its limit. */
export async function assertWithinLimits(rules: LimitRule[], message = 'Too many attempts. Please wait a few minutes and try again.'): Promise<void> {
  if (await blockedBy(rules)) throw new DomainError(429, 'RATE_LIMITED', message);
}

export async function recordAttempt(rules: LimitRule[], ok: boolean): Promise<void> {
  if (!rules.length) return;
  await prisma.authAttempt.createMany({ data: rules.map((r) => ({ key: r.key, ok })) });
  // Old rows are only needed for the longest window (an hour); sweep now and then.
  if (Math.random() < 0.02) {
    prisma.authAttempt.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 24 * 60 * MINUTE) } } }).catch(() => undefined);
  }
}
