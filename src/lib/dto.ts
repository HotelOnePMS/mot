/**
 * Serializable data shapes shared by API routes, the agent's UI blocks and
 * client components. Client-safe: no server imports.
 */

import type { RiskFlag } from './risk';

export type ISODate = string; // YYYY-MM-DD

export type BookingStatus = 'PENDING' | 'CONFIRMED' | 'CANCELLED' | 'CHECKED_IN' | 'CHECKED_OUT' | 'NO_SHOW';
export type RoomStatus = 'CLEAN' | 'DIRTY' | 'INSPECTED' | 'OUT_OF_ORDER';
export type HousekeepingStatus = 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'INSPECTED';
export type InterfaceMode = 'CLASSIC' | 'AGENTIC';

export interface BookingSummary {
  id: string;
  code: string;
  /** The guest's confirmation code when this booking is one room type of a larger reservation, else null. */
  reservationCode: string | null;
  status: BookingStatus;
  propertyId: string;
  propertyName: string;
  guest: { id: string; name: string; email: string; phone: string | null };
  checkIn: ISODate;
  checkOut: ISODate;
  nights: number;
  guests: number;
  rooms: number;
  roomType: { id: string; name: string };
  room: { id: string; number: string; floor: string | null } | null;
  totalPrice: number;
  /** The hotel's currency for every amount on this booking. */
  currency: string;
  paymentStatus: string;
  /** Collected online and not refunded, in the booking's currency. */
  amountPaid: number;
  /** Allowances lowering what the stay costs (a manager's, with a reason), positive. */
  allowances: number;
  /** What the guest still owes: the total less allowances and everything paid online or at the desk. Negative = the hotel owes the guest. */
  balance: number;
  /**
   * What must be paid before the guest can check out. A single booking: its balance (never negative). A line of a
   * multi-room-type reservation: nothing once its share is covered, otherwise what the whole reservation still owes,
   * which is what the desk collects (payments are shared, so a part payment is spread over every room type).
   */
  checkOutDue: number;
  /**
   * A line of a multi-room-type reservation: what the whole reservation still owes (negative: owed back to the guest),
   * its room types going ahead after allowances less what was paid toward them. Null for a single booking.
   */
  reservationBalance: number | null;
  /** Reasons for the front desk to look twice (staff only; computed on the server). */
  riskFlags: RiskFlag[];
  notes: string | null;
  /** The guest is on this hotel's Do Not Rent list (staff only; filled by attachDoNotRent on the server, else null). */
  doNotRent: DoNotRentMatch | null;
  createdAt: string;
}

/** One guest on a hotel's Do Not Rent list. */
export interface DoNotRentEntry {
  id: string;
  propertyId: string;
  guestName: string;
  email: string | null;
  phone: string | null;
  reason: string;
  createdAt: string;
  createdBy: { id: string; name: string };
}

/** What the front desk sees on a booking whose guest is on the list. */
export type DoNotRentMatch = Pick<DoNotRentEntry, 'id' | 'guestName' | 'reason' | 'createdAt' | 'createdBy'>;

export type Occupancy = 'VACANT' | 'OCCUPIED' | 'ARRIVING' | 'DEPARTING' | 'TURNOVER';

export interface RoomSummary {
  id: string;
  number: string;
  floor: string | null;
  status: RoomStatus;
  isOutOfOrder: boolean;
  outOfOrderReason: string | null;
  tags: string[];
  notes: string | null;
  roomType: { id: string; name: string };
  occupancy: Occupancy;
  current: { bookingId: string; code: string; guestName: string; checkOut: ISODate } | null;
  arriving: { bookingId: string; code: string; guestName: string; checkIn: ISODate } | null;
  task: { id: string; status: HousekeepingStatus; priority: number; assignee: { id: string; name: string } | null } | null;
}

export interface HousekeepingTaskDTO {
  id: string;
  status: HousekeepingStatus;
  priority: number;
  notes: string | null;
  createdAt: string;
  completedAt: string | null;
  room: { id: string; number: string; floor: string | null; roomTypeName: string; status: RoomStatus; occupancy: Occupancy };
  assignee: { id: string; name: string } | null;
}

export interface FrontDeskAlert {
  id: string;
  tone: 'info' | 'warning' | 'danger';
  title: string;
  detail?: string;
  /** Natural-language command that resolves the alert in agent mode. */
  command?: string;
}

export interface FrontDeskSummary {
  date: ISODate;
  property: { id: string; name: string };
  arrivals: BookingSummary[];
  departures: BookingSummary[];
  inHouse: BookingSummary[];
  stats: {
    arrivalsDue: number;
    arrivalsDone: number;
    departuresDue: number;
    departuresDone: number;
    inHouse: number;
    totalRooms: number;
    occupiedTonight: number;
    occupancyPct: number;
    availableTonight: number;
    outOfOrder: number;
    dirty: number;
    clean: number;
    inspected: number;
    unassignedArrivals: number;
  };
  alerts: FrontDeskAlert[];
}

export interface QuoteNight {
  date: ISODate;
  price: number;
}

export interface StayQuote {
  roomTypeId: string;
  roomTypeName: string;
  checkIn: ISODate;
  checkOut: ISODate;
  nights: QuoteNight[];
  rooms: number;
  guests: number;
  averageNightly: number;
  /** Room charges for every room and night. */
  subtotal: number;
  /** Taxes and fees on top of the room charges. */
  charges: QuoteCharge[];
  chargesTotal: number;
  /** What the guest pays: subtotal + charges. */
  total: number;
  /** The hotel's ISO 4217 currency. */
  currency: string;
  available: number;
}

export interface QuoteCharge {
  name: string;
  kind: 'PERCENT' | 'PER_ROOM_NIGHT' | 'PER_GUEST_NIGHT' | 'PER_STAY';
  /** The percentage for PERCENT, otherwise the unit amount. */
  rate: number;
  amount: number;
}

export interface OccupancyDay {
  date: ISODate;
  roomsSold: number;
  totalRooms: number;
  occupancyPct: number;
  revenue: number;
  adr: number;
}

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: string;
  openTasks?: number;
}

export type SetupPath = 'FULL' | 'BRIDGE' | 'VOICE';

export interface StaffProperty {
  id: string;
  name: string;
  city: string;
  state: string;
  interfaceMode: InterfaceMode;
  setupPath: SetupPath;
  primaryColor: string | null;
  isDemo: boolean;
  /** IANA time zone of the hotel's clock. */
  timezone: string;
  currency: string;
  /** Today at this hotel. */
  today: ISODate;
  organization: { id: string; name: string } | null;
}

export interface StaffContext {
  user: { id: string; name: string; email: string; role: string; mfaEnabled: boolean; emailVerified: boolean };
  properties: StaffProperty[];
  permissions: string[];
  /** Today on the platform clock; each property carries its own `today`. */
  today: ISODate;
  /** Organizations this person administers. */
  orgAdminOf: { id: string; name: string }[];
  agent: { llmEnabled: boolean; voiceEnabled: boolean };
}

export interface ActivityEntry {
  id: string;
  at: string;
  user: { id: string; name: string };
  action: string;
  source: 'agent' | 'classic' | 'system';
  summary: string;
}

// ---------------------------------------------------------------------------
// Agent skills (GET /api/admin/skills)
// ---------------------------------------------------------------------------

export type SkillKindDTO = 'ANSWER' | 'MACRO' | 'RECIPE';
export type SkillSourceDTO = 'CONFIG' | 'LEARNED' | 'MANUAL';
export type SkillStatusDTO = 'ACTIVE' | 'SUGGESTED' | 'DISABLED';
export type SkillAudienceDTO = 'GUEST' | 'STAFF' | 'ALL';

/** One agent skill as the Skills page shows it. */
export interface SkillView {
  id: string;
  key: string;
  kind: SkillKindDTO;
  source: SkillSourceDTO;
  status: SkillStatusDTO;
  audience: SkillAudienceDTO;
  title: string;
  description: string;
  /** ANSWER: what agents say. */
  answer?: string;
  /** MACRO: commands; RECIPE: instructions. */
  steps?: string[];
  /** RECIPE: the PMS it works and what it achieves. */
  system?: string;
  intent?: string;
  /** RECIPE: how runs went. */
  successes?: number;
  failures?: number;
  failStreak?: number;
  /** RECIPE: switched itself off after failing too often. */
  autoDisabled?: boolean;
  /** MACRO: input names ({guest}, {room}…) and how to say it. */
  inputs: string[];
  example?: string;
  uses: number;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  /** CONFIG: where to change it. */
  editIn?: { label: string; href: string } | null;
}

export interface SkillsResponse {
  skills: SkillView[];
  /** Tools the hotel's PMS exposes (managed on the PMS page). */
  pmsTools: number;
  canManage: boolean;
  /** Why guest-facing answers can't be changed here (public demo), or null. */
  guestAnswersLocked: string | null;
}
