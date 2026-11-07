import { describe, expect, it } from 'vitest';
import { passwordProblem } from '@/server/auth/passwords';
import { ssoEnforcedFor } from '@/server/auth/signin';
import { openState, safeCallbackUrl, sealState } from '@/server/auth/sso';
import { ScimError, parseFilter } from '@/server/auth/scim';
import { normaliseDomains } from '@/server/services/organizations';

describe('password rules', () => {
  it('asks for length and refuses obvious passwords', () => {
    expect(passwordProblem('short1')).toMatch(/10 characters/);
    expect(passwordProblem('password123')).toMatch(/too common/);
    expect(passwordProblem('aaaaaaaaaaaa')).toMatch(/repeat/);
    expect(passwordProblem('maya.lopez-2026', { email: 'maya.lopez@hotel.com' })).toMatch(/email/);
    expect(passwordProblem('correct horse battery')).toBeNull();
  });
});

describe('SSO', () => {
  const orgs = [{ ssoEnabled: true, ssoEnforced: true, ssoDomains: ['harbor.com'] }];

  it('requires SSO only for enforced domains', () => {
    expect(ssoEnforcedFor('ana@Harbor.com', orgs)).toBe(true);
    expect(ssoEnforcedFor('ana@gmail.com', orgs)).toBe(false);
    expect(ssoEnforcedFor('ana@harbor.com', [{ ...orgs[0], ssoEnforced: false }])).toBe(false);
  });

  it('signs the state cookie and refuses tampering or expiry', () => {
    const state = { o: 'org1', s: 'state', n: 'nonce', v: 'verifier', c: '/admin', e: Date.now() + 60_000 };
    const sealed = sealState(state);
    expect(openState(sealed)).toEqual(state);
    // Flip the first signature character: every bit of it is significant, unlike the
    // last one, whose low bits base64url decoding ignores (so 'A' -> 'B' there is a no-op).
    expect(openState(sealed.replace(/\.(.)/, (_, c) => `.${c === 'A' ? 'B' : 'A'}`))).toBeNull();
    expect(openState(sealState({ ...state, e: Date.now() - 1 }))).toBeNull();
    expect(openState(undefined)).toBeNull();
  });

  it('follows only same-site paths after sign-in', () => {
    expect(safeCallbackUrl('/admin/front-desk')).toBe('/admin/front-desk');
    expect(safeCallbackUrl('https://evil.example')).toBe('/admin');
    expect(safeCallbackUrl('//evil.example')).toBe('/admin');
    expect(safeCallbackUrl('/\\evil.example')).toBe('/admin');
  });

  it('cleans email domains', () => {
    expect(normaliseDomains([' Harbor.com ', '@harbor.co.uk', 'harbor.com'])).toEqual(['harbor.com', 'harbor.co.uk']);
    expect(() => normaliseDomains(['not a domain'])).toThrow(/isn’t an email domain/);
  });
});

describe('SCIM filters', () => {
  it('understands the filters identity providers send', () => {
    expect(parseFilter('userName eq "ana@harbor.com"')).toEqual({ field: 'email', value: 'ana@harbor.com' });
    expect(parseFilter('externalId eq "00u1"')).toEqual({ field: 'externalId', value: '00u1' });
    expect(parseFilter('emails[type eq "work"].value eq "a@b.co"')).toEqual({ field: 'email', value: 'a@b.co' });
    expect(parseFilter(null)).toBeNull();
    expect(() => parseFilter('displayName co "Ana"')).toThrow(ScimError);
  });
});
