import { describe, expect, it } from 'vitest';
import { can, roleCan, type Actor } from '@/server/authz';
import { accessSwitches, alertsFor, CAPABILITIES, DEFAULT_ALERTS, parsePolicy, policyFromUpdate } from '@/server/agent/policy';
import { alertMessage, isQuietHour, type Notice } from '@/server/agent/watch';
import { draftFrom, draftSwitches, POLICY_ROLES, updateFromDraft, type AgentAccessUpdate, type NoticeKind, type PolicyRole } from '@/lib/agent/access';

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
    // The server says what each switch needs; the page locks it from its draft, which starts as what's stored.
    expect(view.capabilities.find((c) => c.key === 'checkin')!.cells.FRONT_DESK).toEqual({ on: false, byDefault: true, needs: ['lookup'] });
    const shown = draftSwitches(view, draftFrom(view));
    const cell = (key: string, role: PolicyRole) => shown.capabilities.find((c) => c.key === key)!.cells[role];
    expect(cell('checkin', 'FRONT_DESK')).toEqual({ on: false, byDefault: true, needs: ['lookup'], locked: 'Turn on “Look up guests and bookings” for front desk first.' });
    expect(cell('reservations', 'HOUSEKEEPER')).toEqual({ on: false, byDefault: false, needs: ['lookup'], locked: 'Turn on “Look up guests and bookings” for housekeeping first.' });
    expect(cell('whatsapp', 'HOUSEKEEPER').locked).toBe('Turn on “Use the agent” for housekeeping first.');
    expect(cell('checkin', 'MANAGER').locked).toBeUndefined();
    // The front desk alert can't reach front desk without look-ups (nor any alert without WhatsApp): shown off and locked, but still on the stored list.
    expect(view.alerts.find((a) => a.kind === 'frontdesk')!.cells.FRONT_DESK).toEqual({ on: true, byDefault: true, needs: ['whatsapp', 'lookup'] });
    expect(shown.alerts.find((a) => a.kind === 'frontdesk')!.cells.FRONT_DESK).toEqual({ on: false, byDefault: true, needs: ['whatsapp', 'lookup'], locked: 'Turn on “Look up guests and bookings” for front desk first.' });
  });

  it('unlocks a switch as soon as what it needs is turned on in the draft', () => {
    const view = accessSwitches({});
    const draft = draftFrom(view);
    const cell = (key: string) => draftSwitches(view, draft).capabilities.find((c) => c.key === key)!.cells.HOUSEKEEPER;
    const alert = (kind: NoticeKind, role: 'FRONT_DESK' | 'HOUSEKEEPER') => draftSwitches(view, draft).alerts.find((a) => a.kind === kind)!.cells[role];
    expect(cell('checkin').locked).toBe('Turn on “Look up guests and bookings” for housekeeping first.');
    expect(cell('whatsapp').locked).toBe('Turn on “Use the agent” for housekeeping first.');
    // Alerts come on WhatsApp, so they wait for it first.
    expect(alert('frontdesk', 'HOUSEKEEPER').locked).toBe('Turn on “Use the agent” for housekeeping first.');
    expect(alert('housekeeping', 'HOUSEKEEPER').locked).toBe('Turn on “Use the agent” for housekeeping first.');
    expect(alert('pms', 'FRONT_DESK').locked).toBe('Turn on “Work in the hotel’s own PMS” for front desk first.');

    // Nothing saved yet: turning on the agent unlocks WhatsApp; with WhatsApp, look-ups unlock the front desk alert.
    draft.capabilities.HOUSEKEEPER.agent = true;
    expect(cell('whatsapp')).toEqual({ on: false, byDefault: false, needs: ['agent'] });
    expect(alert('frontdesk', 'HOUSEKEEPER').locked).toBe('Turn on “Use the agent on WhatsApp” for housekeeping first.');
    draft.capabilities.HOUSEKEEPER.whatsapp = true;
    expect(alert('frontdesk', 'HOUSEKEEPER').locked).toBe('Turn on “Look up guests and bookings” for housekeeping first.');
    draft.capabilities.HOUSEKEEPER.lookup = true;
    draft.capabilities.FRONT_DESK.pms = true;
    expect(cell('checkin')).toEqual({ on: false, byDefault: false, needs: ['lookup'] });
    expect(alert('frontdesk', 'HOUSEKEEPER')).toEqual({ on: false, byDefault: false, needs: ['whatsapp', 'lookup'] });
    expect(alert('housekeeping', 'HOUSEKEEPER')).toEqual({ on: true, byDefault: true, needs: ['whatsapp'] });
    expect(alert('pms', 'FRONT_DESK')).toEqual({ on: false, byDefault: false, needs: ['whatsapp', 'pms'] });

    // So check-in goes on in the same save.
    draft.capabilities.HOUSEKEEPER.checkin = true;
    draft.alerts.HOUSEKEEPER.push('frontdesk');
    expect(cell('checkin').on).toBe(true);
    expect(alert('frontdesk', 'HOUSEKEEPER').on).toBe(true);
    const stored = parsePolicy(policyFromUpdate(updateFromDraft(view, draft)));
    expect(stored.HOUSEKEEPER?.granted).toEqual(['agent.use', 'whatsapp.use', 'frontdesk.view', 'booking.view', 'booking.checkin', 'booking.checkout']);
    expect(alertsFor(stored, 'HOUSEKEEPER')).toEqual(['frontdesk', 'housekeeping']);
  });

  it('locks what needs a switch turned off in the draft, and saves it off', () => {
    const view = accessSwitches({});
    const draft = draftFrom(view);
    draft.capabilities.FRONT_DESK.lookup = false;
    const shown = draftSwitches(view, draft);
    const locked = 'Turn on “Look up guests and bookings” for front desk first.';
    for (const key of ['checkin', 'assignRoom', 'notes', 'reservations']) {
      expect(shown.capabilities.find((c) => c.key === key)!.cells.FRONT_DESK).toEqual({ on: false, byDefault: true, needs: ['lookup'], locked });
    }
    expect(shown.alerts.find((a) => a.kind === 'frontdesk')!.cells.FRONT_DESK).toEqual({ on: false, byDefault: true, needs: ['whatsapp', 'lookup'], locked });
    const sent = updateFromDraft(view, draft);
    expect(sent.capabilities.FRONT_DESK).toMatchObject({ lookup: false, checkin: false, assignRoom: false, notes: false, reservations: false, roomStatus: true });
    // The alert keeps its place on the list, so it comes back with look-ups.
    expect(sent.alerts.FRONT_DESK).toEqual(DEFAULT_ALERTS.FRONT_DESK);

    // What was on stays on underneath: turning look-ups back on before saving brings it back.
    draft.capabilities.FRONT_DESK.lookup = true;
    expect(draftSwitches(view, draft).capabilities.find((c) => c.key === 'checkin')!.cells.FRONT_DESK).toEqual({ on: true, byDefault: true, needs: ['lookup'] });
    expect(updateFromDraft(view, draft)).toEqual(updateFromDraft(view, draftFrom(view)));
  });

  it('saves locked switches as they were stored', () => {
    const u = defaults();
    u.capabilities.FRONT_DESK.lookup = false;
    u.alerts.HOUSEKEEPER = ['frontdesk', 'housekeeping'];
    const stored = policyFromUpdate(u);
    // What the page sends untouched, then after turning look-ups back on.
    const view = accessSwitches(parsePolicy(stored));
    const draft = draftFrom(view);
    expect(policyFromUpdate(updateFromDraft(view, draft))).toEqual(stored);
    // An alert turned off and on again goes to the end of the draft's list; what's saved is in the page's order, so it isn't a change.
    draft.alerts.OWNER = [...DEFAULT_ALERTS.OWNER.slice(1), DEFAULT_ALERTS.OWNER[0]];
    expect(updateFromDraft(view, draft)).toEqual(updateFromDraft(view, draftFrom(view)));
    draft.capabilities.FRONT_DESK.lookup = true;
    const after = parsePolicy(policyFromUpdate(updateFromDraft(view, draft)));
    expect(alertsFor(after, 'FRONT_DESK')).toEqual(DEFAULT_ALERTS.FRONT_DESK);
    expect(alertsFor(after, 'HOUSEKEEPER')).toEqual(['frontdesk', 'housekeeping']);
  });

  it('never locks owners’ alerts, whatever the draft', () => {
    const view = accessSwitches({});
    const draft = draftFrom(view);
    for (const r of POLICY_ROLES) for (const c of CAPABILITIES) draft.capabilities[r][c.key] = false;
    const shown = draftSwitches(view, draft);
    for (const a of shown.alerts) expect(a.cells.OWNER).toEqual({ on: DEFAULT_ALERTS.OWNER.includes(a.kind), byDefault: DEFAULT_ALERTS.OWNER.includes(a.kind) });
    // Alerts no capability gives a role stay locked; a housekeeper's housekeeping alert needs only WhatsApp (the page never takes the board away).
    expect(shown.alerts.find((a) => a.kind === 'disputes')!.cells.HOUSEKEEPER.locked).toBe('Not available to housekeeping.');
    expect(shown.alerts.find((a) => a.kind === 'housekeeping')!.cells.HOUSEKEEPER).toEqual({ on: false, byDefault: true, needs: ['whatsapp'], locked: 'Turn on “Use the agent” for housekeeping first.' });
    expect(shown.alerts.find((a) => a.kind === 'housekeeping')!.cells.FRONT_DESK.locked).toBe('Turn on “Use the agent” for front desk first.');
    draft.capabilities.FRONT_DESK.agent = true;
    draft.capabilities.FRONT_DESK.whatsapp = true;
    expect(draftSwitches(view, draft).alerts.find((a) => a.kind === 'housekeeping')!.cells.FRONT_DESK.locked).toBe('Turn on “Assign housekeeping” for front desk first.');
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
