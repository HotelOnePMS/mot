/**
 * Agent access: what each role may do through the hotel's agent (console and
 * WhatsApp), and which alerts the always-on agent sends each role. The owner
 * sets it per hotel on the Agent access page; src/server/agent/policy.ts
 * stores and applies it.
 *
 * Client-safe: types, keys, labels and pure helpers only.
 */

/** Roles an owner configures. Owners and platform admins always keep every agent permission. */
export const POLICY_ROLES = ['MANAGER', 'FRONT_DESK', 'HOUSEKEEPER'] as const;
export type PolicyRole = (typeof POLICY_ROLES)[number];

/** Roles that can receive alerts (owners choose their own too). */
export const ALERT_ROLES = ['OWNER', ...POLICY_ROLES] as const;
export type AlertRole = (typeof ALERT_ROLES)[number];

/** What the always-on agent tells people about, on WhatsApp. */
export const NOTICE_KINDS = ['brief', 'frontdesk', 'housekeeping', 'guestRequests', 'disputes', 'pms', 'channels'] as const;
export type NoticeKind = (typeof NOTICE_KINDS)[number];

export const NOTICE_INFO: Record<NoticeKind, { label: string; description: string }> = {
  brief: { label: 'Morning brief', description: 'Arrivals, departures, occupancy and what needs doing, at 8am hotel time.' },
  frontdesk: { label: 'Front desk', description: 'Overdue check-outs, late or unconfirmed arrivals, arrivals without a room.' },
  housekeeping: { label: 'Housekeeping', description: 'Dirty rooms nobody is assigned to, and room types short of ready rooms for arrivals.' },
  guestRequests: { label: 'Guest messages', description: 'Messages and booking requests guests leave with the phone line, WhatsApp or booking page.' },
  disputes: { label: 'Card disputes', description: 'A guest disputed a card payment and the evidence is ready to review.' },
  pms: { label: 'Your PMS', description: 'Work sent to the hotel’s own PMS that failed or needs a person.' },
  channels: { label: 'OTA channels', description: 'A Booking.com or Expedia connection stopped syncing.' },
};

/** How the page names each role in its messages. */
export const ROLE_WORDS: Record<AlertRole, string> = { OWNER: 'owners', MANAGER: 'managers', FRONT_DESK: 'front desk', HOUSEKEEPER: 'housekeeping' };

/** One switch on the Agent access page: a capability or an alert for one role. */
export interface AccessCell {
  on: boolean;
  /** What the role gets without any change here. */
  byDefault: boolean;
  /** Why it can't be switched at all (e.g. the role never has the permission this needs). */
  locked?: string;
  /** The capability (its key) this switch needs for the role: while that's off on the page, this switch is locked and shows off. */
  needs?: string;
}

export interface AgentAccessView {
  propertyName: string;
  canEdit: boolean;
  /** The staff agent on WhatsApp is set up on this site. */
  whatsapp: boolean;
  capabilities: { key: string; label: string; description: string; cells: Record<PolicyRole, AccessCell> }[];
  alerts: { kind: NoticeKind; label: string; description: string; cells: Record<AlertRole, AccessCell> }[];
  updatedAt: string | null;
  updatedBy: string | null;
}

/** What the page saves: every switch, so the server stores the difference from the defaults. */
export interface AgentAccessUpdate {
  propertyId: string;
  capabilities: Record<PolicyRole, Record<string, boolean>>;
  alerts: Record<AlertRole, NoticeKind[]>;
}

type Switches = Pick<AgentAccessView, 'capabilities' | 'alerts'>;
type Draft = Pick<AgentAccessUpdate, 'capabilities' | 'alerts'>;

/** The switches as saved, ready to change and save again. A locked switch keeps its stored value, so saving doesn't change it. */
export function draftFrom(v: Switches): Draft {
  return {
    capabilities: Object.fromEntries(POLICY_ROLES.map((r) => [r, Object.fromEntries(v.capabilities.map((c) => [c.key, c.cells[r].on]))])) as Draft['capabilities'],
    alerts: Object.fromEntries(ALERT_ROLES.map((r) => [r, v.alerts.filter((a) => a.cells[r].on).map((a) => a.kind)])) as Draft['alerts'],
  };
}

/** The switch to turn on first so the role ends up with this capability, if any: the capability itself, or one it needs that is off in the draft. */
function blocker(v: Switches, draft: Draft, role: AlertRole, key: string): string | undefined {
  const cap = v.capabilities.find((c) => c.key === key);
  if (!cap || !(POLICY_ROLES as readonly string[]).includes(role)) return undefined;
  const cell = cap.cells[role as PolicyRole];
  return (cell.needs && blocker(v, draft, role, cell.needs)) || (draft.capabilities[role as PolicyRole][key] ? undefined : key);
}

/** Works out one switch from the draft: locked while what it needs is off there, and then shown off (its draft value stays underneath). */
function fromDraft(v: Switches, draft: Draft, role: AlertRole, cell: AccessCell, value: boolean): AccessCell {
  const first = cell.needs ? blocker(v, draft, role, cell.needs) : undefined;
  const locked = cell.locked ?? (first ? `Turn on “${v.capabilities.find((c) => c.key === first)!.label}” for ${ROLE_WORDS[role]} first.` : undefined);
  return { ...cell, on: value && !locked, ...(locked ? { locked } : {}) };
}

/**
 * The switches as the page shows them for its draft, not the saved policy. A
 * switch is locked while a capability it needs is off in the draft, and shows
 * off; it unlocks as soon as that capability is turned on, so both can be
 * turned on in one save. Its draft value stays underneath, so turning the
 * needed switch back on before saving brings it back.
 */
export function draftSwitches(v: Switches, draft: Draft): Switches {
  return {
    capabilities: v.capabilities.map((c) => ({
      ...c,
      cells: Object.fromEntries(POLICY_ROLES.map((r) => [r, fromDraft(v, draft, r, c.cells[r], draft.capabilities[r][c.key])])) as Record<PolicyRole, AccessCell>,
    })),
    alerts: v.alerts.map((a) => ({
      ...a,
      cells: Object.fromEntries(ALERT_ROLES.map((r) => [r, fromDraft(v, draft, r, a.cells[r], draft.alerts[r].includes(a.kind))])) as Record<AlertRole, AccessCell>,
    })),
  };
}

/**
 * What the page saves for its draft. A capability locked by one it needs goes
 * as off (it counts as off, and the server stores it that way anyway). An
 * alert keeps its place on the role's list, locked or not, so a locked alert
 * keeps its stored value and comes back with the capability it needs.
 */
export function updateFromDraft(v: Switches, draft: Draft): Draft {
  return {
    capabilities: Object.fromEntries(
      POLICY_ROLES.map((r) => [r, Object.fromEntries(v.capabilities.map((c) => [c.key, !blocker(v, draft, r, c.key)]))]),
    ) as Draft['capabilities'],
    alerts: Object.fromEntries(ALERT_ROLES.map((r) => [r, v.alerts.filter((a) => draft.alerts[r].includes(a.kind)).map((a) => a.kind)])) as Draft['alerts'],
  };
}
