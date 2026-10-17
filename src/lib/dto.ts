/**
 * Serializable data shapes shared by API routes, the agent's UI blocks and
 * client components. Client-safe: no server imports.
 */

export type ISODate = string; // YYYY-MM-DD

export type BookingStatus = 'PENDING' | 'CONFIRMED' | 'CANCELLED' | 'CHECKED_IN' | 'CHECKED_OUT' | 'NO_SHOW';
export type RoomStatus = 'CLEAN' | 'DIRTY' | 'INSPECTED' | 'OUT_OF_ORDER';
export type HousekeepingStatus = 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'INSPECTED';
export type InterfaceMode = 'CLASSIC' | 'AGENTIC';

export interface BookingSummary {
  id: string;
  code: string;
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
  paymentStatus: string;
  notes: string | null;
  createdAt: string;
}

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
  subtotal: number;
  total: number;
  currency: 'USD';
  available: number;
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
}

export interface StaffContext {
  user: { id: string; name: string; email: string; role: string };
  properties: StaffProperty[];
  permissions: string[];
  today: ISODate;
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
