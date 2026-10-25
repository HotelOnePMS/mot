/**
 * Agent access, per hotel: what each role may do through the agent (console
 * and WhatsApp) and which alerts the always-on agent sends it. The owner
 * turns capabilities on or off per role; we store only the differences from
 * the role defaults in authz.ts, so a role keeps tracking the defaults until
 * someone changes it.
 *
 * An agent run gets its actor from agentActor(): the person's own role and
 * hotels, narrowed to the one hotel the run is about, with that hotel's
 * grants and revocations attached. Every check inside the agent (tools,
 * domain services, plan confirmation) goes through can(), which honours
 * them — so a capability turned off here is off in every agent channel, and
 * one turned on works end to end. The classic console screens keep the plain
 * role rules.
 */
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { ALERT_ROLES, NOTICE_INFO, NOTICE_KINDS, POLICY_ROLES, ROLE_WORDS, type AccessCell, type AgentAccessUpdate, type AgentAccessView, type AlertRole, type NoticeKind, type PolicyRole } from '@/lib/agent/access';
import { assertPropertyAccess, can, PERMISSIONS, requirePermission, roleCan, type Actor, type Permission } from '../authz';
import { notFound } from '../errors';
import { recordAudit } from '../services/audit';
import { whatsAppConfig } from '../whatsapp/cloud';

interface Capability {
  key: string;
  label: string;
  description: string;
  perms: Permission[];
  /** Another capability this one needs to be any use: while that one is off, this one counts as off and the page locks its switch. */
  needs?: string;
}

/** The switches on the Agent access page. Each is a group of permissions, all on or all off. */
export const CAPABILITIES: Capability[] = [
  { key: 'agent', label: 'Use the agent', description: 'Ask questions and propose changes in the console.', perms: ['agent.use'] },
  { key: 'whatsapp', label: 'Use the agent on WhatsApp', description: 'The same agent from their phone.', perms: ['whatsapp.use'], needs: 'agent' },
  { key: 'lookup', label: 'Look up guests and bookings', description: 'Arrivals, departures, in-house and reservations.', perms: ['frontdesk.view', 'booking.view'] },
  // Changing a booking starts by finding it, so these need look-ups (the booking services check booking.view too).
  { key: 'checkin', label: 'Check guests in and out', description: '', perms: ['booking.checkin', 'booking.checkout'], needs: 'lookup' },
  { key: 'assignRoom', label: 'Assign rooms', description: '', perms: ['booking.assignRoom'], needs: 'lookup' },
  { key: 'notes', label: 'Add booking notes', description: '', perms: ['booking.note'], needs: 'lookup' },
  // Bringing back a cancelled or no-show booking also needs booking.reinstate, which stays with the role: the agent checks booking.confirm first.
  { key: 'reservations', label: 'Confirm, cancel and mark no-shows', description: '', perms: ['booking.confirm', 'booking.cancel', 'booking.noShow'], needs: 'lookup' },
  { key: 'roomStatus', label: 'Room status', description: 'See rooms and mark them clean or dirty.', perms: ['room.view', 'room.status'] },
  { key: 'outOfOrder', label: 'Take rooms out of order', description: '', perms: ['room.outOfOrder'] },
  { key: 'housekeeping', label: 'Assign housekeeping', description: 'Hand out cleaning and see the housekeeping board.', perms: ['housekeeping.view', 'housekeeping.assign'] },
  { key: 'availability', label: 'Availability and prices', description: 'What’s free and what it costs.', perms: ['rates.view'] },
  { key: 'rates', label: 'Change rates', description: '', perms: ['rates.write'] },
  { key: 'reports', label: 'Occupancy, revenue and forecasts', description: '', perms: ['analytics.view'] },
  { key: 'activity', label: 'Activity log', description: 'Who did what, including the agent.', perms: ['activity.view'] },
  { key: 'pms', label: 'Work in the hotel’s own PMS', description: 'Free-text instructions to your PMS through the bridge.', perms: ['bridge.use'] },
];

/** The permission someone needs to receive each kind of alert. */
export const NOTICE_PERMISSION: Record<NoticeKind, Permission> = {
  brief: 'frontdesk.view',
  frontdesk: 'frontdesk.view',
  housekeeping: 'housekeeping.view',
  guestRequests: 'requests.view',
  disputes: 'disputes.view',
  pms: 'bridge.use',
  channels: 'channels.view',
};

/** Who hears about what until the owner changes it. */
export const DEFAULT_ALERTS: Record<AlertRole, NoticeKind[]> = {
  OWNER: ['brief', 'frontdesk', 'guestRequests', 'disputes', 'pms', 'channels'],
  MANAGER: ['brief', 'frontdesk', 'housekeeping', 'guestRequests', 'pms', 'channels'],
  FRONT_DESK: ['frontdesk', 'guestRequests'],
  HOUSEKEEPER: ['housekeeping'],
};

/** Only permissions on the page can be granted, and only ones an owner has: an owner can't hand out more than they hold. */
const GRANTABLE = new Set<Permission>(CAPABILITIES.flatMap((c) => c.perms).filter((p) => roleCan('OWNER', p)));
const isPermission = (p: string): p is Permission => p in PERMISSIONS;

const roleSchema = z.object({
  grant: z.array(z.string()).optional(),
  revoke: z.array(z.string()).optional(),
  alerts: z.array(z.string()).optional(),
});

export interface RolePolicy {
  granted: Permission[];
  revoked: Permission[];
  /** null: the defaults for the role. */
  alerts: NoticeKind[] | null;
}
export type Policy = Partial<Record<AlertRole, RolePolicy>>;

/** Reads a stored policy, dropping anything that isn't (or is no longer) allowed. */
export function parsePolicy(raw: unknown): Policy {
  const out: Policy = {};
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  for (const role of ALERT_ROLES) {
    const parsed = roleSchema.safeParse(obj[role]);
    if (!parsed.success) continue;
    const configurable = (POLICY_ROLES as readonly string[]).includes(role);
    out[role] = {
      granted: configurable ? (parsed.data.grant ?? []).filter(isPermission).filter((p) => GRANTABLE.has(p) && !roleCan(role, p)) : [],
      revoked: configurable ? (parsed.data.revoke ?? []).filter(isPermission).filter((p) => roleCan(role, p)) : [],
      alerts: parsed.data.alerts ? parsed.data.alerts.filter((k): k is NoticeKind => (NOTICE_KINDS as readonly string[]).includes(k)) : null,
    };
  }
  return out;
}

export async function loadPolicy(propertyId: string): Promise<Policy> {
  const row = await prisma.agentPolicy.findUnique({ where: { propertyId }, select: { roles: true } });
  return parsePolicy(row?.roles);
}

/**
 * The actor an agent run at this hotel uses: narrowed to the hotel, with the
 * hotel's grants and revocations for the person's role. Owners and platform
 * admins keep their role's permissions.
 */
export async function agentActor(actor: Actor, propertyId: string, policy?: Policy): Promise<Actor> {
  assertPropertyAccess(actor, propertyId);
  const p = policy ?? (await loadPolicy(propertyId));
  const rp = (POLICY_ROLES as readonly string[]).includes(actor.role) ? p[actor.role as PolicyRole] : undefined;
  return { ...actor, propertyIds: [propertyId], overrides: { granted: rp?.granted ?? [], revoked: rp?.revoked ?? [] } };
}

/** Which alerts a role gets at a hotel (before checking the person may see them). */
export function alertsFor(policy: Policy, role: string): NoticeKind[] {
  if (!(ALERT_ROLES as readonly string[]).includes(role)) return [];
  return policy[role as AlertRole]?.alerts ?? DEFAULT_ALERTS[role as AlertRole];
}

/** May this (agent) actor use the agent on WhatsApp? Both permissions, so turning the agent off also turns WhatsApp off. */
export const canUseWhatsApp = (actor: Actor) => can(actor, 'agent.use') && can(actor, 'whatsapp.use');

/** Does any of this person's hotels let them use the agent on WhatsApp? (Linking a phone is per person, not per hotel.) */
export async function canUseWhatsAppAnywhere(actor: Actor): Promise<boolean> {
  // Platform admins aren't configured by any one hotel: their role decides.
  if (actor.propertyIds === 'ALL') return roleCan(actor.role, 'agent.use') && roleCan(actor.role, 'whatsapp.use');
  const hotels = actor.propertyIds.slice(0, 200);
  const rows = await prisma.agentPolicy.findMany({ where: { propertyId: { in: hotels } }, select: { propertyId: true, roles: true } });
  const byHotel = new Map(rows.map((r) => [r.propertyId, parsePolicy(r.roles)]));
  for (const pid of hotels) {
    if (canUseWhatsApp(await agentActor(actor, pid, byHotel.get(pid) ?? {}))) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// The Agent access page
// ---------------------------------------------------------------------------

const neededBy = (cap: Capability) => (cap.needs ? CAPABILITIES.find((c) => c.key === cap.needs) : undefined);

/** Does the role hold every permission of the capability at this hotel? */
function holds(cap: Capability, role: PolicyRole, rp: RolePolicy | undefined): boolean {
  return cap.perms.every((p) => !rp?.revoked.includes(p) && (roleCan(role, p) || !!rp?.granted.includes(p)));
}

function capabilityCell(cap: Capability, role: PolicyRole, rp: RolePolicy | undefined): AccessCell {
  const cell: AccessCell = { on: holds(cap, role, rp), byDefault: cap.perms.every((p) => roleCan(role, p)) };
  if (!cap.perms.every((p) => roleCan(role, p) || GRANTABLE.has(p))) cell.locked = 'Only owners can do this.';
  else if (cap.needs) cell.needs = cap.needs;
  return cell;
}

function alertCell(kind: NoticeKind, role: AlertRole, policy: Policy): AccessCell {
  const cell: AccessCell = { on: alertsFor(policy, role).includes(kind), byDefault: DEFAULT_ALERTS[role].includes(kind) };
  const perm = NOTICE_PERMISSION[kind];
  const cap = (POLICY_ROLES as readonly string[]).includes(role) ? CAPABILITIES.find((c) => c.perms.includes(perm)) : undefined;
  // The page changes whether a role holds the permission only through its capability (as policyFromUpdate stores it): on grants it, off takes it away — except from a role that only half has the capability by default, which keeps it.
  if (cap && (roleCan(role, perm) ? cap.perms.every((p) => roleCan(role, p)) : GRANTABLE.has(perm))) cell.needs = cap.key;
  else if (!roleCan(role, perm)) cell.locked = `Not available to ${ROLE_WORDS[role]}.`;
  return cell;
}

export async function accessView(actor: Actor, propertyId: string): Promise<AgentAccessView> {
  assertPropertyAccess(actor, propertyId);
  const [property, row] = await Promise.all([
    prisma.property.findUnique({ where: { id: propertyId }, select: { name: true } }),
    prisma.agentPolicy.findUnique({ where: { propertyId }, select: { roles: true, updatedAt: true, updatedById: true } }),
  ]);
  if (!property) throw notFound('Property');
  const policy = parsePolicy(row?.roles);
  const editor = row?.updatedById ? await prisma.user.findUnique({ where: { id: row.updatedById }, select: { firstName: true, lastName: true } }) : null;
  return {
    propertyName: property.name,
    canEdit: can(actor, 'agent.policy'),
    whatsapp: !!whatsAppConfig(),
    ...accessSwitches(policy),
    updatedAt: row ? row.updatedAt.toISOString() : null,
    updatedBy: editor ? `${editor.firstName} ${editor.lastName}`.trim() : null,
  };
}

/**
 * The page's switches for a stored policy: `on` is what's stored, and `needs`
 * the capability a switch waits for. The page locks switches from its own
 * unsaved changes (draftSwitches in lib/agent/access.ts), so a capability and
 * what needs it can be turned on in one save.
 */
export function accessSwitches(policy: Policy): Pick<AgentAccessView, 'capabilities' | 'alerts'> {
  return {
    capabilities: CAPABILITIES.map((cap) => ({
      key: cap.key,
      label: cap.label,
      description: cap.description,
      cells: Object.fromEntries(POLICY_ROLES.map((role) => [role, capabilityCell(cap, role, policy[role])])) as Record<PolicyRole, AccessCell>,
    })),
    alerts: NOTICE_KINDS.map((kind) => ({
      kind,
      label: NOTICE_INFO[kind].label,
      description: NOTICE_INFO[kind].description,
      cells: Object.fromEntries(ALERT_ROLES.map((role) => [role, alertCell(kind, role, policy)])) as Record<AlertRole, AccessCell>,
    })),
  };
}

/** Turns the page's switches into what's stored: grants and revocations against the role defaults, and alert lists that differ from them. */
export function policyFromUpdate(update: Pick<AgentAccessUpdate, 'capabilities' | 'alerts'>): Record<string, { grant?: Permission[]; revoke?: Permission[]; alerts?: NoticeKind[] }> {
  const out: Record<string, { grant?: Permission[]; revoke?: Permission[]; alerts?: NoticeKind[] }> = {};
  for (const role of POLICY_ROLES) {
    const grant = new Set<Permission>();
    const revoke = new Set<Permission>();
    const byDefault = (cap: Capability) => cap.perms.every((p) => roleCan(role, p));
    // A switch whose needed capability ends up off counts as off: nothing is granted for it, and a role that has it by default loses it.
    const wants = (cap: Capability): boolean => {
      const need = neededBy(cap);
      return (update.capabilities[role]?.[cap.key] ?? byDefault(cap)) && (!need || wants(need));
    };
    for (const cap of CAPABILITIES) {
      const want = wants(cap);
      // At its default, a switch stores nothing — including one the role half has by default (shown off, nothing taken away).
      if (want === byDefault(cap)) continue;
      for (const p of cap.perms) {
        if (want && !roleCan(role, p) && GRANTABLE.has(p)) grant.add(p);
        if (!want && roleCan(role, p)) revoke.add(p);
      }
    }
    // A permission in two capabilities (none today) stays revoked if either is off.
    for (const p of revoke) grant.delete(p);
    if (grant.size || revoke.size) out[role] = { ...(grant.size ? { grant: [...grant] } : {}), ...(revoke.size ? { revoke: [...revoke] } : {}) };
  }
  for (const role of ALERT_ROLES) {
    const want = update.alerts[role];
    if (!want) continue;
    const kinds = NOTICE_KINDS.filter((k) => want.includes(k));
    const same = kinds.length === DEFAULT_ALERTS[role].length && kinds.every((k) => DEFAULT_ALERTS[role].includes(k));
    if (!same) out[role] = { ...out[role], alerts: kinds };
  }
  return out;
}

/** Plain-language list of what changed, for the activity log. */
function describeChanges(before: AgentAccessView, after: AgentAccessView): string[] {
  const lines: string[] = [];
  for (const [i, cap] of after.capabilities.entries()) {
    for (const role of POLICY_ROLES) {
      const was = before.capabilities[i].cells[role].on;
      const now = cap.cells[role].on;
      if (was !== now) lines.push(`${cap.label}: ${now ? 'on' : 'off'} for ${ROLE_WORDS[role]}`);
    }
  }
  for (const [i, a] of after.alerts.entries()) {
    for (const role of ALERT_ROLES) {
      const was = before.alerts[i].cells[role].on;
      const now = a.cells[role].on;
      if (was !== now) lines.push(`${a.label} alerts: ${now ? 'on' : 'off'} for ${ROLE_WORDS[role]}`);
    }
  }
  return lines;
}

export async function saveAccess(actor: Actor, update: AgentAccessUpdate): Promise<AgentAccessView> {
  requirePermission(actor, 'agent.policy');
  assertPropertyAccess(actor, update.propertyId);
  const before = await accessView(actor, update.propertyId);
  const roles = policyFromUpdate(update);
  await prisma.agentPolicy.upsert({
    where: { propertyId: update.propertyId },
    create: { propertyId: update.propertyId, roles, updatedById: actor.userId },
    update: { roles, updatedById: actor.userId },
  });
  const after = await accessView(actor, update.propertyId);
  const changes = describeChanges(before, after);
  if (changes.length) {
    await recordAudit({ actor, source: 'classic' }, update.propertyId, 'AGENT_ACCESS', `Changed agent access: ${changes.slice(0, 3).join('; ')}${changes.length > 3 ? ` and ${changes.length - 3} more` : ''}`, { changes });
  }
  return after;
}
