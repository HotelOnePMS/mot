import { describe, expect, it } from 'vitest';
import { actorFromUser, can, canManageOrg, scopeByProperty, type ActorSource } from '@/server/authz';

const base: ActorSource = {
  id: 'u1',
  role: 'OWNER',
  firstName: 'Maya',
  lastName: 'Lopez',
  email: 'maya@harbor.com',
  mfaEnabled: false,
  emailVerifiedAt: null,
  assignedProperties: [{ propertyId: 'p1' }],
  organizations: [],
};

describe('tenancy', () => {
  it('scopes staff to their assigned hotels', () => {
    const a = actorFromUser(base, 'password');
    expect(a.propertyIds).toEqual(['p1']);
    expect(scopeByProperty(a)).toEqual({ propertyId: { in: ['p1'] } });
  });

  it('gives organization administrators every hotel in the group', () => {
    const a = actorFromUser(
      { ...base, organizations: [{ role: 'ADMIN', organizationId: 'o1', organization: { requireMfa: false, properties: [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }] } }] },
      'password',
    );
    expect([...(a.propertyIds as string[])].sort()).toEqual(['p1', 'p2', 'p3']);
    expect(a.orgAdminOf).toEqual(['o1']);
    expect(canManageOrg(a, 'o1')).toBe(true);
    expect(canManageOrg(a, 'o2')).toBe(false);
  });

  it('members of a group only get their own hotels', () => {
    const a = actorFromUser(
      { ...base, role: 'FRONT_DESK', organizations: [{ role: 'MEMBER', organizationId: 'o1', organization: { requireMfa: false, properties: [{ id: 'p2' }] } }] },
      'password',
    );
    expect(a.propertyIds).toEqual(['p1']);
    expect(canManageOrg(a, 'o1')).toBe(false);
  });

  it('platform admins see everything', () => {
    const a = actorFromUser({ ...base, role: 'ADMIN' }, 'password');
    expect(a.propertyIds).toBe('ALL');
    expect(scopeByProperty(a)).toEqual({});
    expect(canManageOrg(a, 'any')).toBe(true);
  });
});

describe('required two-step sign-in', () => {
  const required = { ...base, organizations: [{ role: 'MEMBER', organizationId: 'o1', organization: { requireMfa: true, properties: [] } }] };

  it('blocks password sessions until it is set up', () => {
    expect(actorFromUser(required, 'password').mfaSetupRequired).toBe(true);
    expect(actorFromUser({ ...required, mfaEnabled: true }, 'password').mfaSetupRequired).toBe(false);
  });

  it('trusts the identity provider for SSO sessions', () => {
    expect(actorFromUser(required, 'sso').mfaSetupRequired).toBe(false);
  });

  it('never applies to guests', () => {
    expect(actorFromUser({ ...required, role: 'CUSTOMER' }, 'password').mfaSetupRequired).toBe(false);
  });
});

describe('permissions', () => {
  it('lets the front desk take reservations and close the day, not change taxes', () => {
    const fd = { role: 'FRONT_DESK' as const };
    expect(can(fd, 'booking.create')).toBe(true);
    expect(can(fd, 'audit.run')).toBe(true);
    expect(can(fd, 'charges.manage')).toBe(false);
    expect(can({ role: 'HOUSEKEEPER' }, 'booking.create')).toBe(false);
    expect(can({ role: 'MANAGER' }, 'org.manage')).toBe(false);
  });
});
