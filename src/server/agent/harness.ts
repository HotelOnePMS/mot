/**
 * The model-driven agent harness.
 *
 * One Claude tool loop over the hotel's real tools, shared by every surface
 * that talks to the agent (console chat, voice, owner WhatsApp, and — for
 * changes — the AI advisor). The model decides what to look up and what to
 * change; this module keeps the guarantees the deterministic engine had:
 *
 *   • the model only ever calls the tools below — it never touches the DB;
 *   • read tools return live data, and the cards the person sees are built
 *     from those results, never from numbers the model wrote;
 *   • write tools never change anything. They resolve and validate through
 *     the same planners the deterministic engine uses (planWrite) and add
 *     steps to ONE signed plan the person confirms (plan.ts → confirmPlan).
 *
 * Tool inputs are defined once in zod: the JSON schema sent to Claude is
 * generated from them, and the same schema validates the model's input.
 */
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod/v4';
import { prisma } from '@/lib/prisma';
import { NO_EM_DASHES } from '@/lib/writing-style';
import type { AgentBlock, AgentContextState, AgentEvent } from '@/lib/agent/blocks';
import type { ISODate } from '@/lib/dto';
import { roundMoney } from '@/lib/currency';
import { describeSavedCharge, findSavedCharge, matchSavedCharge, type SavedChargeView } from '@/lib/saved-charges';
import { money } from '@/lib/status';
import { can } from '../authz';
import { addDaysISO, dayOfWeek, diffDays, eachNight, formatDay, isISODate } from '../dates';
import { hotelLocale } from '../services/hotels';
import { nightlyRates, propertyAvailability } from '../services/inventory';
import { mayManageSavedCharges, savedChargesFor } from '../services/saved-charges';
import { DomainError } from '../errors';
import { logError } from '../log';
import type { DateRange, GuestRef, Intent, RoomPrefs } from './nlu';
import { activityQuerySchema, searchActivity } from './activity-tool';
import { DISPUTE_REASON_HELP, DISPUTE_REASONS, disputeOnScreen, disputeRead, disputedStay, openDisputesRead, planSubmitDispute } from './dispute-tool';
import { folioOpSchema, folioRead, newWriteState, planFolioEdits, type ResolvedBooking, type WriteState } from './folio-plan';
import { doNotRentRead, guestRequestsRead, planDoNotRent, planGuestRequest } from './guest-tools';
import { channelStatusRead, nightAuditRead, planCloseDay, planRoomType } from './hotel-tools';
import { HarnessInputError } from './input-error';
import { planCardAuthorization, planRecordPayment, planRefund } from './money-tools';
import type { PlanStep } from './plan';
import { ReportInputError, REPORT_TOOL_DESCRIPTION, reportBlock, reportForModel, reportQuerySchema, runReportTool } from './report-tool';
import { resolveBooking } from './resolve';
import { answerFromSkills } from './skills';
import { maxRisk, planWrite, runRead, type PlanOutput, type ToolCtx } from './tools';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const MODEL = process.env.AGENT_LLM_MODEL || 'claude-opus-5-5';
const EFFORT = (['low', 'medium', 'high'] as const).find((e) => e === process.env.AGENT_LLM_EFFORT) ?? 'low';
const MAX_ROUNDS = 8;
const MAX_RESULT_CHARS = 14_000;
const BETAS: Anthropic.Beta.AnthropicBeta[] = ['server-side-fallback-2026-07-01'];

/** Model settings shared with the agent's helpers (the Reports page's report builder). */
export const AGENT_MODEL = { model: MODEL, effort: EFFORT, betas: BETAS } as const;

/** The model engine runs when an Anthropic key is configured, unless AGENT_LLM_ENABLED=false turns it off. */
export function llmConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY && process.env.AGENT_LLM_ENABLED !== 'false';
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .refine((v) => isISODate(v), 'Not a valid date');

const guest = z
  .object({
    code: z.string().max(40).optional().describe('Confirmation code, e.g. "K7Q2MD".'),
    name: z.string().max(120).optional().describe('Guest name or surname, e.g. "Okafor" or "the Smiths".'),
    room_number: z.string().max(20).optional().describe('Room the guest is in or assigned to.'),
  })
  .describe('Who the reservation belongs to. Give at least one field; a code is most precise.');

const prefs = z
  .object({
    high_floor: z.boolean().optional(),
    low_floor: z.boolean().optional(),
    tags: z.array(z.enum(['quiet', 'accessible', 'view', 'corner'])).max(4).optional(),
  })
  .optional()
  .describe('Room preferences used when no room number is given.');

const weekdays = z
  .array(z.number().int().min(0).max(6))
  .max(7)
  .optional()
  .describe('Only these nights of the week: 0 = Sunday … 6 = Saturday. Omit for every night in the range.');

const rateChange = z
  .object({
    room_type: z.string().min(1).max(120).describe('Room type name exactly as list_room_types shows it, or its id.'),
    from: date.optional().describe('First night, YYYY-MM-DD (inclusive). Use with `to`.'),
    to: date.optional().describe('Last night, YYYY-MM-DD (INCLUSIVE). Use with `from`.'),
    nights: z.array(date).max(120).optional().describe('Specific nights instead of a range, e.g. ["2026-11-13","2026-11-14"].'),
    weekdays,
    price: z.number().positive().max(100_000).optional().describe('Set this exact nightly price.'),
    percent: z.number().min(-50).max(50).optional().describe('Or adjust the current price by this percent (e.g. -10).'),
    reset: z.boolean().optional().describe('Or remove overrides so the nights go back to the base price.'),
  })
  .describe('One rate change. Give nights or from/to, and exactly one of price, percent or reset.');

interface ToolDef {
  kind: 'read' | 'write';
  label: string;
  description: string;
  schema: z.ZodType;
}

const definitions = {
  // ---- Reads -------------------------------------------------------------
  today_overview: {
    kind: 'read',
    label: 'Checking today',
    description: 'Today at a glance: arrivals, departures, in-house guests, occupancy, room readiness and alerts. For a briefing ("brief me", "how are we doing today?").',
    schema: z.object({}),
  },
  list_arrivals: {
    kind: 'read',
    label: 'Looking up arrivals',
    description: 'Guests arriving on a date, with booking status and assigned rooms.',
    schema: z.object({ date: date.optional().describe('Defaults to today.') }),
  },
  list_departures: {
    kind: 'read',
    label: 'Looking up departures',
    description: 'Guests departing on a date.',
    schema: z.object({ date: date.optional().describe('Defaults to today.') }),
  },
  list_in_house: {
    kind: 'read',
    label: 'Looking up in-house guests',
    description: 'Guests currently checked in.',
    schema: z.object({}),
  },
  find_reservation: {
    kind: 'read',
    label: 'Finding the reservation',
    description:
      'Find one reservation by guest name, confirmation code or room number: dates, room, price, balance and status. ' +
      'For the charges and payments on it use get_folio; for what happened to it and who did it, search_activity_log.',
    schema: z.object({ guest }),
  },
  check_availability: {
    kind: 'read',
    label: 'Checking availability',
    description: 'Rooms free per room type and the exact price the booking site would charge for a stay.',
    schema: z.object({
      check_in: date,
      check_out: date.describe('Departure day (exclusive).'),
      guests: z.number().int().min(1).max(40).default(2),
      rooms: z.number().int().min(1).max(20).default(1),
    }),
  },
  occupancy_forecast: {
    kind: 'read',
    label: 'Pulling occupancy',
    description: 'Occupancy, rooms sold, revenue and ADR per night for a date range (up to 120 nights). For totals, breakdowns or anything custom, use run_report.',
    schema: z.object({ from: date, to: date.describe('End of range, exclusive.') }),
  },
  list_room_types: {
    kind: 'read',
    label: 'Reading room types',
    description: 'Every room type with its id, base price, room count and capacity. Call this before changing rates or creating a reservation.',
    schema: z.object({}),
  },
  get_rate_calendar: {
    kind: 'read',
    label: 'Reading the rate calendar',
    description: 'The nightly price per room type for a date range (up to 120 nights), and whether each night is a custom rate or the base price.',
    schema: z.object({
      from: date,
      to: date.describe('End of range, exclusive.'),
      room_type: z.string().max(120).optional().describe('One room type name or id; omit for all.'),
    }),
  },
  room_board: {
    kind: 'read',
    label: 'Checking rooms',
    description: 'Rooms with cleaning status, occupancy and out-of-order flags, optionally filtered. For today’s cleaning tasks and who is on them, use housekeeping_board.',
    schema: z.object({
      status: z.enum(['CLEAN', 'DIRTY', 'OUT_OF_ORDER']).optional(),
      occupancy: z.enum(['VACANT']).optional(),
      floor: z.string().max(10).optional(),
    }),
  },
  housekeeping_board: {
    kind: 'read',
    label: 'Checking housekeeping',
    description: 'Today’s cleaning tasks and the housekeeping team with their loads.',
    schema: z.object({}),
  },
  search_activity_log: {
    kind: 'read',
    label: 'Searching the activity log',
    description:
      'Search and analyze the hotel’s logs: every change people, you (the agent) and the system made, a reservation’s status history, and the booking channels’ sync log. ' +
      'Use it for any question about what happened, who did something or when ("who cancelled the Patel booking?", "what did Maria do last night?", "any refunds this week?", "why is room 12 out of order?", "did Expedia sync fail?"), ' +
      'and with worth_checking for "anything I should look at?" or "anything suspicious?". Filter by days, kinds, person, guest, room, words and source; it returns the entries, counts by kind, person, source and day, ' +
      'what’s worth a second look and why, and patterns across them. The person sees the latest entries as a card. Managers and owners.',
    schema: activityQuerySchema({ guest, date }),
  },
  suggest_rooms: {
    kind: 'read',
    label: 'Finding the best rooms',
    description: 'Rank rooms for a reservation by readiness and preferences.',
    schema: z.object({ guest, prefs }),
  },
  hotel_knowledge: {
    kind: 'read',
    label: 'Checking the hotel’s saved answers',
    description: 'Answer a policy or amenity question (parking, pets, breakfast, cancellation policy…) from the answers the hotel saved. To save a new answer the person tells you, use remember.',
    schema: z.object({ question: z.string().min(2).max(300) }),
  },
  get_folio: {
    kind: 'read',
    label: 'Opening the folio',
    description:
      'A reservation’s folio: the room line, taxes and fees (with the percentage of the room for percentage taxes), extra charges, allowances, payments and the balance, ' +
      'each line with the ref edit_folio uses ("room", "charge:<n>"). The person sees it as a live card they can also edit by hand.',
    schema: z.object({ guest }),
  },
  run_report: {
    kind: 'read',
    label: 'Building the report',
    description: REPORT_TOOL_DESCRIPTION,
    schema: reportQuerySchema,
  },
  get_dispute: {
    kind: 'read',
    label: 'Preparing the dispute evidence',
    description:
      'A guest’s card dispute or chargeback ("Lucas raised a chargeback", "the bank says room 12 disputed the charge"): finds the reservation and any dispute Stripe reported for it, ' +
      'and builds the evidence document from the hotel’s records (a summary for the bank that answers the claim, the itemized folio, payments and card checks, the policy the guest accepted, ID check, registration card, check-in and check-out), ' +
      'with what’s missing or weak. The person sees it as a card with buttons to download or print the document. Leave out guest to see the disputes from Stripe that still need a response.',
    schema: z.object({
      guest: guest.optional(),
      reason: z.enum(DISPUTE_REASONS).optional().describe(DISPUTE_REASON_HELP),
      amount: z.number().positive().max(1_000_000).optional().describe('The amount disputed, when the person said it and Stripe didn’t report the dispute. Defaults to what the guest paid.'),
      respond_by: date.optional().describe('The deadline the bank or card processor gave, when the person said it.'),
    }),
  },
  check_do_not_rent: {
    kind: 'read',
    label: 'Checking the do-not-rent list',
    description:
      'Whether a guest is on the hotel’s do-not-rent list and why: give their reservation (guest), or an email or phone for someone not booked yet, or just a name. ' +
      'With nothing, the whole list. Use before booking someone the person is unsure about, or when they ask. To add or remove someone use update_do_not_rent.',
    schema: z.object({
      guest: guest.optional(),
      name: z.string().max(120).optional(),
      email: z.string().max(200).optional(),
      phone: z.string().max(40).optional(),
    }),
  },
  list_guest_requests: {
    kind: 'read',
    label: 'Reading guest messages',
    description:
      'Messages and callback or booking requests guests left with the voice line, WhatsApp or the booking page assistant: who, how to reach them, what they want, when, and whether someone handled it. ' +
      'Use for "any messages?", "who called?", "what does the guest in the voicemail want?". Each has the request_id mark_guest_request uses.',
    schema: z.object({ status: z.enum(['open', 'handled', 'all']).default('open') }),
  },
  night_audit_status: {
    kind: 'read',
    label: 'Checking the night audit',
    description:
      'The night audit for a business day (default: the day that just ended): arrivals that never came (possible no-shows), guests past check-out still in house, in-house guests with something to pay, ' +
      'room readiness, the day’s numbers, and whether the day is closed. Call it before close_business_day, and for "what’s left before I close the day?".',
    schema: z.object({ date: date.optional().describe('The business day, YYYY-MM-DD. Default: yesterday before noon at the hotel, today after.') }),
  },
  channel_status: {
    kind: 'read',
    label: 'Checking the booking channels',
    description:
      'The booking channels (Expedia, Booking.com): connected or not, test or live, what they’re sent, when rates and availability were last sent and reservations last pulled, and recent sync errors. ' +
      'For a channel’s history over days use search_activity_log with kinds ["channels"].',
    schema: z.object({}),
  },
  // ---- Writes (planned, confirmed by the person) -------------------------
  set_rates: {
    kind: 'write',
    label: 'Preparing the rate changes',
    description:
      'Change nightly rates: an exact price, a percent change, or a reset to base, for one room type over a range or a list of nights, optionally only on some weekdays. ' +
      'Put every change the person asked for in one call. Use `to` as the LAST night (inclusive). For a room type’s base price (nights without their own rate), use update_room_type.',
    schema: z.object({ changes: z.array(rateChange).min(1).max(40) }),
  },
  check_in: {
    kind: 'write',
    label: 'Preparing the check-in',
    description: 'Check a guest in, into a given room number or the best ready room for their preferences.',
    schema: z.object({ guest, room_number: z.string().max(20).optional(), prefs }),
  },
  check_out: {
    kind: 'write',
    label: 'Preparing the check-out',
    description: 'Check a guest out; their room is marked dirty and queued for housekeeping. If they paid what they owe at the desk, plan record_payment first.',
    schema: z.object({ guest }),
  },
  assign_room: {
    kind: 'write',
    label: 'Preparing the room assignment',
    description: 'Assign or move a reservation to a room number, or the best room for the preferences.',
    schema: z.object({ guest, room_number: z.string().max(20).optional(), prefs }),
  },
  assign_rooms_to_arrivals: {
    kind: 'write',
    label: 'Planning rooms for arrivals',
    description: 'Give every arrival today that has no room the best free room.',
    schema: z.object({ prefs }),
  },
  add_note: {
    kind: 'write',
    label: 'Preparing the note',
    description: 'Append a note to a reservation.',
    schema: z.object({ guest, note: z.string().min(1).max(500) }),
  },
  change_booking_status: {
    kind: 'write',
    label: 'Preparing the status change',
    description: 'Confirm, cancel or mark a reservation as a no-show. Cancelling doesn’t refund: add refund_payment to the same plan when they want money back.',
    schema: z.object({ guest, status: z.enum(['confirm', 'cancel', 'no_show']), reason: z.string().max(300).optional() }),
  },
  create_reservation: {
    kind: 'write',
    label: 'Preparing the reservation',
    description: 'Create a front-desk reservation for a guest at the live price (pay at the property unless paid now).',
    schema: z.object({
      room_type: z.string().min(1).max(120),
      check_in: date,
      check_out: date.describe('Departure day (exclusive).'),
      guests: z.number().int().min(1).max(40).default(2),
      rooms: z.number().int().min(1).max(20).default(1),
      first_name: z.string().min(1).max(80),
      last_name: z.string().min(1).max(80),
      email: z.string().email().max(200).optional(),
      phone: z.string().max(40).optional(),
      notes: z.string().max(500).optional(),
      paid: z.boolean().optional().describe('True only when the guest has paid in full now.'),
    }),
  },
  edit_folio: {
    kind: 'write',
    label: 'Preparing the folio changes',
    description:
      'Change a reservation’s folio. Put every change for it in one call; they run in order once the person confirms. ' +
      'add_charge: an extra charge (pet fee, late check-out, minibar, damage…). Leave out amount to use the hotel’s usual price for it (the usual charges are listed with the conversation); ' +
      'if it has none and the person didn’t say, ask them how much instead of guessing. quantity multiplies it (two pets). ' +
      'set_line: a line’s new amount, name or date. remove_charge: take a charge off. ' +
      'set_total: several lines together come to one amount ("make the room and tax together $50" → lines ["room", the tax refs]); the room and percentage taxes share it in proportion, fixed fees keep theirs. ' +
      'discount: take money off the stay with a reason (an allowance; managers and owners). Lines are refs from get_folio: call it first for anything but add_charge.',
    schema: z.object({
      guest,
      edits: z.array(folioOpSchema).min(1).max(20),
      reason: z.string().max(200).optional().describe('Why, for the activity log.'),
    }),
  },
  save_charge: {
    kind: 'write',
    label: 'Saving the usual charge',
    description:
      'Remember what a charge usually costs at this hotel ("pet fee is always $50", "rollaway bed is $20 a night"), or change the price of one already saved under that name. ' +
      'From then on edit_folio’s add_charge uses it when no amount is given, and the folio’s Add charge dialog offers it.',
    schema: z.object({
      name: z.string().min(1).max(80).describe('As it should read on a folio, e.g. "Pet fee".'),
      amount: z.number().positive().max(100_000).describe('The usual price, in the hotel’s currency.'),
      unit: z.enum(['stay', 'night', 'item']).default('stay').describe('stay: once per stay; night: every night of the stay; item: each one (per pet, per bottle).'),
      note: z.string().max(200).optional().describe('Anything staff should know, e.g. "per pet, cleaning included".'),
    }),
  },
  remove_saved_charge: {
    kind: 'write',
    label: 'Removing the usual charge',
    description: 'Forget one of the hotel’s usual charges. Folios that already have it keep it.',
    schema: z.object({ name: z.string().min(1).max(80) }),
  },
  submit_dispute_evidence: {
    kind: 'write',
    label: 'Preparing to send the evidence',
    description:
      'Send the evidence for a dispute Stripe reported to the cardholder’s bank, only when the person asks to (after they’ve seen it with get_dispute). ' +
      'It can’t be undone and a dispute is answered once, so it is a step they confirm. Owners, or roles allowed to manage disputes.',
    schema: z.object({ guest }),
  },
  record_payment: {
    kind: 'write',
    label: 'Preparing the payment',
    description:
      'Record money the guest paid at the desk outside HotelOne’s card flow: cash, a card on the hotel’s own terminal (needs the last four digits), or another way (bank transfer, paid to the OTA, an invoice; say how in note). ' +
      'For the stay (default) or a security deposit. Leave out amount for the whole balance (or the hotel’s usual deposit). ' +
      'Not for charging a card through HotelOne (the card reader, typing the card in): that is the reservation’s Payments card, and you never handle card numbers.',
    schema: z.object({
      guest,
      method: z.enum(['cash', 'own_terminal', 'other']),
      amount: z.number().positive().max(1_000_000).optional(),
      for: z.enum(['stay', 'deposit']).default('stay'),
      tendered: z.number().positive().max(1_000_000).optional().describe('Cash only: what the guest handed over, when change was given.'),
      card_last4: z.string().max(8).optional().describe('own_terminal: the last four digits the terminal printed. Never a full card number.'),
      card_brand: z.string().max(20).optional(),
      approval_code: z.string().max(40).optional().describe('own_terminal: the approval code from the terminal slip.'),
      note: z.string().max(200).optional().describe('other: how it was paid. Otherwise anything worth noting.'),
    }),
  },
  refund_payment: {
    kind: 'write',
    label: 'Preparing the refund',
    description:
      'Give a guest money back: to the card they paid with through HotelOne (Stripe), cash handed back at the desk, or a record of money given back another way for a payment recorded at the desk. ' +
      'Give amount, or full for everything they paid; if the person didn’t say how much, call it without either to learn what can be refunded and what the cancellation policy suggests, then ask. ' +
      'reason is required. also_discount when the stay should also cost that much less (goodwill, a broken AC, a night not used), so it isn’t owed again; not for a cancelled stay. ' +
      'Cancelling a reservation doesn’t refund it: add this in the same plan if they want both. Security deposits are settled at check-out on the Payments card. Managers and owners.',
    schema: z.object({
      guest,
      amount: z.number().positive().max(1_000_000).optional(),
      full: z.boolean().optional().describe('Refund everything that can be refunded.'),
      from: z.enum(['card', 'cash', 'other']).optional().describe('Which payment, when the person said: card (through HotelOne), cash, other (the hotel’s own terminal, a transfer).'),
      reason: z.string().min(1).max(200),
      also_discount: z.boolean().optional(),
    }),
  },
  request_card_authorization: {
    kind: 'write',
    label: 'Preparing the card authorization',
    description:
      'Email a third party (a company, a parent, a travel agent) the hotel’s card authorization form for someone’s stay: they sign online, add a photo of their ID, and authorize their card for the stay and optionally incidentals. ' +
      'Needs the cardholder’s name and email. A new request replaces an earlier link.',
    schema: z.object({
      guest,
      cardholder_name: z.string().min(2).max(120),
      cardholder_email: z.string().email().max(200),
      guest_names: z.array(z.string().min(1).max(120)).max(10).optional().describe('Who the card pays for. Default: the guest on the reservation.'),
      covers_incidentals: z.boolean().optional(),
      incidentals_limit: z.number().positive().max(100_000).optional(),
    }),
  },
  update_do_not_rent: {
    kind: 'write',
    label: 'Preparing the do-not-rent change',
    description:
      'Add a guest to the hotel’s do-not-rent list with the reason (from their reservation, or a name with an email or phone), or take them off it. ' +
      'Future bookings with that email or phone are flagged to the front desk. Ask for the reason if the person didn’t give one.',
    schema: z.object({
      action: z.enum(['add', 'remove']),
      guest: guest.optional(),
      name: z.string().max(120).optional(),
      email: z.string().max(200).optional(),
      phone: z.string().max(40).optional(),
      reason: z.string().max(1000).optional().describe('Why (add only), in the person’s words: the next shift sees it.'),
    }),
  },
  mark_guest_request: {
    kind: 'write',
    label: 'Preparing the message update',
    description: 'Mark a guest’s message or callback request handled (or open it again). Use the request_id from list_guest_requests, or who left it.',
    schema: z.object({
      request_id: z.string().max(40).optional(),
      from: z.string().max(120).optional().describe('The name of who left it, when there’s no id.'),
      status: z.enum(['handled', 'open']).default('handled'),
    }),
  },
  close_business_day: {
    kind: 'write',
    label: 'Preparing the night audit',
    description:
      'Close the business day (the night audit): marks the arrivals that never came as no-shows as the person says (all, the listed codes, or none), flags occupied rooms for stayover cleaning, and saves the day’s numbers. ' +
      'Call night_audit_status first; if arrivals never came and the person didn’t say what to do with them, ask. A closed day can’t be reopened.',
    schema: z.object({
      date: date.optional().describe('Default: the day that just ended.'),
      no_shows: z.enum(['all', 'listed', 'none']).optional(),
      no_show_codes: z.array(z.string().max(40)).max(60).optional().describe('With no_shows "listed": the confirmation codes to mark.'),
      flag_stayovers: z.boolean().optional().describe('Flag occupied rooms for stayover cleaning (default true).'),
      notes: z.string().max(500).optional(),
    }),
  },
  update_room_type: {
    kind: 'write',
    label: 'Preparing the room type change',
    description:
      'Change a room type’s own settings: its base price (the default nightly price for nights without their own rate), how many it sleeps, its name, description, how many rooms it has, or whether it’s for sale. ' +
      'For the price of particular nights or a date range use set_rates instead.',
    schema: z.object({
      room_type: z.string().min(1).max(120).describe('Name exactly as list_room_types shows it, or its id.'),
      base_price: z.number().positive().max(100_000).optional(),
      capacity: z.number().int().min(1).max(20).optional(),
      name: z.string().min(2).max(80).optional(),
      description: z.string().max(2000).optional(),
      total_rooms: z.number().int().min(0).max(2000).optional(),
      for_sale: z.boolean().optional(),
    }),
  },
  remember: {
    kind: 'write',
    label: 'Saving it for next time',
    description:
      'Keep a lasting fact or policy about the hotel that the person tells you ("late check-out is free until 1pm", "the pool closes at 9", "from now on…") as the hotel’s saved answer to a question; ' +
      'hotel_knowledge finds it from then on, and it replaces an earlier answer to the same question. Not for what a charge costs: use save_charge.',
    schema: z.object({
      question: z.string().min(3).max(160).describe('The question it answers, as someone would ask it: "Until when is late check-out free?"'),
      answer: z.string().min(1).max(2000).describe('The answer, in full sentences.'),
      share_with_guests: z.boolean().optional().describe('True only when guests may hear it too (the voice line, the guest assistant). Default: staff only.'),
    }),
  },
  set_room_status: {
    kind: 'write',
    label: 'Preparing room updates',
    description: 'Mark rooms clean, dirty or inspected.',
    schema: z.object({ room_numbers: z.array(z.string().max(20)).min(1).max(60), status: z.enum(['CLEAN', 'DIRTY', 'INSPECTED']) }),
  },
  set_out_of_order: {
    kind: 'write',
    label: 'Preparing the room change',
    description: 'Take a room out of order (with a reason) or return it to service.',
    schema: z.object({ room_number: z.string().max(20), out_of_order: z.boolean(), reason: z.string().max(200).optional() }),
  },
  assign_cleaning: {
    kind: 'write',
    label: 'Planning housekeeping',
    description: 'Assign rooms to a housekeeper by name, or to whoever has the lightest load.',
    schema: z.object({ room_numbers: z.array(z.string().max(20)).min(1).max(60), housekeeper: z.string().max(80).optional() }),
  },
  auto_assign_housekeeping: {
    kind: 'write',
    label: 'Planning housekeeping',
    description: 'Spread every unassigned dirty room across the housekeeping team, arrivals first.',
    schema: z.object({}),
  },
} satisfies Record<string, ToolDef>;

export type HotelToolName = keyof typeof definitions;

const isToolName = (name: string): name is HotelToolName => Object.prototype.hasOwnProperty.call(definitions, name);

function toApiTool(name: string, def: ToolDef, extra?: { property_id?: true }): Anthropic.Beta.BetaTool {
  const schema = z.toJSONSchema(def.schema, { io: 'input' }) as Record<string, unknown> & { properties?: Record<string, unknown>; required?: string[] };
  delete schema.$schema;
  if (extra?.property_id) {
    schema.properties = { property_id: { type: 'string', description: 'The property id from the portfolio snapshot.' }, ...(schema.properties ?? {}) };
    schema.required = ['property_id', ...(schema.required ?? [])];
  }
  return { name, description: def.description, input_schema: schema as Anthropic.Beta.BetaTool.InputSchema };
}

/** Every hotel tool, for the console agent. */
export const HOTEL_TOOLS: Anthropic.Beta.BetaTool[] = Object.entries(definitions).map(([n, d]) => toApiTool(n, d));

/** The write tools with a property_id, for the portfolio-level AI advisor. */
/** Writes about one guest, their money or the night audit: done in the hotel's own console, not from the portfolio advisor. */
const NOT_FOR_ADVISOR = new Set<string>([
  'create_reservation',
  'edit_folio',
  'submit_dispute_evidence',
  'record_payment',
  'refund_payment',
  'request_card_authorization',
  'update_do_not_rent',
  'mark_guest_request',
  'close_business_day',
]);

export const HOTEL_WRITE_TOOLS_FOR_ADVISOR: Anthropic.Beta.BetaTool[] = Object.entries(definitions)
  .filter(([n, d]) => d.kind === 'write' && !NOT_FOR_ADVISOR.has(n))
  .map(([n, d]) => toApiTool(n, d, { property_id: true }));

export const isHotelWriteTool = (name: string) => isToolName(name) && definitions[name].kind === 'write';
export const hotelToolLabel = (name: string) => (isToolName(name) ? definitions[name].label : 'Working');

export { HarnessInputError };

function parseInput<N extends HotelToolName>(name: N, raw: unknown): z.infer<(typeof definitions)[N]['schema']> {
  const parsed = definitions[name].schema.safeParse(raw ?? {});
  if (!parsed.success) throw new HarnessInputError(`Invalid input: ${parsed.error.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; ')}`);
  return parsed.data as z.infer<(typeof definitions)[N]['schema']>;
}

// ---------------------------------------------------------------------------
// Mapping tool inputs onto the engine's intents
// ---------------------------------------------------------------------------

const toRef = (g: z.infer<typeof guest>): GuestRef => {
  const ref: GuestRef = { code: g.code?.replace(/^#/, '').toUpperCase() || undefined, name: g.name || undefined, roomNumber: g.room_number || undefined };
  if (!ref.code && !ref.name && !ref.roomNumber) throw new HarnessInputError('Say which guest: give a name, confirmation code or room number.');
  return ref;
};
const toPrefs = (p: z.infer<typeof prefs>): RoomPrefs => ({ highFloor: p?.high_floor, lowFloor: p?.low_floor, tags: p?.tags ?? [] });
const range = (from: ISODate, to: ISODate): DateRange => {
  if (to <= from) throw new HarnessInputError('`to` must be after `from` (it is exclusive).');
  if (diffDays(from, to) > 120) throw new HarnessInputError('Ranges are limited to 120 nights.');
  return { from, to, label: `${formatDay(from)} – ${formatDay(addDaysISO(to, -1))}` };
};

function readIntent(name: HotelToolName, raw: unknown, today: ISODate): Intent | null {
  switch (name) {
    case 'today_overview':
      return { kind: 'overview' };
    case 'list_arrivals': {
      const a = parseInput('list_arrivals', raw);
      const day = a.date ?? today;
      return { kind: 'arrivals', day, label: day === today ? 'today' : formatDay(day) };
    }
    case 'list_departures': {
      const a = parseInput('list_departures', raw);
      const day = a.date ?? today;
      return { kind: 'departures', day, label: day === today ? 'today' : formatDay(day) };
    }
    case 'list_in_house':
      return { kind: 'inHouse' };
    case 'find_reservation':
      return { kind: 'find', ref: toRef(parseInput('find_reservation', raw).guest) };
    case 'check_availability': {
      const a = parseInput('check_availability', raw);
      return { kind: 'availability', range: range(a.check_in, a.check_out), guests: a.guests, rooms: a.rooms };
    }
    case 'occupancy_forecast': {
      const a = parseInput('occupancy_forecast', raw);
      return { kind: 'occupancy', range: range(a.from, a.to) };
    }
    case 'room_board': {
      const a = parseInput('room_board', raw);
      const label = a.status === 'DIRTY' ? 'Rooms to clean' : a.status === 'OUT_OF_ORDER' ? 'Out of order' : a.occupancy === 'VACANT' ? 'Vacant rooms' : 'Rooms';
      return { kind: 'rooms', filter: { status: a.status, occupancy: a.occupancy, floor: a.floor }, label };
    }
    case 'housekeeping_board':
      return { kind: 'housekeeping' };
    case 'suggest_rooms': {
      const a = parseInput('suggest_rooms', raw);
      return { kind: 'suggestRooms', ref: toRef(a.guest), prefs: toPrefs(a.prefs) };
    }
    default:
      return null;
  }
}

function writeIntent(name: HotelToolName, raw: unknown): Intent | null {
  switch (name) {
    case 'check_in': {
      const a = parseInput('check_in', raw);
      return { kind: 'checkIn', ref: toRef(a.guest), roomNumber: a.room_number, prefs: toPrefs(a.prefs) };
    }
    case 'check_out':
      return { kind: 'checkOut', ref: toRef(parseInput('check_out', raw).guest) };
    case 'assign_room': {
      const a = parseInput('assign_room', raw);
      return { kind: 'assignRoom', ref: toRef(a.guest), roomNumber: a.room_number, prefs: toPrefs(a.prefs) };
    }
    case 'assign_rooms_to_arrivals':
      return { kind: 'assignArrivals', prefs: toPrefs(parseInput('assign_rooms_to_arrivals', raw).prefs) };
    case 'add_note': {
      const a = parseInput('add_note', raw);
      return { kind: 'note', ref: toRef(a.guest), text: a.note };
    }
    case 'change_booking_status': {
      const a = parseInput('change_booking_status', raw);
      const ref = toRef(a.guest);
      return a.status === 'confirm' ? { kind: 'confirm', ref } : a.status === 'cancel' ? { kind: 'cancel', ref, reason: a.reason } : { kind: 'noShow', ref };
    }
    case 'set_room_status': {
      const a = parseInput('set_room_status', raw);
      return { kind: 'roomStatus', roomNumbers: a.room_numbers, status: a.status };
    }
    case 'set_out_of_order': {
      const a = parseInput('set_out_of_order', raw);
      return a.out_of_order ? { kind: 'outOfOrder', roomNumber: a.room_number, reason: a.reason } : { kind: 'backInService', roomNumber: a.room_number };
    }
    case 'assign_cleaning': {
      const a = parseInput('assign_cleaning', raw);
      return { kind: 'assignCleaning', roomNumbers: a.room_numbers, who: a.housekeeper };
    }
    case 'auto_assign_housekeeping':
      return { kind: 'autoAssignCleaning' };
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Tools the deterministic engine never had
// ---------------------------------------------------------------------------

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

async function roomTypesOf(propertyId: string) {
  return prisma.roomType.findMany({
    where: { propertyId, isActive: true },
    select: { id: true, name: true, basePrice: true, totalRooms: true, capacity: true },
    orderBy: { basePrice: 'asc' },
  });
}

/** Exactly one room type for a name or id, or an error the model can act on. */
async function resolveRoomTypeExact(propertyId: string, hint: string) {
  const all = await roomTypesOf(propertyId);
  const h = norm(hint);
  const byId = all.find((rt) => rt.id === hint);
  if (byId) return byId;
  const exact = all.filter((rt) => norm(rt.name) === h);
  if (exact.length === 1) return exact[0];
  const partial = all.filter((rt) => norm(rt.name).includes(h) || h.includes(norm(rt.name)));
  if (partial.length === 1) return partial[0];
  throw new HarnessInputError(`No single room type matches “${hint}”. Room types here: ${all.map((rt) => rt.name).join(', ')}.`);
}

function nightsLabel(nights: ISODate[]): string {
  if (nights.length === 1) return formatDay(nights[0], 'weekday');
  const contiguous = nights.every((d, i) => i === 0 || diffDays(nights[i - 1], d) === 1);
  if (contiguous) return `${formatDay(nights[0])}–${formatDay(nights[nights.length - 1])}`;
  if (nights.length <= 4) return nights.map((d) => formatDay(d, 'weekday')).join(', ');
  return `${nights.length} nights, ${formatDay(nights[0])}–${formatDay(nights[nights.length - 1])}`;
}

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

async function planSetRates(ctx: ToolCtx, raw: unknown): Promise<PlanOutput> {
  if (!can(ctx.actor, 'rates.write')) return { steps: [], warnings: [], risk: 'low', blocks: [{ type: 'error', text: 'Rate changes are made by managers and owners.' }] };
  const { changes } = parseInput('set_rates', raw);
  const { currency } = await hotelLocale(ctx.propertyId);
  const fmt = (n: number) => money(n, { cents: false, currency });
  const steps: PlanStep[] = [];
  const warnings: string[] = [];
  for (const [i, c] of changes.entries()) {
    const which = `changes[${i}]`;
    const kinds = [c.price !== undefined, c.percent !== undefined, !!c.reset].filter(Boolean).length;
    if (kinds !== 1) throw new HarnessInputError(`${which}: give exactly one of price, percent or reset.`);
    let nights: ISODate[];
    if (c.nights?.length) {
      nights = [...new Set(c.nights)].sort();
    } else if (c.from && c.to) {
      if (c.to < c.from) throw new HarnessInputError(`${which}: \`to\` is the last night and can’t be before \`from\`.`);
      nights = eachNight(c.from, addDaysISO(c.to, 1));
    } else {
      throw new HarnessInputError(`${which}: give \`nights\` or both \`from\` and \`to\`.`);
    }
    if (c.weekdays?.length) nights = nights.filter((d) => c.weekdays!.includes(dayOfWeek(d)));
    if (!nights.length) throw new HarnessInputError(`${which}: no nights match those dates and weekdays.`);
    if (nights.length > 400) throw new HarnessInputError(`${which}: at most 400 nights per change.`);
    if (nights[0] < ctx.today) throw new HarnessInputError(`${which}: ${nights[0]} is in the past (today is ${ctx.today}).`);
    const rt = await resolveRoomTypeExact(ctx.propertyId, c.room_type);
    const current = await nightlyRates(prisma, rt.id, nights[0], addDaysISO(nights[nights.length - 1], 1));
    const byDate = new Map(current.map((r) => [r.date, r.price]));
    const before = [...new Set(nights.map((d) => byDate.get(d) ?? Number(rt.basePrice)))];
    const beforeLabel = before.length === 1 ? fmt(before[0]) : `${fmt(Math.min(...before))}–${fmt(Math.max(...before))}`;
    const afterLabel = c.price !== undefined ? fmt(c.price) : c.reset ? `base ${fmt(Number(rt.basePrice))}` : `${c.percent! > 0 ? '+' : ''}${c.percent}%`;
    if (c.price !== undefined && before.length && Math.abs(c.price - before[0]) / before[0] > 0.5) {
      warnings.push(`${rt.name}: ${fmt(c.price)} is more than 50% away from the current ${fmt(before[0])}. Double-check it.`);
    }
    const days = c.weekdays?.length && c.weekdays.length < 7 ? ` (${c.weekdays.map((d) => WEEKDAY[d]).join('/')} only)` : '';
    steps.push({
      tool: 'set_rates',
      args: { roomTypeId: rt.id, nights, ...(c.price !== undefined ? { price: c.price } : c.reset ? { reset: true } : { percent: c.percent }) },
      summary: `${rt.name} · ${nightsLabel(nights)}${days}: ${beforeLabel} → ${afterLabel}`,
      detail: `${nights.length} night${nights.length === 1 ? '' : 's'}`,
    });
  }
  warnings.unshift('Existing reservations keep the price they booked at. The booking site and connected channels update right away.');
  return { steps, warnings, risk: 'medium' };
}

async function planCreateReservation(ctx: ToolCtx, raw: unknown): Promise<PlanOutput> {
  if (!can(ctx.actor, 'booking.create')) return { steps: [], warnings: [], risk: 'low', blocks: [{ type: 'error', text: 'Your role can’t create reservations.' }] };
  const a = parseInput('create_reservation', raw);
  if (a.check_out <= a.check_in) throw new HarnessInputError('check_out must be after check_in.');
  if (a.check_in < ctx.today) throw new HarnessInputError(`check_in ${a.check_in} is in the past (today is ${ctx.today}).`);
  const rt = await resolveRoomTypeExact(ctx.propertyId, a.room_type);
  const avail = await propertyAvailability({ propertyId: ctx.propertyId, checkIn: a.check_in, checkOut: a.check_out, guests: a.guests, rooms: a.rooms });
  const row = avail.find((r) => r.id === rt.id);
  if (!row || row.available < a.rooms) throw new HarnessInputError(`${rt.name} has ${row?.available ?? 0} room(s) free for those dates, which isn’t enough. Check availability for another type.`);
  const { currency } = await hotelLocale(ctx.propertyId);
  const nights = diffDays(a.check_in, a.check_out);
  return {
    steps: [
      {
        tool: 'create_reservation',
        args: {
          propertyId: ctx.propertyId,
          roomTypeId: rt.id,
          checkIn: a.check_in,
          checkOut: a.check_out,
          guests: a.guests,
          rooms: a.rooms,
          firstName: a.first_name,
          lastName: a.last_name,
          email: a.email,
          phone: a.phone,
          notes: a.notes,
          paid: !!a.paid,
        },
        summary: `Book ${a.first_name} ${a.last_name} · ${rt.name} · ${formatDay(a.check_in)}–${formatDay(a.check_out)}`,
        detail: `${nights} night${nights === 1 ? '' : 's'} · ${a.guests} guest${a.guests === 1 ? '' : 's'}${a.rooms > 1 ? ` · ${a.rooms} rooms` : ''} · ${row.quote ? money(row.quote.total, { currency }) : ''} · ${a.paid ? 'paid at the desk' : 'pay at the property'}`,
      },
    ],
    warnings: [],
    risk: 'low',
  };
}

/** Plan against one reservation, or stop with the question that tells the guests apart. */
async function withBooking(ctx: ToolCtx, g: z.infer<typeof guest>, plan: (b: ResolvedBooking) => Promise<PlanOutput>): Promise<PlanOutput> {
  const r = await resolveBooking(ctx, toRef(g), 'any');
  if (!r.ok) return { steps: [], warnings: [], risk: 'low', blocks: [r.block], abort: true };
  return plan(r.value);
}

async function planEditFolio(ctx: ToolCtx, raw: unknown, state: WriteState): Promise<PlanOutput> {
  const a = parseInput('edit_folio', raw);
  const r = await resolveBooking(ctx, toRef(a.guest), 'any');
  if (!r.ok) return { steps: [], warnings: [], risk: 'low', blocks: [r.block], abort: true };
  return planFolioEdits(ctx, r.value, a.edits, a.reason, state);
}

async function planSubmitDisputeEvidence(ctx: ToolCtx, raw: unknown): Promise<PlanOutput> {
  const a = parseInput('submit_dispute_evidence', raw);
  const r = await resolveBooking(ctx, toRef(a.guest), 'any');
  if (!r.ok) return { steps: [], warnings: [], risk: 'low', blocks: [r.block], abort: true };
  return planSubmitDispute(ctx, await disputedStay(ctx, r.value, !!a.guest.code));
}

const UNIT = { stay: 'STAY', night: 'NIGHT', item: 'ITEM' } as const;

async function planSaveCharge(ctx: ToolCtx, raw: unknown, state: WriteState): Promise<PlanOutput> {
  const a = parseInput('save_charge', raw);
  if (!(await mayManageSavedCharges(ctx.actor, ctx.propertyId))) {
    return { steps: [], warnings: [], risk: 'low', blocks: [{ type: 'error', text: 'Your role can’t change the hotel’s usual charges. A manager can, under Settings → Usual charges.' }] };
  }
  const { currency } = await hotelLocale(ctx.propertyId);
  const saved = await savedChargesFor(ctx.propertyId);
  // Strict: "pet deposit is $100" is a new charge, not a new price for the Pet fee.
  const existing = findSavedCharge(saved, a.name);
  const typed = a.name.replace(/\s+/g, ' ').trim().slice(0, 80);
  const name = existing?.name ?? typed.charAt(0).toUpperCase() + typed.slice(1);
  const note = a.note !== undefined ? a.note.replace(/\s+/g, ' ').trim() || null : (existing?.note ?? null);
  const next: SavedChargeView = { id: existing?.id ?? `planned:${name}`, name, amount: roundMoney(a.amount, currency), unit: UNIT[a.unit], note };
  if (existing && existing.amount === next.amount && existing.unit === next.unit && existing.note === next.note) {
    throw new HarnessInputError(`“${existing.name}” is already saved at ${describeSavedCharge(existing, currency)}; nothing to change.`);
  }
  if (!existing && saved.length >= 100) throw new HarnessInputError('The hotel already has 100 usual charges saved; remove one first.');
  state.savedCharges = [next, ...state.savedCharges.filter((c) => c.name.toLowerCase() !== name.toLowerCase())];
  return {
    steps: [
      {
        tool: 'save_charge',
        args: { propertyId: ctx.propertyId, ...(existing ? { id: existing.id } : {}), name, amount: next.amount, unit: next.unit, ...(a.note !== undefined ? { note } : {}) },
        summary: existing ? `Change the usual ${name} to ${describeSavedCharge(next, currency)} (was ${describeSavedCharge(existing, currency)})` : `Remember ${name} as ${describeSavedCharge(next, currency)}`,
        detail: `${name} uses this price from now on${note ? ` · ${note}` : ''}. Folios that already have one keep theirs.`,
      },
    ],
    warnings: [],
    risk: 'low',
  };
}

async function planRemoveSavedCharge(ctx: ToolCtx, raw: unknown): Promise<PlanOutput> {
  const a = parseInput('remove_saved_charge', raw);
  if (!(await mayManageSavedCharges(ctx.actor, ctx.propertyId))) {
    return { steps: [], warnings: [], risk: 'low', blocks: [{ type: 'error', text: 'Your role can’t change the hotel’s usual charges. A manager can, under Settings → Usual charges.' }] };
  }
  const { currency } = await hotelLocale(ctx.propertyId);
  const saved = await savedChargesFor(ctx.propertyId);
  const c = findSavedCharge(saved, a.name) ?? matchSavedCharge(saved, a.name);
  if (!c) throw new HarnessInputError(`No usual charge called “${a.name}”. Saved: ${saved.map((x) => x.name).join(', ') || 'none'}.`);
  return {
    steps: [{ tool: 'remove_saved_charge', args: { propertyId: ctx.propertyId, id: c.id }, summary: `Forget the usual ${c.name} (${describeSavedCharge(c, currency)})`, detail: 'Folios that already have it keep it.' }],
    warnings: [],
    risk: 'low',
  };
}

async function planRemember(ctx: ToolCtx, raw: unknown): Promise<PlanOutput> {
  const a = parseInput('remember', raw);
  if (!can(ctx.actor, 'skills.manage')) {
    return { steps: [], warnings: [], risk: 'low', blocks: [{ type: 'error', text: 'Saved answers are kept by managers and owners, on the Skills page. Ask one to add it.' }] };
  }
  const question = a.question.replace(/\s+/g, ' ').trim();
  const answer = a.answer.trim();
  const short = answer.length > 100 ? `${answer.slice(0, 99)}…` : answer;
  return {
    steps: [
      {
        tool: 'remember',
        args: { propertyId: ctx.propertyId, question, answer, audience: a.share_with_guests ? 'ALL' : 'STAFF' },
        summary: `Remember: “${question}” ${short}`,
        detail: a.share_with_guests ? 'Saved answer for staff and guests (the voice line and guest assistant)' : 'Saved answer for staff only',
      },
    ],
    warnings: [],
    risk: 'low',
  };
}

async function roomTypesResult(propertyId: string): Promise<unknown> {
  const { currency } = await hotelLocale(propertyId);
  return { currency, roomTypes: (await roomTypesOf(propertyId)).map((rt) => ({ id: rt.id, name: rt.name, basePrice: Number(rt.basePrice), rooms: rt.totalRooms, capacity: rt.capacity })) };
}

async function rateCalendarResult(propertyId: string, raw: unknown): Promise<unknown> {
  const a = parseInput('get_rate_calendar', raw);
  const r = range(a.from, a.to);
  const types = a.room_type ? [await resolveRoomTypeExact(propertyId, a.room_type)] : await roomTypesOf(propertyId);
  const { currency } = await hotelLocale(propertyId);
  const out = [];
  for (const rt of types) {
    const nights = await nightlyRates(prisma, rt.id, r.from, r.to);
    out.push({ roomType: rt.name, id: rt.id, basePrice: Number(rt.basePrice), nights: nights.map((n) => ({ date: n.date, dow: WEEKDAY[dayOfWeek(n.date)], price: n.price, custom: n.isCustom })) });
  }
  return { currency, from: r.from, toExclusive: r.to, rates: out };
}

// ---------------------------------------------------------------------------
// What the person is looking at, and what the hotel usually charges
// ---------------------------------------------------------------------------

const PAGE_NAMES: Record<string, string> = {
  dashboard: 'Dashboard',
  'front-desk': 'Front desk',
  reports: 'Reports',
  housekeeping: 'Housekeeping',
  bookings: 'Reservations',
  'do-not-rent': 'Do-not-rent list',
  'rate-calendar': 'Rate calendar',
  channels: 'Channels',
  'room-types': 'Room types',
  properties: 'Property settings',
  users: 'Team',
  activity: 'Activity log',
  settings: 'Settings',
  analytics: 'Analytics',
  advisor: 'AI advisor',
  disputes: 'Card disputes',
  voice: 'Voice',
  connect: 'PMS connection',
  skills: 'Skills (saved answers and shortcuts)',
  assistants: 'Assistants',
  organization: 'Organization',
};

/** The page of the console the person has open (its path), in words, and the reservation on it if there is one. */
export async function describePage(ctx: ToolCtx, page: string | undefined): Promise<{ text: string; memory?: Partial<AgentContextState> } | null> {
  const path = page?.split(/[?#]/)[0].replace(/\/+$/, '') ?? '';
  const parts = path.split('/').filter(Boolean);
  if (parts[0] !== 'admin' || !parts[1] || parts[1] === 'agent') return null;
  if (parts[1] === 'bookings' && parts[2] && parts.length === 3) {
    // Only a reservation at this hotel: the page path comes from the browser.
    const b = await prisma.booking.findFirst({
      where: { id: parts[2], propertyId: ctx.propertyId },
      select: { id: true, code: true, status: true, checkIn: true, checkOut: true, user: { select: { firstName: true, lastName: true } }, roomType: { select: { name: true } }, room: { select: { roomNumber: true } } },
    });
    if (b) {
      const name = `${b.user.firstName} ${b.user.lastName}`.trim();
      const stay = `${b.checkIn.toISOString().slice(0, 10)} → ${b.checkOut.toISOString().slice(0, 10)}`;
      return {
        text: `On screen: the reservation of ${name} (#${b.code}) · ${b.roomType.name}${b.room ? ` · room ${b.room.roomNumber}` : ''} · ${stay} · ${b.status.toLowerCase().replace('_', ' ')}. “This guest”, “this reservation”, “the folio”, “him/her/them” mean this one unless the person names someone else.`,
        memory: { lastBookingId: b.id, lastBookingCode: b.code ?? undefined, lastGuestName: name, lastRoomNumber: b.room?.roomNumber },
      };
    }
  }
  if (parts[1] === 'disputes' && parts.length === 2) {
    // ?dispute=<id>: the one open on the Disputes page (only one at this hotel, for someone who may see disputes).
    const id = new URLSearchParams(page?.split('#')[0].split('?')[1] ?? '').get('dispute');
    const shown = id ? await disputeOnScreen(ctx, id) : null;
    if (shown) return shown;
  }
  const name = PAGE_NAMES[parts[1]];
  return name ? { text: `On screen: the ${name} page.` } : null;
}

/** The hotel's usual charges for the model, so "add a pet fee" is priced without asking. */
async function usualChargesLine(ctx: ToolCtx): Promise<string> {
  if (!can(ctx.actor, 'folio.view')) return '';
  const [saved, { currency }] = await Promise.all([savedChargesFor(ctx.propertyId), hotelLocale(ctx.propertyId)]);
  if (!saved.length) return 'The hotel has no usual charges saved yet: ask how much a charge is unless the person says, and offer to remember the price.';
  const list = saved.slice(0, 40).map((c) => `${c.name} ${describeSavedCharge(c, currency)}${c.note ? ` (${c.note})` : ''}`);
  return `The hotel’s usual charges: ${list.join('; ')}.`;
}

// ---------------------------------------------------------------------------
// Planning a write (shared with the AI advisor)
// ---------------------------------------------------------------------------

/** What a write tool call adds to the plan, and what to tell the model. */
export interface PlannedWrite {
  out: PlanOutput;
  /** Text for the model: what was planned, or why nothing was. */
  report: string;
  isError: boolean;
}

export async function planHotelWrite(ctx: ToolCtx, name: string, raw: unknown, state: WriteState = newWriteState()): Promise<PlannedWrite> {
  if (!isToolName(name) || definitions[name].kind !== 'write') throw new HarnessInputError(`Unknown write tool: ${name}`);
  let out: PlanOutput;
  if (name === 'set_rates') out = await planSetRates(ctx, raw);
  else if (name === 'edit_folio') out = await planEditFolio(ctx, raw, state);
  else if (name === 'save_charge') out = await planSaveCharge(ctx, raw, state);
  else if (name === 'remove_saved_charge') out = await planRemoveSavedCharge(ctx, raw);
  else if (name === 'remember') out = await planRemember(ctx, raw);
  else if (name === 'create_reservation') out = await planCreateReservation(ctx, raw);
  else if (name === 'submit_dispute_evidence') out = await planSubmitDisputeEvidence(ctx, raw);
  else if (name === 'record_payment') {
    const a = parseInput('record_payment', raw);
    out = await withBooking(ctx, a.guest, (b) => planRecordPayment(ctx, b, a));
  } else if (name === 'refund_payment') {
    const a = parseInput('refund_payment', raw);
    out = await withBooking(ctx, a.guest, (b) => planRefund(ctx, b, a));
  } else if (name === 'request_card_authorization') {
    const a = parseInput('request_card_authorization', raw);
    out = await withBooking(ctx, a.guest, (b) => planCardAuthorization(ctx, b, a));
  } else if (name === 'update_do_not_rent') {
    const a = parseInput('update_do_not_rent', raw);
    out = a.guest ? await withBooking(ctx, a.guest, (b) => planDoNotRent(ctx, b, a)) : await planDoNotRent(ctx, null, a);
  } else if (name === 'mark_guest_request') out = await planGuestRequest(ctx, parseInput('mark_guest_request', raw));
  else if (name === 'close_business_day') out = await planCloseDay(ctx, parseInput('close_business_day', raw));
  else if (name === 'update_room_type') {
    const a = parseInput('update_room_type', raw);
    out = await planRoomType(ctx, await resolveRoomTypeExact(ctx.propertyId, a.room_type), a);
  } else {
    const intent = writeIntent(name, raw);
    if (!intent) throw new HarnessInputError(`Unknown write tool: ${name}`);
    out = await planWrite(ctx, intent);
  }
  const problems = (out.blocks ?? []).flatMap(blockText).filter(Boolean);
  if (!out.steps.length) {
    return { out, report: problems.join('\n') || 'Nothing to change.', isError: problems.length > 0 };
  }
  const lines = out.steps.map((s) => `- ${s.summary}${s.detail ? ` (${s.detail})` : ''}`);
  return {
    out,
    report: `Added to the plan the person will confirm (NOT done yet):\n${lines.join('\n')}${out.warnings.length ? `\nWarnings shown to them: ${out.warnings.join(' ')}` : ''}${problems.length ? `\nAlso: ${problems.join(' ')}` : ''}`,
    isError: false,
  };
}

/** Readable text of a block, for the model. */
function blockText(b: AgentBlock): string[] {
  switch (b.type) {
    case 'text':
    case 'error':
      return [b.text];
    case 'clarify':
      return [`${b.question} Options: ${b.options.map((o) => `${o.label}${o.hint ? ` (${o.hint})` : ''}`).join('; ')}`];
    default:
      return [];
  }
}

/** Compact JSON of read blocks for the model (UI-only blocks are dropped). */
function blocksForModel(blocks: AgentBlock[]): string {
  const keep = blocks.filter((b) => !['suggestions', 'navigate'].includes(b.type));
  const text = JSON.stringify(keep, (_k, v) => (v === null || v === undefined || v === '' ? undefined : typeof v === 'number' && !Number.isInteger(v) ? Math.round(v * 100) / 100 : v));
  return text.length > MAX_RESULT_CHARS ? `${text.slice(0, MAX_RESULT_CHARS)}… (truncated; narrow the query for more)` : text;
}

// ---------------------------------------------------------------------------
// The loop
// ---------------------------------------------------------------------------

function systemPrompt(ctx: ToolCtx): string {
  return `You are the operations agent built into ${ctx.propertyName}'s property management system. Staff and owners talk to you in plain words (often messy, typo-ridden, pasted tables, or voice transcripts) and you get things done with the tools.

How to work:
- Work out what the person wants, even from rough phrasing, typos ("ped fee" = pet fee), half sentences or a pasted table. Follow-ups refer to what you showed last ("patel", "her", "the arrival guy"): resolve them from that context. Look things up with the read tools when you need facts (ids, current prices, who is arriving) and make independent calls in parallel.
- To change anything, call the write tools. Writes are never applied directly: each call adds steps to ONE plan the person reviews and confirms with a button. So never say a change is done. Say you've prepared it for them to confirm. Put everything the person asked for into this one plan; don't ask permission first.
- For rates: map each row of a request to set_rates changes (one call with all changes). Use list_room_types for exact names. Remember \`to\` in set_rates is the last night, inclusive; use \`nights\` for scattered dates and \`weekdays\` for patterns like Sun–Thu. Read the current calendar first only if you need current prices to compute something.
- Pick tools by what the person is trying to get done, not by their exact words. Each tool's description says when to use it and which tool to use instead when it isn't the one. Many requests need several tools: look up what you need, then put every change into the one plan ("Lucas is leaving a night early, refund that night and check him out" is refund_payment with also_discount plus check_out).
- Guests and the desk: today_overview for a briefing; list_arrivals, list_departures and list_in_house for who is coming, going or staying; find_reservation for one guest's booking; check_availability for free rooms and exact prices; suggest_rooms, assign_room, assign_rooms_to_arrivals, check_in, check_out, add_note, change_booking_status and create_reservation for the desk's work. Cancelling doesn't refund and refunding doesn't cancel: when they want both, plan both.
- Prices and occupancy: list_room_types for the room types and their base prices, get_rate_calendar for the price of each night, occupancy_forecast for occupancy, revenue and ADR night by night over a range. Read prices first only when you need them to work something out.
- Rooms and housekeeping: room_board for room status, housekeeping_board for today's cleaning and the team; set_room_status, set_out_of_order, assign_cleaning and auto_assign_housekeeping to change them. A room type's own settings (its base price for nights without their own rate, how many it sleeps, its name, how many rooms) are update_room_type; prices for particular nights are set_rates.
- Folios: use edit_folio, with every change for one reservation in one call. To add a charge the hotel has a usual price for (listed with the conversation), leave out the amount and it's priced for the stay. If there's no usual price and the person didn't say one, ask how much and never guess an amount. "Make the room and tax together $50" is set_total over the room and its tax lines. Call get_folio first when you need line refs or current amounts.
- When the person says what something always costs ("pet fee is always $50", "rollaway is $20 a night"), call save_charge so it's remembered; if they also asked to charge it, do both in the same plan. A price they give for one guest only ("charge her $30 for the dog") is just that charge. remove_saved_charge forgets a usual charge.
- Money at the desk: record_payment when a guest paid cash, on the hotel's own card terminal, or another way such as a bank transfer. refund_payment gives money back: if they didn't say how much, call it without an amount to learn what can be refunded and what the cancellation policy suggests, then ask. Always give the reason. request_card_authorization emails the card authorization form when someone else (a company, a parent) pays for a stay. Charging a card through HotelOne happens on the reservation's Payments card, and you never take or repeat card numbers.
- When they tell you something lasting about the hotel to remember (a policy, a fact, "from now on…"), call remember.
- For any report, list, count, total or breakdown over dates (reservations, nights, occupancy, revenue, charges, payments, guests, sources…), build it with run_report: pick the dataset, filters, grouping and metrics yourself, whatever the person asked for. The table and its CSV download are shown to them; answer the question in a sentence or two from it.
- When the person says a guest disputed a charge, raised a chargeback, or the bank or card company is asking about a payment, call get_dispute: it finds the reservation (and any dispute Stripe reported), and prepares the evidence document from the hotel's records, ready to download or print. Pass what the guest claims as reason when they said it, and the amount and deadline if they gave them. Then tell them in a sentence or two what the evidence shows, and anything missing that would help (ask them to add it if they can). Only send evidence to Stripe with submit_dispute_evidence when they ask you to.
- The logs: any question about what happened, who did something, or when ("who cancelled the Patel booking?", "what did Maria change yesterday?", "why is 12 out of order?", "did the Expedia sync fail?") is search_activity_log, with the filters the question implies (a guest, a person, a room, kinds, words, days). Answer from the entries: who, what and when, on the hotel's clock. For "anything I should look at?", "anything odd?" or a weekly check, search with worth_checking over the days they mean (the last 7 if they don't say), then go through what it found and the patterns: what happened, why it may matter, what to check. It shows what deserves a second look, not wrongdoing, so describe it neutrally and never accuse anyone.
- Guests to watch and guest messages: check_do_not_rent before booking someone the person is unsure about, or when they ask; update_do_not_rent to add someone (always with the reason; ask for it) or take them off. list_guest_requests for messages and callback requests guests left with the voice line, WhatsApp or the booking page; mark_guest_request once one is dealt with.
- Closing the day: night_audit_status shows what's still open for the business day; close_business_day closes it. If arrivals never came and the person didn't say whether they're no-shows, ask before closing.
- Booking channels: channel_status for how Expedia and Booking.com are connected and syncing; their history is in search_activity_log. Their rates, markups and promotions are managed on the Channels page.
- Not something you can do here: changing a stay's dates (cancel and rebook it, or the guest changes them from their booking page), the team and roles, and the hotel's settings. Say so in a sentence and point to where it's done (Team, Settings). When a tool says the person's role can't do something, tell them who can, and don't look for a way around it.
- The person may be looking at a page of the system while they talk to you (described with the conversation); "this guest", "this reservation" or "here" refer to it.
- If a tool says something is ambiguous or impossible, fix your input and retry, or explain it plainly and ask one short question. Don't invent ids, names, rooms or prices.
- For questions about hotel policies or amenities, use hotel_knowledge.

${NO_EM_DASHES}

Reply style: the cards from your tools are shown to the person automatically, so don't repeat their numbers at length. End with one or two short sentences: what you found or what's ready to confirm, plus anything that needs their attention. Plain words, no markdown headings.

Today at the hotel is ${ctx.today} (${WEEKDAY[dayOfWeek(ctx.today)]}).`;
}

/** Content to echo back after a server-side fallback: before the last fallback block only text carries over. */
function echoable(content: Anthropic.Beta.BetaContentBlock[]): Anthropic.Beta.BetaContentBlock[] {
  const boundary = content.map((b) => b.type).lastIndexOf('fallback');
  if (boundary < 0) return content;
  return content.filter((b, i) => i >= boundary || b.type === 'text');
}

export interface HarnessResult {
  steps: PlanStep[];
  warnings: string[];
  risk: PlanOutput['risk'];
  memory: AgentContextState;
  toolsUsed: string[];
}

/**
 * Runs the model over a message. Yields status lines and UI blocks as tools
 * finish; returns the gathered writes for the caller to sign into one plan.
 * Throws on API errors so the caller can fall back to the deterministic engine.
 */
export async function* runHarness(
  ctx: ToolCtx,
  opts: { recent?: string[]; lastReply?: string; page?: string; client?: Anthropic; signal?: AbortSignal } = {}
): AsyncGenerator<AgentEvent, HarnessResult> {
  const client = opts.client ?? new Anthropic();
  const memory: AgentContextState = { ...ctx.memory };
  const result: HarnessResult = { steps: [], warnings: [], risk: 'low', memory, toolsUsed: [] };
  const state = newWriteState();
  const earlier = (opts.recent ?? []).filter((m) => m !== ctx.message).slice(-6);
  const [page, usual] = await Promise.all([describePage(ctx, opts.page), usualChargesLine(ctx)]);
  // "Add a pet fee to this guest" on a reservation's page: that reservation, unless the conversation named another.
  if (page?.memory && !memory.lastBookingId) Object.assign(memory, page.memory);
  const context = [
    earlier.length ? `Earlier messages from the person in this conversation (oldest first):\n${earlier.map((m) => `- ${m}`).join('\n')}` : '',
    opts.lastReply?.trim() ? `What you showed them in your last reply:\n${opts.lastReply.trim().slice(0, 2000)}` : '',
    memory.lastBookingCode || memory.lastGuestName || memory.lastRoomNumber
      ? `Last guest/room discussed: ${[memory.lastGuestName, memory.lastBookingCode && `#${memory.lastBookingCode}`, memory.lastRoomNumber && `room ${memory.lastRoomNumber}`].filter(Boolean).join(', ')}.`
      : '',
    page?.text ?? '',
    usual,
  ]
    .filter(Boolean)
    .join('\n\n');
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content: context ? `${context}\n\n---\n\n${ctx.message}` : ctx.message }];

  for (let round = 0; round <= MAX_ROUNDS; round++) {
    const message = await client.beta.messages.create(
      {
        model: MODEL,
        max_tokens: 16000,
        betas: BETAS,
        fallbacks: 'default',
        output_config: { effort: EFFORT },
        cache_control: { type: 'ephemeral' },
        system: systemPrompt(ctx),
        tools: HOTEL_TOOLS,
        tool_choice: round === MAX_ROUNDS ? { type: 'none' } : { type: 'auto' },
        messages,
      },
      { signal: opts.signal }
    );

    if (message.stop_reason === 'refusal') {
      yield { type: 'block', block: { type: 'text', text: 'I can’t help with that one. Ask me about guests, rooms, rates or housekeeping.' } };
      return result;
    }
    const content = echoable(message.content);
    const toolUses = content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');
    const text = content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n\n')
      .trim();

    if (message.stop_reason === 'pause_turn') {
      messages.push({ role: 'assistant', content });
      continue;
    }
    if (message.stop_reason !== 'tool_use' || !toolUses.length) {
      if (text) yield { type: 'block', block: { type: 'text', text } };
      return result;
    }
    if (message.stop_reason === 'tool_use' && text) yield { type: 'status', text: text.slice(0, 160) };

    messages.push({ role: 'assistant', content });
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const use of toolUses) {
      result.toolsUsed.push(use.name);
      yield { type: 'status', text: `${hotelToolLabel(use.name)}…` };
      try {
        const out = await runTool({ ...ctx, memory }, use.name, use.input, result, state);
        for (const b of out.blocks) yield { type: 'block', block: b };
        results.push({ type: 'tool_result', tool_use_id: use.id, content: out.forModel, ...(out.isError ? { is_error: true } : {}) });
      } catch (e) {
        if (!(e instanceof HarnessInputError) && !(e instanceof DomainError)) logError('agent/harness', 'Tool failed:', use.name, e);
        results.push({
          type: 'tool_result',
          tool_use_id: use.id,
          is_error: true,
          content: e instanceof HarnessInputError ? e.message : e instanceof DomainError ? e.message : 'The tool failed unexpectedly. Try different input or continue without it.',
        });
      }
    }
    messages.push({ role: 'user', content: results });
  }
  return result;
}

async function runTool(ctx: ToolCtx, name: string, raw: unknown, acc: HarnessResult, state: WriteState): Promise<{ blocks: AgentBlock[]; forModel: string; isError?: boolean }> {
  if (!isToolName(name)) throw new HarnessInputError(`Unknown tool: ${name}`);
  if (definitions[name].kind === 'write') {
    const w = await planHotelWrite(ctx, name, raw, state);
    Object.assign(acc.memory, w.out.memory ?? {});
    acc.steps.push(...w.out.steps);
    acc.warnings.push(...w.out.warnings);
    acc.risk = maxRisk(acc.risk, w.out.risk);
    return { blocks: [], forModel: w.report, isError: w.isError };
  }
  if (name === 'list_room_types') return { blocks: [], forModel: JSON.stringify(await roomTypesResult(ctx.propertyId)) };
  if (name === 'get_rate_calendar') {
    const text = JSON.stringify(await rateCalendarResult(ctx.propertyId, raw));
    return { blocks: [], forModel: text.length > MAX_RESULT_CHARS ? `${text.slice(0, MAX_RESULT_CHARS)}… (truncated; ask for fewer nights or one room type)` : text };
  }
  if (name === 'run_report') {
    if (!can(ctx.actor, 'reports.view')) return { blocks: [], forModel: 'Reports aren’t part of this person’s role: say so.', isError: true };
    try {
      const { result } = await runReportTool(ctx.actor, ctx.propertyId, raw);
      return { blocks: [reportBlock(ctx.propertyId, result)], forModel: reportForModel(result) };
    } catch (e) {
      if (e instanceof ReportInputError) throw new HarnessInputError(e.message);
      throw e;
    }
  }
  if (name === 'get_folio') {
    if (!can(ctx.actor, 'folio.view')) return { blocks: [], forModel: 'Folios aren’t part of this person’s role: say so.', isError: true };
    const r = await resolveBooking(ctx, toRef(parseInput('get_folio', raw).guest), 'any');
    if (!r.ok) return { blocks: [], forModel: blockText(r.block).join('\n') || 'No such reservation.', isError: true };
    const out = await folioRead(ctx, r.value);
    Object.assign(acc.memory, out.memory);
    return { blocks: out.blocks, forModel: out.forModel };
  }
  if (name === 'get_dispute') {
    if (!can(ctx.actor, 'disputes.view')) return { blocks: [], forModel: 'Disputes aren’t part of this person’s role (owners and managers handle them): say so.', isError: true };
    const a = parseInput('get_dispute', raw);
    const input = { reason: a.reason, amount: a.amount, respondBy: a.respond_by };
    if (!a.guest) {
      const out = await openDisputesRead(ctx, input);
      Object.assign(acc.memory, out.memory ?? {});
      return out;
    }
    const r = await resolveBooking(ctx, toRef(a.guest), 'any');
    if (!r.ok) return { blocks: [], forModel: blockText(r.block).join('\n') || 'No such reservation.', isError: true };
    const out = await disputeRead(ctx, await disputedStay(ctx, r.value, !!a.guest.code), input);
    Object.assign(acc.memory, out.memory);
    return { blocks: out.blocks, forModel: out.forModel };
  }
  if (name === 'search_activity_log') {
    if (!can(ctx.actor, 'activity.view')) return { blocks: [], forModel: 'The activity log is for managers and owners, and this person’s role can’t see it: say so.', isError: true };
    const a = parseInput('search_activity_log', raw);
    let stay: ResolvedBooking | null = null;
    if (a.guest) {
      const r = await resolveBooking(ctx, toRef(a.guest), 'any');
      if (!r.ok) return { blocks: [], forModel: blockText(r.block).join('\n') || 'No such reservation.', isError: true };
      stay = r.value;
    }
    const out = await searchActivity(ctx, a, stay);
    Object.assign(acc.memory, out.memory ?? {});
    return out;
  }
  if (name === 'check_do_not_rent') {
    const a = parseInput('check_do_not_rent', raw);
    let stay: ResolvedBooking | null = null;
    if (a.guest && can(ctx.actor, 'dnr.view')) {
      const r = await resolveBooking(ctx, toRef(a.guest), 'any');
      if (!r.ok) return { blocks: [], forModel: blockText(r.block).join('\n') || 'No such reservation.', isError: true };
      stay = r.value;
    }
    const out = await doNotRentRead(ctx, stay, a);
    Object.assign(acc.memory, out.memory ?? {});
    return out;
  }
  if (name === 'list_guest_requests') return guestRequestsRead(ctx, parseInput('list_guest_requests', raw).status);
  if (name === 'night_audit_status') return nightAuditRead(ctx, parseInput('night_audit_status', raw).date);
  if (name === 'channel_status') return channelStatusRead(ctx);
  if (name === 'hotel_knowledge') {
    const { question } = parseInput('hotel_knowledge', raw);
    const ans = await answerFromSkills(ctx.actor, ctx.propertyId, question);
    if (!ans) return { blocks: [], forModel: 'The hotel has no saved answer for that. Say so, and suggest a manager adds it on the Skills page.' };
    return { blocks: [], forModel: ans.blocks.flatMap(blockText).join('\n') || 'No answer text.' };
  }
  const intent = readIntent(name, raw, ctx.today);
  if (!intent) throw new HarnessInputError(`Unknown tool: ${name}`);
  const out = await runRead(ctx, intent);
  Object.assign(acc.memory, out.memory ?? {});
  const problem = out.blocks.some((b) => b.type === 'error' || b.type === 'clarify');
  // Problems go to the model to resolve or explain; data cards go to the person.
  const shown = problem ? [] : out.blocks.filter((b) => b.type !== 'suggestions' && b.type !== 'text');
  return { blocks: shown, forModel: problem ? out.blocks.flatMap(blockText).join('\n') : blocksForModel(out.blocks), isError: problem };
}

