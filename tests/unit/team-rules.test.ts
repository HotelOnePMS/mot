import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  describeTeamChange,
  duplicateEmailMessage,
  editBlockReason,
  housekeeperMayChangeRoom,
  propertiesLeftWithoutOwner,
  shouldEndSessions,
  type RuleTarget,
} from '../../src/lib/team-rules';

const owner = (over: Partial<RuleTarget> = {}): RuleTarget => ({ id: 'o1', role: 'OWNER', isActive: true, email: 'o1@x.test', propertyIds: ['p1'], ...over });

test('a co-owner cannot edit another owner, but an owner can edit themselves and staff', () => {
  assert.match(editBlockReason({ userId: 'o2', role: 'OWNER' }, { id: 'o1', role: 'OWNER' }) ?? '', /another owner/);
  assert.equal(editBlockReason({ userId: 'o1', role: 'OWNER' }, { id: 'o1', role: 'OWNER' }), null);
  assert.equal(editBlockReason({ userId: 'o1', role: 'OWNER' }, { id: 'm1', role: 'MANAGER' }), null);
});

test('only admins edit admins; guests are never edited by staff; admins edit anyone', () => {
  assert.ok(editBlockReason({ userId: 'o1', role: 'OWNER' }, { id: 'a1', role: 'ADMIN' }));
  assert.ok(editBlockReason({ userId: 'o1', role: 'OWNER' }, { id: 'g1', role: 'CUSTOMER' }));
  assert.equal(editBlockReason({ userId: 'a2', role: 'ADMIN' }, { id: 'o1', role: 'OWNER' }), null);
});

test('the last active owner of a hotel cannot be demoted, deactivated, deleted or unassigned', () => {
  const alone = { p1: 0 };
  assert.deepEqual(propertiesLeftWithoutOwner(owner(), { role: 'MANAGER' }, alone), ['p1']);
  assert.deepEqual(propertiesLeftWithoutOwner(owner(), { isActive: false }, alone), ['p1']);
  assert.deepEqual(propertiesLeftWithoutOwner(owner(), { remove: true }, alone), ['p1']);
  assert.deepEqual(propertiesLeftWithoutOwner(owner(), { assignedPropertyIds: [] }, alone), ['p1']);
});

test('another active owner on the hotel makes the change fine; unrelated edits never trip it', () => {
  assert.deepEqual(propertiesLeftWithoutOwner(owner(), { role: 'MANAGER' }, { p1: 1 }), []);
  assert.deepEqual(propertiesLeftWithoutOwner(owner(), { firstName: 'Sam', email: 'new@x.test' }, { p1: 0 }), []);
  assert.deepEqual(propertiesLeftWithoutOwner(owner(), { role: 'OWNER', isActive: true }, { p1: 0 }), []);
});

test('only the properties that lose their last owner are reported', () => {
  const t = owner({ propertyIds: ['p1', 'p2'] });
  assert.deepEqual(propertiesLeftWithoutOwner(t, { assignedPropertyIds: ['p1'] }, { p1: 0, p2: 0 }), ['p2']);
  assert.deepEqual(propertiesLeftWithoutOwner(t, { assignedPropertyIds: ['p1'] }, { p1: 0, p2: 2 }), []);
});

test('non-owners and already-inactive owners are not owner-protected', () => {
  assert.deepEqual(propertiesLeftWithoutOwner(owner({ role: 'MANAGER' }), { remove: true }, { p1: 0 }), []);
  assert.deepEqual(propertiesLeftWithoutOwner(owner({ isActive: false }), { remove: true }, { p1: 0 }), []);
});

test('sessions end on role, status, password and email changes only', () => {
  const t = { email: 'a@x.test', role: 'MANAGER', isActive: true };
  assert.equal(shouldEndSessions(t, { role: 'FRONT_DESK' }), true);
  assert.equal(shouldEndSessions(t, { isActive: false }), true);
  assert.equal(shouldEndSessions(t, { password: 'new-password-1' }), true);
  assert.equal(shouldEndSessions(t, { email: 'b@x.test' }), true);
  assert.equal(shouldEndSessions(t, { email: 'A@X.test' }), false);
  assert.equal(shouldEndSessions(t, { role: 'MANAGER', isActive: true, firstName: 'Sam', phone: '1' }), false);
  assert.equal(shouldEndSessions(t, { assignedPropertyIds: ['p9'] }), false);
});

const person = { firstName: 'Ana', lastName: 'Lopez', email: 'ana@x.test', role: 'MANAGER', isActive: true, phone: null, propertyIds: ['p1', 'p2'], propertyNames: { p1: 'Harbor Inn', p2: 'Dune Motel', p3: 'Pine Lodge' } };

test('audit entries record who/what/before/after and never the password', () => {
  const entries = describeTeamChange(person, { role: 'FRONT_DESK', isActive: false, password: 'Sup3rSecret!', assignedPropertyIds: ['p1', 'p3'], email: 'ana2@x.test' });
  assert.deepEqual(entries.map((e) => e.action).sort(), ['TEAM_DEACTIVATE', 'TEAM_EMAIL_CHANGE', 'TEAM_PASSWORD_RESET', 'TEAM_PROPERTIES_CHANGE', 'TEAM_ROLE_CHANGE']);
  const blob = JSON.stringify(entries);
  assert.ok(!blob.includes('Sup3rSecret'));
  const role = entries.find((e) => e.action === 'TEAM_ROLE_CHANGE')!;
  assert.deepEqual([role.before, role.after], [{ role: 'MANAGER' }, { role: 'FRONT_DESK' }]);
  const props = entries.find((e) => e.action === 'TEAM_PROPERTIES_CHANGE')!;
  assert.match(props.summary, /added Pine Lodge; removed Dune Motel/);
  assert.deepEqual(props.after, { propertyIds: ['p1', 'p3'] });
});

test('a no-op change produces no audit entries', () => {
  assert.deepEqual(describeTeamChange(person, { role: 'MANAGER', isActive: true, assignedPropertyIds: ['p2', 'p1'], email: 'ANA@x.test', firstName: 'Ana', phone: '' }), []);
});

test('reactivation and profile edits are logged', () => {
  const e = describeTeamChange({ ...person, isActive: false }, { isActive: true, phone: '555' });
  assert.deepEqual(e.map((x) => x.action), ['TEAM_ACTIVATE', 'TEAM_UPDATE']);
});

test('housekeepers can only change rooms on their own list (assigned to them or unassigned)', () => {
  assert.equal(housekeeperMayChangeRoom('HOUSEKEEPER', 'h1', ['h1']), true);
  assert.equal(housekeeperMayChangeRoom('HOUSEKEEPER', 'h1', [null]), true);
  assert.equal(housekeeperMayChangeRoom('HOUSEKEEPER', 'h1', ['h2']), false);
  assert.equal(housekeeperMayChangeRoom('HOUSEKEEPER', 'h1', []), false);
  assert.equal(housekeeperMayChangeRoom('FRONT_DESK', 'f1', []), true);
});

test('the duplicate-email message only confirms an account to those who may know', () => {
  assert.match(duplicateEmailMessage(true), /already exists/);
  assert.doesNotMatch(duplicateEmailMessage(false), /exist|already|taken|in use/i);
});
