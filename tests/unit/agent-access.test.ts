import { describe, expect, it } from 'vitest';
import { can, roleCan, type Actor } from '@/server/authz';
import { accessSwitches, alertsFor, CAPABILITIES, DEFAULT_ALERTS, parsePolicy, policyFromUpdate } from '@/server/agent/policy';
import { alertMessage, isQuietHour, type Notice } from '@/server/agent/watch';
import { draftFrom, POLICY_ROLES, type AgentAccessUpdate, type PolicyRole } from '@/lib/agent/access';

/** Every switch at the role's default. */
function defaults(): Pick<AgentAccessUpdate, 'capabilities' | 'alerts'> {
  return {
    capabilities: Object.fromEntries(POLICY_ROLES.map((r) => [r, Object.fromEntries(CAPABILITIES.map((c) => [c.key, c.perms.every((p) => roleCan(r, p))]))])) as AgentAccessUpdate['capabilities'],
    alerts: { OWNER: [...DEFAULT_ALERTS.OWNER], MANAGER: [...DEFAULT_ALERTS.MANAGER], FRONT_DESK: [...DEFAULT_ALERTS.FRONT_DESK], HOUSEKEEPER: [...DEFAULT_ALERTS.HOUSEKEEPER] },
  };
}

const actor = (role: Actor['role'], overrides?: Actor['overrides']): Actor => ({
  userId: 'u1',
  role,
  name: 'Test',
  email: 't@example.com',
  propertyIds: ['p1'],
  orgAdminOf: [],
  orgIds: [],
  mfaEnabled: false,
  emailVerified: true,
  mfaSetupRequired: false,
  overrides,
});

describe('agent access', () => {
  it('stores nothing while every switch is at its default', () => {
    expect(policyFromUpdate(defaults())).toEqual({});
  });

  it('stores revocations and grants against the role defaults', () => {
    const u = defaults();
    u.capabilities.FRONT_DESK.checkin = false;
    u.capabilities.FRONT_DESK.reports = true;
    u.capabilities.HOUSEKEEPER.agent = true;
    u.capabilities.HOUSEKEEPER.whatsapp = true;
    expect(policyFromUpdate(u)).toEqual({
      FRONT_DESK: { grant: ['analytics.view'], revoke: ['booking.checkin', 'booking.checkout'] },
      HOUSEKEEPER: { grant: ['agent.use', 'whatsapp.use'] },
    });
  });

  it('turns booking changes off with look-ups, and grants them only with look-ups', () => {
    const u = defaults();
    u.capabilities.MANAGER.agent = false;
    u.capabilities.FRONT_DESK.lookup = false;
    u.capabilities.HOUSEKEEPER.agent = true;
    u.capabilities.HOUSEKEEPER.checkin = true;
    u.capabilities.HOUSEKEEPER.notes = true;
    u.capabilities.HOUSEKEEPER.whatsapp = true;
    expect(policyFromUpdate(u)).toEqual({
      // WhatsApp needs the agent.
      MANAGER: { revoke: ['agent.use', 'whatsapp.use'] },
      FRONT_DESK: { revoke: ['frontdesk.view', 'booking.view', 'booking.checkin', 'booking.checkout', 'booking.assignRoom', 'booking.note', 'booking.confirm', 'booking.cancel', 'booking.noShow'] },
      HOUSEKEEPER: { grant: ['agent.use', 'whatsapp.use'] },
    });
    u.capabilities.HOUSEKEEPER.lookup = true;
    expect(policyFromUpdate(u).HOUSEKEEPER).toEqual({ grant: ['agent.use', 'whatsapp.use', 'frontdesk.view', 'booking.view', 'booking.checkin', 'booking.checkout', 'booking.note'] });
  });

  it('locks a switch while what it needs is off, and keeps what is stored', () => {
    const u = defaults();
    u.capabilities.FRONT_DESK.lookup = false;
    const view = accessSwitches(parsePolicy(policyFromUpdate(u)));
    const cell = (key: string, role: PolicyRole) => view.capabilities.find((c) => c.key === key)!.cells[role];
    expect(cell('checkin', 'FRONT_DESK')).toEqual({ on: false, byDefault: true, locked: 'Turn on “Look up guests and bookings” for front desk first.' });
    expect(cell('reservations', 'HOUSEKEEPER')).toEqual({ on: false, byDefault: false, locked: 'Turn on “Look up guests and bookings” for housekeeping first.' });
    expect(cell('whatsapp', 'HOUSEKEEPER').locked).toBe('Turn on “Use the agent” for housekeeping first.');
    expect(cell('checkin', 'MANAGER').locked).toBeUndefined();
    // The front desk alert can't reach front desk without look-ups, but stays on the list.
    expect(view.alerts.find((a) => a.kind === 'frontdesk')!.cells.FRONT_DESK).toEqual({ on: true, byDefault: true, locked: 'Turn on “Look up guests and bookings” for front desk first.' });
  });

  it('saves locked switches as they were stored', () => {
    const u = defaults();
    u.capabilities.FRONT_DESK.lookup = false;
    // What the page sends after turning look-ups back on (draftFrom builds its draft).
    const draft = draftFrom(accessSwitches(parsePolicy(policyFromUpdate(u))));
    expect(policyFromUpdate(draft)).toEqual(policyFromUpdate(u));
    draft.capabilities.FRONT_DESK.lookup = true;
    expect(alertsFor(parsePolicy(policyFromUpdate(draft)), 'FRONT_DESK')).toEqual(DEFAULT_ALERTS.FRONT_DESK);
  });

  it('stores alert lists only when they differ from the defaults', () => {
    const u = defaults();
    u.alerts.OWNER = ['disputes'];
    expect(policyFromUpdate(u)).toEqual({ OWNER: { alerts: ['disputes'] } });
    const p = parsePolicy(policyFromUpdate(u));
    expect(alertsFor(p, 'OWNER')).toEqual(['disputes']);
    expect(alertsFor(p, 'MANAGER')).toEqual(DEFAULT_ALERTS.MANAGER);
    expect(alertsFor(p, 'ADMIN')).toEqual([]);
  });

  it('never stores more than an owner holds, or changes for owners', () => {
    const p = parsePolicy({
      FRONT_DESK: { grant: ['property.delete', 'rates.write', 'not.a.permission'], revoke: ['rates.write', 'booking.checkin'] },
      OWNER: { grant: ['property.delete'], revoke: ['agent.use'] },
    });
    expect(p.FRONT_DESK?.granted).toEqual(['rates.write']);
    // rates.write isn't a front-desk default, so there's nothing to revoke.
    expect(p.FRONT_DESK?.revoked).toEqual(['booking.checkin']);
    expect(p.OWNER?.granted).toEqual([]);
    expect(p.OWNER?.revoked).toEqual([]);
  });

  it('applies overrides in can(): revoked beats the role, granted adds to it', () => {
    expect(can(actor('FRONT_DESK'), 'booking.checkin')).toBe(true);
    expect(can(actor('FRONT_DESK', { granted: [], revoked: ['booking.checkin'] }), 'booking.checkin')).toBe(false);
    expect(can(actor('HOUSEKEEPER'), 'agent.use')).toBe(false);
    expect(can(actor('HOUSEKEEPER', { granted: ['agent.use'], revoked: [] }), 'agent.use')).toBe(true);
    expect(can(actor('FRONT_DESK', { granted: ['rates.write'], revoked: ['rates.write'] }), 'rates.write')).toBe(false);
  });
});

describe('always-on alerts', () => {
  it('keeps quiet from 10pm to 7am', () => {
    expect([21, 22, 23, 0, 6, 7].map(isQuietHour)).toEqual([false, true, true, true, true, false]);
  });

  it('turns notices into one message with numbered fixes for that hotel', () => {
    const notices: Notice[] = [
      { key: 'a', kind: 'frontdesk', urgent: false, title: '2 overdue check-outs', detail: 'Smith (due Oct 19)', action: { label: 'Check out Smith', command: 'check out Smith' } },
      { key: 'b', kind: 'disputes', urgent: true, title: 'Card dispute: $150', href: '/admin/disputes?dispute=d1' },
    ];
    const m = alertMessage('Harbor Inn', notices, 'https://hotelone.site', 'p1');
    expect(m.text).toContain('🔔 *Harbor Inn* — 2 things need you');
    expect(m.text).toContain('Reply *1* to: Check out Smith');
    expect(m.text).toContain('https://hotelone.site/admin/disputes?dispute=d1');
    expect(m.choices).toEqual(['#at:p1|check out Smith']);
    expect(m.summary).toBe('2 overdue check-outs; Card dispute: $150');
  });
});
