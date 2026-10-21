/**
 * Agent access: what each role may do through the hotel's agent (console and
 * WhatsApp), and which alerts the always-on agent sends each role. The owner
 * sets it per hotel on the Agent access page; src/server/agent/policy.ts
 * stores and applies it.
 *
 * Client-safe: types, keys and labels only.
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

/** One switch on the Agent access page: a capability for one role. */
export interface AccessCell {
  on: boolean;
  /** What the role gets without any change here. */
  byDefault: boolean;
  /** Why it can't be switched (e.g. the role never has the permission this needs). */
  locked?: string;
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
