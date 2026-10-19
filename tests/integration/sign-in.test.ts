import { describe, expect, it } from 'vitest';
import { prisma } from '@/lib/prisma';
import { requestPasswordReset, resetPassword } from '@/server/auth/account';
import { passwordSignIn } from '@/server/auth/signin';
import { consumeToken, issueToken } from '@/server/auth/tokens';
import { hashRecoveryCode, newTotpSecret, totpAt, stepAt } from '@/server/auth/totp';
import { seal } from '@/server/vault';
import { makeUser, uid } from './fixtures';

const PASSWORD = 'harbor lights 2026';
const ip = () => `10.0.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;

describe('password sign-in', () => {
  it('signs in with the right password, case-insensitive email', async () => {
    const u = await makeUser({ role: 'MANAGER', password: PASSWORD });
    const r = await passwordSignIn({ email: u.email.toUpperCase(), password: PASSWORD, ip: ip() });
    expect(r?.id).toBe(u.id);
    expect(await passwordSignIn({ email: u.email, password: 'wrong password!', ip: ip() })).toBeNull();
  });

  it('locks an email after 8 failures, even with the right password', async () => {
    const u = await makeUser({ password: PASSWORD });
    for (let i = 0; i < 8; i++) expect(await passwordSignIn({ email: u.email, password: `guess-${i}-xxxx`, ip: ip() })).toBeNull();
    await expect(passwordSignIn({ email: u.email, password: PASSWORD, ip: ip() })).rejects.toMatchObject({ code: 'rate_limited' });
  });

  it('asks for the authenticator code, accepts it, and spends a recovery code once', async () => {
    const u = await makeUser({ password: PASSWORD });
    const secret = newTotpSecret();
    await prisma.user.update({ where: { id: u.id }, data: { mfaEnabled: true, mfaSecretCipher: seal(secret, `mfa:${u.id}`), mfaRecoveryCodes: [hashRecoveryCode('abcd-efgh')] } });
    await expect(passwordSignIn({ email: u.email, password: PASSWORD, ip: ip() })).rejects.toMatchObject({ code: 'mfa_required' });
    await expect(passwordSignIn({ email: u.email, password: PASSWORD, otp: '000000', ip: ip() })).rejects.toMatchObject({ code: 'mfa_invalid' });
    expect((await passwordSignIn({ email: u.email, password: PASSWORD, otp: totpAt(secret, stepAt()), ip: ip() }))?.id).toBe(u.id);
    expect((await passwordSignIn({ email: u.email, password: PASSWORD, otp: 'ABCD-EFGH', ip: ip() }))?.id).toBe(u.id);
    await expect(passwordSignIn({ email: u.email, password: PASSWORD, otp: 'abcd-efgh', ip: ip() })).rejects.toMatchObject({ code: 'mfa_invalid' });
  });

  it('sends SSO organizations to their identity provider', async () => {
    const domain = `sso-${uid()}.example`;
    const u = await makeUser({ password: PASSWORD, email: `ana@${domain}` });
    await prisma.organization.create({
      data: { name: 'Group', slug: `g-${uid()}`, ssoEnabled: true, ssoEnforced: true, ssoDomains: [domain], ssoIssuer: 'https://idp.example', ssoClientId: 'x', members: { create: { userId: u.id } } },
    });
    await expect(passwordSignIn({ email: u.email, password: PASSWORD, ip: ip() })).rejects.toMatchObject({ code: 'sso_required' });
  });
});

describe('password reset', () => {
  it('works once, verifies the email and signs out everywhere', async () => {
    const u = await makeUser({ password: PASSWORD });
    const token = await issueToken(u.id, 'RESET_PASSWORD');
    await expect(resetPassword({ token, password: 'short' })).rejects.toThrow(/10 characters/);
    const fresh = await issueToken(u.id, 'RESET_PASSWORD');
    // The earlier link stopped working when a new one was issued.
    expect(await consumeToken(token, 'RESET_PASSWORD')).toBeNull();
    await resetPassword({ token: fresh, password: 'a brand new passphrase' });
    const after = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(after.sessionVersion).toBe(1);
    expect(after.emailVerifiedAt).not.toBeNull();
    await expect(resetPassword({ token: fresh, password: 'another passphrase!' })).rejects.toThrow(/expired or was already used/);
    expect((await passwordSignIn({ email: u.email, password: 'a brand new passphrase', ip: ip() }))?.id).toBe(u.id);
  });

  it('answers the same for unknown emails and limits requests per address', async () => {
    const u = await makeUser({ password: PASSWORD });
    await requestPasswordReset({ email: `nobody-${uid()}@example.com`, ip: ip() });
    for (let i = 0; i < 5; i++) await requestPasswordReset({ email: u.email, ip: ip() });
    // Three links an hour at most for one address.
    expect(await prisma.authToken.count({ where: { userId: u.id, kind: 'RESET_PASSWORD' } })).toBe(3);
  });
});
