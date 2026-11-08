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
import type { ReportCell, ReportColumn } from '../reports';
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
  /** A custom report the agent built: the first rows, the totals, and links to the whole thing (CSV, the Reports page). */
  | {
      type: 'report';
      title: string;
      from: ISODate;
      to: ISODate;
      currency: string;
      columns: ReportColumn[];
      rows: Record<string, ReportCell>[];
      totals: Record<string, ReportCell> | null;
      /** Rows in the whole report (rows holds the first ones). */
      totalRows: number;
      /** Source rows the filters matched. */
      matched: number;
      truncated: boolean;
      csvHref: string;
      openHref: string;
    }
  /** Work sent to the hotel's own PMS through the bridge; the card follows it live. */
  /** `mode` is how HotelOne reaches the PMS (DESKTOP | CLOUD | MCP); older messages may lack it. */
  | { type: 'bridgeTask'; taskId: string; system: string; instruction: string; kind: string; mode?: string }
  /** A reservation's folio, shown live (and editable by hand) from the folio API; the totals are as the agent read them. */
  | { type: 'folio'; bookingId: string; code: string; guestName: string; currency: string; total: number; balance: number }
  | {
      /** A guest's card dispute or chargeback, with the evidence document built from the hotel's records. */
      type: 'dispute';
      bookingId: string;
      code: string;
      guestName: string;
      checkIn: ISODate;
      checkOut: ISODate;
      /** The dispute Stripe reported; null for a chargeback the hotel heard about another way. */
      disputeId: string | null;
      /** Stripe's status (needs_response, under_review, won, lost…), or 'reported'. */
      status: string;
      reason: string | null;
      reasonLabel: string;
      amount: number;
      currency: string;
      /** The deadline to answer: Stripe's, or the one the person gave (YYYY-MM-DD). */
      respondBy: string | null;
      submittedAt: string | null;
      /** A Stripe dispute that still waits for evidence, and the viewer may send it. */
      canSubmit: boolean;
      /** The summary for the bank: the facts that answer the claim. */
      points: string[];
      /** For the hotel: what's missing or weak in the records. */
      gaps: string[];
      downloadHref: string;
      printHref: string;
      openHref: string;
    };

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

/**
 * A short plain-text account of what the agent showed in a reply (its text and the reservations on its cards), sent
 * back with the next message so the model can follow up on "her", "that guest" or "patel".
 */
export function replySummary(blocks: AgentBlock[], max = 1500): string {
  const lines: string[] = [];
  const booking = (b: { guest: { name: string }; code: string; status: string; roomType: { name: string }; room: { number: string } | null; checkIn: string; checkOut: string }) =>
    `${b.guest.name} (#${b.code}) · ${b.roomType.name}${b.room ? ` · room ${b.room.number}` : ' · no room'} · ${b.checkIn}→${b.checkOut} · ${b.status.toLowerCase()}`;
  for (const b of blocks) {
    if (b.type === 'text') lines.push(b.text);
    else if (b.type === 'bookings') lines.push(`${b.title}:`, ...b.items.slice(0, 12).map((i) => `- ${booking(i)}`));
    else if (b.type === 'booking') lines.push(`Reservation: ${booking(b.booking)}`);
    else if (b.type === 'plan') lines.push(`Prepared for confirmation: ${b.plan.title}`);
    else if (b.type === 'result') lines.push(`${b.title}: ${b.lines.join('; ')}`);
    else if (b.type === 'error') lines.push(`Error: ${b.text}`);
    else if (b.type === 'clarify') lines.push(`Asked: ${b.question}`);
    else if (b.type === 'folio') lines.push(`Folio of ${b.guestName} (#${b.code}): ${b.total} ${b.currency} in charges, balance ${b.balance} ${b.currency}`);
    else if (b.type === 'dispute')
      lines.push(
        `Dispute on ${b.guestName}’s reservation (#${b.code}): ${b.reasonLabel}, ${b.amount} ${b.currency}, ${b.disputeId ? `Stripe status ${b.status}` : 'reported outside Stripe'}${b.respondBy ? `, respond by ${b.respondBy}` : ''}${b.gaps.length ? `. Missing: ${b.gaps.join('; ')}` : ''}`
      );
    else if (b.type === 'report') {
      const cols = b.columns.map((c) => c.label).join(' | ');
      lines.push(`Report “${b.title}” (${b.from} to ${b.to}, ${b.totalRows} rows): ${cols}`);
      for (const r of b.rows.slice(0, 8)) lines.push(`- ${b.columns.map((c) => r[c.key] ?? '').join(' | ')}`);
      if (b.totals) lines.push(`- Total: ${b.columns.map((c) => b.totals?.[c.key] ?? '').join(' | ')}`);
    }
  }
  const text = lines.join('\n');
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
