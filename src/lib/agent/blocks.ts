/**
 * The agent's dynamic-UI vocabulary. The server answers every command with a
 * stream of these blocks; the console renders each as a live component
 * (cards, tables, room maps, charts, confirmation plans). Every number in a
 * block comes from a tool reading the database — never from free text.
 *
 * Client-safe: types only.
 */
import type {
  ActivityEntry,
  BookingSummary,
  FrontDeskAlert,
  HousekeepingTaskDTO,
  ISODate,
  OccupancyDay,
  RoomSummary,
  TeamMember,
} from '../dto';
import type { Tone } from '../status';

/** A one-tap follow-up. Sending `command` goes back through the agent (and the audit log). */
export interface QuickAction {
  label: string;
  command: string;
  tone?: 'default' | 'primary' | 'danger';
  /** 'prefill' puts the command in the input for the person to finish (e.g. a note). */
  mode?: 'send' | 'prefill';
}

export interface RoomOption {
  room: { id: string; number: string; floor: string | null; status: string; tags: string[] };
  score: number;
  reasons: string[];
  ready: boolean;
}

export interface PlanStepView {
  summary: string;
  detail?: string;
}

export interface PlanView {
  token: string;
  title: string;
  steps: PlanStepView[];
  warnings: string[];
  risk: 'low' | 'medium' | 'high';
  confirmLabel: string;
  expiresAt: string;
}

export type AgentBlock =
  | { type: 'text'; text: string }
  | { type: 'stats'; items: { label: string; value: string; hint?: string; tone?: Tone }[] }
  | {
      type: 'bookings';
      title: string;
      variant: 'arrivals' | 'departures' | 'inhouse' | 'search';
      items: BookingSummary[];
      emptyText?: string;
    }
  | { type: 'booking'; booking: BookingSummary; actions: QuickAction[]; history?: { status: string; notes: string | null; createdAt: string }[] }
  | { type: 'rooms'; title: string; rooms: RoomSummary[]; highlight?: string[] }
  | { type: 'roomOptions'; title: string; bookingCode: string; guestName: string; options: RoomOption[] }
  | {
      type: 'availability';
      checkIn: ISODate;
      checkOut: ISODate;
      guests: number;
      items: { id: string; name: string; capacity: number; available: number; total: number; averageNightly: number; totalPrice: number }[];
    }
  | { type: 'occupancy'; title: string; days: OccupancyDay[]; averagePct: number; revenue: number; adr: number }
  | {
      type: 'forecast';
      title: string;
      periods: {
        label: string;
        from: ISODate;
        to: ISODate;
        occupancyPct: number;
        roomsSold: number;
        roomsAvailable: number;
        adr: number;
        revenue: number;
        recommendation: string;
        tone: Tone;
        action?: QuickAction;
      }[];
    }
  | { type: 'housekeeping'; title: string; tasks: HousekeepingTaskDTO[]; team: TeamMember[] }
  | { type: 'alerts'; items: FrontDeskAlert[] }
  | { type: 'plan'; plan: PlanView }
  | { type: 'result'; ok: boolean; title: string; lines: string[] }
  | { type: 'activity'; items: ActivityEntry[] }
  | { type: 'suggestions'; items: string[] }
  | { type: 'navigate'; label: string; href: string; description?: string }
  | { type: 'clarify'; question: string; options: { label: string; hint?: string; command: string }[] }
  | { type: 'error'; text: string }
  /** Work sent to the hotel's own PMS through the bridge; the card follows it live. */
  /** `mode` is how HotelOne reaches the PMS (DESKTOP | CLOUD | MCP); older messages may lack it. */
  | { type: 'bridgeTask'; taskId: string; system: string; instruction: string; kind: string; mode?: string };

/** Conversation memory the client sends back so "them" and "that room" resolve. */
export interface AgentContextState {
  lastBookingId?: string;
  lastBookingCode?: string;
  lastGuestName?: string;
  lastRoomNumber?: string;
}

/** Events in the NDJSON stream from POST /api/agent/command. */
export type AgentEvent =
  | { type: 'status'; text: string }
  | { type: 'block'; block: AgentBlock }
  | { type: 'context'; context: AgentContextState }
  | { type: 'done'; engine: 'deterministic' | 'llm'; ms: number }
  | { type: 'error'; message: string };
