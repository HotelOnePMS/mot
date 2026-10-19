/**
 * Self-service account security: password reset by email, email
 * verification, changing the password, and two-step sign-in (TOTP) with
 * recovery codes. Every change that should end other sessions bumps
 * User.sessionVersion (lib/auth.ts signs those sessions out).
 */
import bcrypt from 'bcryptjs';
import QRCode from 'qrcode';
import { PRODUCT_NAME } from '@/config/product';
import { prisma } from '@/lib/prisma';
import type { Actor } from '../authz';
import { demoHotelLocked } from '../demo';
import { sendAccountEmail } from '../email';
import { DomainError, badRequest } from '../errors';
import { publicSiteUrl } from '../public-url';
import { open, seal, vaultAvailable } from '../vault';
import { MFA_USER, RESET_EMAIL, RESET_IP, VERIFY_USER, assertWithinLimits, blockedBy, recordAttempt } from './limits';
import { hashPassword, passwordProblem } from './passwords';
import { consumeToken, issueToken } from './tokens';
import { hashRecoveryCode, newRecoveryCodes, newTotpSecret, otpauthUri, verifyTotp } from './totp';

const linkBase = (origin?: string) => (publicSiteUrl() ?? origin ?? '').replace(/\/$/, '');

/** The shared demo logins keep their sign-in as it is, so one visitor can't lock the others out. */
function assertNotSharedDemoLogin(actor: Actor) {
  if (demoHotelLocked(actor, false)) throw new DomainError(403, 'DEMO_LOCKED', 'This is a shared demo login, so its sign-in settings stay as they are. Set up your own hotel to try two-step sign-in.');
}

// ---------------------------------------------------------------------------
// Password reset
// ---------------------------------------------------------------------------

/**
 * Email a reset link. Always "succeeds" so the response never says whether
 * an account exists; people who sign in only through SSO or Google get nothing.
 */
export async function requestPasswordReset(input: { email: string; ip: string; origin?: string }): Promise<void> {
  const email = input.email.trim().toLowerCase();
  await assertWithinLimits([RESET_IP(input.ip)], 'Too many reset requests from this network. Please try again in an hour.');
  const rules = [RESET_IP(input.ip), RESET_EMAIL(email)];
  const limited = await blockedBy([RESET_EMAIL(email)]);
  await recordAttempt(rules, true);
  if (limited) return;
  const user = await prisma.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' }, isActive: true }, select: { id: true, firstName: true, email: true, password: true } });
  if (!user || !user.password) return;
  const token = await issueToken(user.id, 'RESET_PASSWORD');
  await sendAccountEmail({ to: user.email, name: user.firstName, kind: 'RESET_PASSWORD', url: `${linkBase(input.origin)}/reset-password?token=${encodeURIComponent(token)}` });
}

/** Set a new password from an emailed link; signs out every session and proves the address. */
export async function resetPassword(input: { token: string; password: string }): Promise<void> {
  const userId = await consumeToken(input.token, 'RESET_PASSWORD');
  if (!userId) throw new DomainError(400, 'TOKEN_INVALID', 'This reset link has expired or was already used. Ask for a new one.');
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true, firstName: true } });
  const problem = passwordProblem(input.password, { email: user.email, name: user.firstName });
  if (problem) throw badRequest(problem);
  await prisma.user.update({
    where: { id: userId },
    data: { password: await hashPassword(input.password), passwordChangedAt: new Date(), emailVerifiedAt: new Date(), sessionVersion: { increment: 1 } },
  });
}

/** Change the password while signed in (needs the current one). Other sessions end. */
export async function changePassword(actor: Actor, input: { current: string; next: string }): Promise<void> {
  assertNotSharedDemoLogin(actor);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: actor.userId }, select: { password: true, email: true, firstName: true } });
  if (user.password && !(await bcrypt.compare(input.current, user.password))) throw badRequest('Your current password isn’t right.');
  const problem = passwordProblem(input.next, { email: user.email, name: user.firstName });
  if (problem) throw badRequest(problem);
  await prisma.user.update({ where: { id: actor.userId }, data: { password: await hashPassword(input.next), passwordChangedAt: new Date(), sessionVersion: { increment: 1 } } });
}

// ---------------------------------------------------------------------------
// Email verification
// ---------------------------------------------------------------------------

export async function sendVerificationEmail(userId: string, origin?: string): Promise<boolean> {
  const rule = VERIFY_USER(userId);
  await assertWithinLimits([rule], 'We’ve sent several emails already. Check your inbox (and spam), or try again in an hour.');
  await recordAttempt([rule], true);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true, firstName: true, emailVerifiedAt: true } });
  if (user.emailVerifiedAt) return false;
  const token = await issueToken(userId, 'VERIFY_EMAIL');
  return sendAccountEmail({ to: user.email, name: user.firstName, kind: 'VERIFY_EMAIL', url: `${linkBase(origin)}/verify-email?token=${encodeURIComponent(token)}` });
}

export async function verifyEmail(token: string): Promise<void> {
  const userId = await consumeToken(token, 'VERIFY_EMAIL');
  if (!userId) throw new DomainError(400, 'TOKEN_INVALID', 'This verification link has expired or was already used. Sign in and ask for a new one.');
  await prisma.user.update({ where: { id: userId }, data: { emailVerifiedAt: new Date() } });
}

// ---------------------------------------------------------------------------
// Two-step sign-in
// ---------------------------------------------------------------------------

export interface MfaStatus {
  enabled: boolean;
  recoveryCodesLeft: number;
  /** The organization requires it (password sign-ins). */
  required: boolean;
  hasPassword: boolean;
  emailVerified: boolean;
  sso: boolean;
}

export async function mfaStatus(actor: Actor): Promise<MfaStatus> {
  const u = await prisma.user.findUniqueOrThrow({
    where: { id: actor.userId },
    select: {
      mfaEnabled: true,
      mfaRecoveryCodes: true,
      password: true,
      emailVerifiedAt: true,
      ssoSubject: true,
      organizations: { select: { organization: { select: { requireMfa: true } } } },
    },
  });
  return {
    enabled: u.mfaEnabled,
    recoveryCodesLeft: u.mfaRecoveryCodes.length,
    required: u.organizations.some((m) => m.organization.requireMfa),
    hasPassword: !!u.password,
    emailVerified: !!u.emailVerifiedAt,
    sso: !!u.ssoSubject,
  };
}

/** Step 1: a new secret (kept, not yet active) and the QR code to scan. */
export async function beginMfaSetup(actor: Actor): Promise<{ secret: string; uri: string; qrSvg: string }> {
  assertNotSharedDemoLogin(actor);
  if (!vaultAvailable()) throw new DomainError(503, 'VAULT_OFF', 'Two-step sign-in isn’t switched on for this server yet (platform admin: set HOTELONE_VAULT_KEY).');
  const u = await prisma.user.findUniqueOrThrow({ where: { id: actor.userId }, select: { mfaEnabled: true, email: true } });
  if (u.mfaEnabled) throw badRequest('Two-step sign-in is already on. Turn it off first to move it to a new device.');
  const secret = newTotpSecret();
  await prisma.user.update({ where: { id: actor.userId }, data: { mfaSecretCipher: seal(secret, `mfa:${actor.userId}`) } });
  const uri = otpauthUri(secret, u.email, PRODUCT_NAME);
  const qrSvg = await QRCode.toString(uri, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
  return { secret, uri, qrSvg };
}

/** Step 2: the first code proves the app is set up; returns the recovery codes (shown once). */
export async function confirmMfaSetup(actor: Actor, code: string): Promise<{ recoveryCodes: string[] }> {
  const rule = MFA_USER(actor.userId);
  await assertWithinLimits([rule]);
  const u = await prisma.user.findUniqueOrThrow({ where: { id: actor.userId }, select: { mfaEnabled: true, mfaSecretCipher: true } });
  if (u.mfaEnabled) throw badRequest('Two-step sign-in is already on.');
  if (!u.mfaSecretCipher) throw badRequest('Start the setup again.');
  const secret = open<string>(u.mfaSecretCipher, `mfa:${actor.userId}`);
  if (verifyTotp(secret, code) === null) {
    await recordAttempt([rule], false);
    throw badRequest('That code didn’t match. Check the time on your phone and enter the code it shows now.');
  }
  const recoveryCodes = newRecoveryCodes();
  // Other sessions predate two-step sign-in: end them.
  await prisma.user.update({
    where: { id: actor.userId },
    data: { mfaEnabled: true, mfaRecoveryCodes: recoveryCodes.map(hashRecoveryCode), sessionVersion: { increment: 1 } },
  });
  return { recoveryCodes };
}

async function assertSecondFactor(actor: Actor, input: { password?: string; code?: string }) {
  const u = await prisma.user.findUniqueOrThrow({ where: { id: actor.userId }, select: { password: true, mfaSecretCipher: true } });
  if (u.password && !(input.password && (await bcrypt.compare(input.password, u.password)))) throw badRequest('Enter your current password.');
  const rule = MFA_USER(actor.userId);
  await assertWithinLimits([rule]);
  if (!u.mfaSecretCipher || verifyTotp(open<string>(u.mfaSecretCipher, `mfa:${actor.userId}`), input.code ?? '') === null) {
    await recordAttempt([rule], false);
    throw badRequest('Enter the current code from your authenticator app.');
  }
}

/** Turn two-step sign-in off (needs the password and a current code). Not allowed when the organization requires it. */
export async function disableMfa(actor: Actor, input: { password?: string; code?: string }): Promise<void> {
  const status = await mfaStatus(actor);
  if (!status.enabled) return;
  if (status.required) throw badRequest('Your organization requires two-step sign-in, so it stays on.');
  await assertSecondFactor(actor, input);
  await prisma.user.update({
    where: { id: actor.userId },
    data: { mfaEnabled: false, mfaSecretCipher: null, mfaRecoveryCodes: [], sessionVersion: { increment: 1 } },
  });
}

export async function regenerateRecoveryCodes(actor: Actor, input: { password?: string; code?: string }): Promise<{ recoveryCodes: string[] }> {
  const status = await mfaStatus(actor);
  if (!status.enabled) throw badRequest('Turn on two-step sign-in first.');
  await assertSecondFactor(actor, input);
  const recoveryCodes = newRecoveryCodes();
  await prisma.user.update({ where: { id: actor.userId }, data: { mfaRecoveryCodes: recoveryCodes.map(hashRecoveryCode) } });
  return { recoveryCodes };
}

/** Sign out every session, this one included. */
export async function signOutEverywhere(actor: Actor): Promise<void> {
  assertNotSharedDemoLogin(actor);
  await prisma.user.update({ where: { id: actor.userId }, data: { sessionVersion: { increment: 1 } } });
}
