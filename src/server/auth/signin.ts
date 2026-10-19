/**
 * Email + password sign-in, with lockouts, two-step codes and SSO-only
 * organizations. Called from the NextAuth credentials provider (lib/auth.ts);
 * kept here so it can be tested without NextAuth.
 *
 * Error codes reach the login page through NextAuth's `code`, so they say
 * what to do next without saying whether the email exists:
 *   rate_limited   too many failures for this email or this network
 *   mfa_required   password right; ask for the authenticator code
 *   mfa_invalid    that code (or recovery code) didn't match
 *   sso_required   the person's organization signs in with its identity provider
 */
import bcrypt from 'bcryptjs';
import { CredentialsSignin } from 'next-auth';
import { prisma } from '@/lib/prisma';
import { open } from '../vault';
import { LOGIN_EMAIL, LOGIN_IP, MFA_USER, blockedBy, recordAttempt } from './limits';
import { spendRecoveryCode, verifyTotp } from './totp';

export type SignInCode = 'rate_limited' | 'mfa_required' | 'mfa_invalid' | 'sso_required';

export class SignInRefused extends CredentialsSignin {
  constructor(code: SignInCode) {
    super(code);
    this.code = code;
  }
}

// Compared against when the email is unknown, so the response takes as long either way.
const DUMMY_HASH = '$2b$12$K4Q2YeLqjsDi1QvxRx89w.xgwYmKP.u9BWoLEcmV0t5sfO19vzGxa';

export interface SignedInUser {
  id: string;
  email: string;
  name: string;
  role: string;
  sessionVersion: number;
}

/** Organizations that make this person sign in through SSO. */
export function ssoEnforcedFor(email: string, orgs: { ssoEnabled: boolean; ssoEnforced: boolean; ssoDomains: string[] }[]): boolean {
  const domain = email.split('@')[1]?.toLowerCase();
  return !!domain && orgs.some((o) => o.ssoEnabled && o.ssoEnforced && o.ssoDomains.map((d) => d.toLowerCase()).includes(domain));
}

export async function passwordSignIn(input: { email: string; password: string; otp?: string | null; ip: string }): Promise<SignedInUser | null> {
  const email = input.email.trim();
  const rules = [LOGIN_EMAIL(email), LOGIN_IP(input.ip)];
  if (await blockedBy(rules)) throw new SignInRefused('rate_limited');

  const user = await prisma.user.findFirst({
    where: { email: { equals: email, mode: 'insensitive' }, isActive: true },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      role: true,
      password: true,
      mfaEnabled: true,
      mfaSecretCipher: true,
      mfaRecoveryCodes: true,
      sessionVersion: true,
      organizations: { select: { organization: { select: { ssoEnabled: true, ssoEnforced: true, ssoDomains: true } } } },
    },
  });

  // OAuth- and SSO-only people have no password hash and can never match.
  const ok = await bcrypt.compare(input.password, user?.password || DUMMY_HASH);
  if (!user || !user.password || !ok) {
    await recordAttempt(rules, false);
    return null;
  }

  if (ssoEnforcedFor(user.email, user.organizations.map((m) => m.organization))) throw new SignInRefused('sso_required');

  if (user.mfaEnabled && user.mfaSecretCipher) {
    const code = input.otp?.trim();
    if (!code) throw new SignInRefused('mfa_required');
    const mfaRule = MFA_USER(user.id);
    if (await blockedBy([mfaRule])) throw new SignInRefused('rate_limited');
    const secret = open<string>(user.mfaSecretCipher, `mfa:${user.id}`);
    let accepted = verifyTotp(secret, code) !== null;
    if (!accepted) {
      const remaining = spendRecoveryCode(user.mfaRecoveryCodes, code);
      if (remaining) {
        // Spend the code atomically: a second use loses the race and fails.
        const spent = await prisma.user.updateMany({
          where: { id: user.id, mfaRecoveryCodes: { equals: user.mfaRecoveryCodes } },
          data: { mfaRecoveryCodes: remaining },
        });
        accepted = spent.count === 1;
      }
    }
    if (!accepted) {
      await recordAttempt([...rules, mfaRule], false);
      throw new SignInRefused('mfa_invalid');
    }
  }

  await recordAttempt(rules, true);
  return {
    id: user.id,
    email: user.email,
    name: `${user.firstName} ${user.lastName}`.trim(),
    role: user.role,
    sessionVersion: user.sessionVersion,
  };
}
