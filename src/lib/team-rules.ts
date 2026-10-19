/**
 * Pure team-management rules (no database, no framework imports) so they can be
 * unit-tested: who may change whom, keeping an owner on every hotel, what a
 * change is called in the audit trail, and when sessions must end.
 */

export interface RuleActor {
  userId: string;
  role: string;
}

export interface RuleTarget {
  id: string;
  role: string;
  isActive: boolean;
  email: string;
  propertyIds: string[];
}

export interface TeamChange {
  email?: string;
  password?: string;
  firstName?: string;
  lastName?: string;
  phone?: string | null;
  role?: string;
  isActive?: boolean;
  assignedPropertyIds?: string[];
  remove?: boolean;
}

/**
 * Null when the actor may edit this person at all; otherwise a user-safe reason.
 * Platform admins can edit anyone. Everyone else can't touch admins or guests, and
 * can't touch another owner: only that owner (or an admin) changes an owner's
 * email, password, role, status or access, so co-owners can't take each other over.
 */
export function editBlockReason(actor: RuleActor, target: { id: string; role: string }): string | null {
  if (actor.role === 'ADMIN') return null;
  if (target.role === 'ADMIN') return 'Platform admins can only be changed by another admin.';
  if (target.role === 'CUSTOMER') return 'Guest accounts are managed by the guest.';
  if (target.role === 'OWNER' && target.id !== actor.userId) {
    return 'Only an owner themselves, or a platform admin, can change another owner.';
  }
  return null;
}

/** True when the change takes ownership away from this person (demote, deactivate, delete, or unassign). */
function endsOwnership(target: RuleTarget, change: TeamChange): { all: boolean; removedFrom: string[] } {
  if (target.role !== 'OWNER' || !target.isActive) return { all: false, removedFrom: [] };
  const stopsBeingOwner =
    change.remove === true ||
    (change.role !== undefined && change.role !== 'OWNER') ||
    change.isActive === false;
  if (stopsBeingOwner) return { all: true, removedFrom: [...target.propertyIds] };
  if (change.assignedPropertyIds) {
    const next = new Set(change.assignedPropertyIds);
    return { all: false, removedFrom: target.propertyIds.filter((id) => !next.has(id)) };
  }
  return { all: false, removedFrom: [] };
}

/**
 * Property ids that would be left without any active owner by this change.
 * `otherActiveOwners[propertyId]` = number of OTHER active owners assigned to that property.
 */
export function propertiesLeftWithoutOwner(
  target: RuleTarget,
  change: TeamChange,
  otherActiveOwners: Record<string, number>,
): string[] {
  const { removedFrom } = endsOwnership(target, change);
  return removedFrom.filter((id) => (otherActiveOwners[id] ?? 0) === 0);
}

/** Whether this change alters what a signed-in session may do or who it is, so existing sessions must end. */
export function shouldEndSessions(target: { email: string; role: string; isActive: boolean }, change: TeamChange): boolean {
  if (change.password) return true;
  if (change.role !== undefined && change.role !== target.role) return true;
  if (change.isActive !== undefined && change.isActive !== target.isActive) return true;
  if (change.email !== undefined && change.email.toLowerCase() !== target.email.toLowerCase()) return true;
  return false;
}

export interface AuditEntry {
  action:
    | 'TEAM_ADD'
    | 'TEAM_INVITE'
    | 'TEAM_DELETE'
    | 'TEAM_ROLE_CHANGE'
    | 'TEAM_PROPERTIES_CHANGE'
    | 'TEAM_ACTIVATE'
    | 'TEAM_DEACTIVATE'
    | 'TEAM_PASSWORD_RESET'
    | 'TEAM_EMAIL_CHANGE'
    | 'TEAM_UPDATE';
  summary: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
}

const roleLabel = (r: string) => r.replace('_', ' ').toLowerCase();

/**
 * The audit entries a change produces. Passwords are never included: only the fact
 * that one was set. Emails are recorded because they are identity, not secrets.
 */
export function describeTeamChange(
  target: { firstName: string; lastName: string; email: string; role: string; isActive: boolean; phone?: string | null; propertyNames?: Record<string, string>; propertyIds: string[] },
  change: TeamChange,
): AuditEntry[] {
  const who = `${target.firstName} ${target.lastName}`.trim() || target.email;
  const out: AuditEntry[] = [];
  if (change.role !== undefined && change.role !== target.role) {
    out.push({ action: 'TEAM_ROLE_CHANGE', summary: `${who}: role ${roleLabel(target.role)} → ${roleLabel(change.role)}`, before: { role: target.role }, after: { role: change.role } });
  }
  if (change.assignedPropertyIds) {
    const a = [...target.propertyIds].sort();
    const b = [...new Set(change.assignedPropertyIds)].sort();
    if (a.join() !== b.join()) {
      const name = (id: string) => target.propertyNames?.[id] ?? id;
      const added = b.filter((id) => !a.includes(id)).map(name);
      const removed = a.filter((id) => !b.includes(id)).map(name);
      const parts = [added.length ? `added ${added.join(', ')}` : '', removed.length ? `removed ${removed.join(', ')}` : ''].filter(Boolean);
      out.push({ action: 'TEAM_PROPERTIES_CHANGE', summary: `${who}: properties ${parts.join('; ')}`, before: { propertyIds: a }, after: { propertyIds: b } });
    }
  }
  if (change.isActive !== undefined && change.isActive !== target.isActive) {
    out.push({
      action: change.isActive ? 'TEAM_ACTIVATE' : 'TEAM_DEACTIVATE',
      summary: `${who}: ${change.isActive ? 'reactivated' : 'deactivated'}`,
      before: { isActive: target.isActive },
      after: { isActive: change.isActive },
    });
  }
  if (change.password) {
    out.push({ action: 'TEAM_PASSWORD_RESET', summary: `${who}: password reset by an administrator`, before: {}, after: { passwordChanged: true } });
  }
  if (change.email !== undefined && change.email.toLowerCase() !== target.email.toLowerCase()) {
    out.push({ action: 'TEAM_EMAIL_CHANGE', summary: `${who}: email ${target.email} → ${change.email}`, before: { email: target.email }, after: { email: change.email } });
  }
  const profileBefore: Record<string, unknown> = {};
  const profileAfter: Record<string, unknown> = {};
  if (change.firstName !== undefined && change.firstName !== target.firstName) { profileBefore.firstName = target.firstName; profileAfter.firstName = change.firstName; }
  if (change.lastName !== undefined && change.lastName !== target.lastName) { profileBefore.lastName = target.lastName; profileAfter.lastName = change.lastName; }
  if (change.phone !== undefined && (change.phone || null) !== (target.phone || null)) { profileBefore.phone = target.phone ?? null; profileAfter.phone = change.phone || null; }
  if (Object.keys(profileAfter).length) {
    out.push({ action: 'TEAM_UPDATE', summary: `${who}: updated ${Object.keys(profileAfter).join(', ')}`, before: profileBefore, after: profileAfter });
  }
  return out;
}

/**
 * Housekeepers may only change a room's status when the room is on their cleaning
 * list: it has an open task that is theirs or unassigned (same rule as updating the task).
 * Everyone else is unaffected.
 */
export function housekeeperMayChangeRoom(role: string, userId: string, openTaskAssignees: (string | null)[]): boolean {
  if (role !== 'HOUSEKEEPER') return true;
  return openTaskAssignees.some((a) => a === null || a === userId);
}

/** Message for a duplicate email that doesn't reveal whether an account exists to people who may not know. */
export function duplicateEmailMessage(canSeeAccount: boolean): string {
  return canSeeAccount
    ? 'An account with this email already exists.'
    : 'We couldn’t add this person with that email. Check the address, or ask a platform admin for help.';
}
