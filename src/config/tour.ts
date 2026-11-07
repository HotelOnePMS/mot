/**
 * The owner demo tour: a walk through the hotel console for someone deciding
 * whether HotelOne is for them. The voice agent drives it (start_owner_demo,
 * show_demo_stop) and explains each stop from `explain`; without voice, the
 * tour page plays the same stops on its own.
 *
 * Everything the tour shows is the made-up sample hotel in
 * components/tour/sample-data.ts. It never reads the database, so no hotel's
 * real guests, bookings or payments can appear in it.
 *
 * A plain module (not 'use client') so the server's tool definitions read the
 * same stop ids the page renders.
 */
import { PRODUCT_NAME } from './product';

export const TOUR_PATH = '/demo/tour';

/** The made-up hotel the tour shows. */
export const TOUR_HOTEL = 'Harbor Light Inn';

export interface TourStop {
  id: string;
  /** Sidebar label, as in the real console. */
  label: string;
  /** Heading on screen and what the agent calls it. */
  title: string;
  /** What the agent should get across here: facts about the product and the sample hotel on screen. */
  explain: string;
  /** The caption shown under the screen (the same story, written to read). */
  caption: string;
}

export const TOUR_STOPS = [
  {
    id: 'overview',
    label: 'Dashboard',
    title: 'Today at a glance',
    explain: `This is the owner's home screen in ${PRODUCT_NAME}, for a sample hotel called ${TOUR_HOTEL}. Tonight it is 86% full, average rate $214, with 9 arrivals and 7 departures. Two arrivals still need a room, and one card dispute needs an answer. Everything the team needs today is on one screen.`,
    caption: 'Occupancy, revenue, arrivals and anything that needs you today, on one screen.',
  },
  {
    id: 'agent',
    label: 'AI agent',
    title: 'Run the desk in plain words',
    explain: `Staff type or say what they need, like "check in the Smiths, quiet room, high floor". The agent finds the booking and a free room, and shows a plan. Nothing changes until someone with the right role presses confirm, and every change lands in the activity log under their name.`,
    caption: 'Ask in plain words. The agent proposes a plan; nothing changes until a person confirms it.',
  },
  {
    id: 'front-desk',
    label: 'Front desk',
    title: 'Arrivals and check-in',
    explain: `The front desk shows today's arrivals and departures. Jordan Smith is arriving for their anniversary and still needs a room, Lucas Silva's flight is delayed, and Grace Okafor is ready in room 304. Check-in takes the ID check, card on file and signed registration, which also become dispute evidence later.`,
    caption: 'Today’s arrivals and departures, room assignment and a check-in checklist that doubles as dispute evidence.',
  },
  {
    id: 'bookings',
    label: 'Reservations',
    title: 'Every reservation in one list',
    explain: `Reservations from the hotel's own booking site, phone, walk-ins and the booking channels all land in one list. Direct bookings pay no commission. You can filter by status or source, and open any booking to change dates, rooms or payments.`,
    caption: 'Direct, phone and channel bookings in one list, with the source and balance of each.',
  },
  {
    id: 'housekeeping',
    label: 'Housekeeping',
    title: 'Room status for the team',
    explain: 'Housekeeping sees every room as clean, dirty, being cleaned or out of order, on a phone. When a room is marked clean, the front desk can assign it straight away.',
    caption: 'Clean, dirty, in progress and out of order, updated from a phone.',
  },
  {
    id: 'rates',
    label: 'Rates',
    title: 'Prices by night',
    explain: 'The rate calendar shows each room type\'s price per night and how many are left. Weekends and the harbor festival are priced higher here. Change a price once and it goes to the booking site and every connected channel.',
    caption: 'One calendar of prices and availability per room type, sent everywhere you sell.',
  },
  {
    id: 'channels',
    label: 'Channels',
    title: 'Channel manager',
    explain: 'The channel manager keeps prices and availability in sync with Booking.com, Expedia and Airbnb, both ways. A channel booking takes a room off everywhere else within seconds, so there are no double bookings. Here all three channels are connected and the last sync was two minutes ago.',
    caption: 'Two-way sync with Booking.com, Expedia and Airbnb, so a room is never sold twice.',
  },
  {
    id: 'payments',
    label: 'Payments',
    title: 'Cards, deposits and refunds',
    explain: `Guests pay by card on the hotel's booking site, and payouts go straight to the hotel's own Stripe account. The team can take deposits, charge the balance at check-out and refund from the booking. This month the sample hotel took $48,920 with three refunds.`,
    caption: 'Card payments, deposits and refunds, paid out to the hotel’s own Stripe account.',
  },
  {
    id: 'disputes',
    label: 'Disputes',
    title: 'A card dispute, handled',
    explain: `Here is a sample dispute. A guest, Daniel Reyes, told their bank they never stayed and disputed $486. ${PRODUCT_NAME} already gathered the evidence from the hotel's own records: their ID matched at check-in, they signed the registration card, they accepted the cancellation policy when booking, and they checked out two nights later. The owner reads the summary and presses submit. Nothing is ever sent to the bank without that click, and the answer is due in 6 days.`,
    caption: 'Evidence gathered from your own records. You review it and submit; nothing is sent without your click.',
  },
  {
    id: 'reports',
    label: 'Analytics',
    title: 'Reports',
    explain: 'Reports show occupancy, average rate and revenue per available room over time, and where bookings came from. This month 41% of revenue came direct, up from 28%, which is commission the hotel kept. The AI advisor also suggests where to raise or lower prices.',
    caption: 'Occupancy, ADR, RevPAR and booking sources, with direct share tracked over time.',
  },
  {
    id: 'voice',
    label: 'Voice front desk',
    title: 'Every call answered',
    explain: 'The voice front desk answers the hotel\'s phone and website around the clock, with the real rooms and prices. This week it took 63 calls, made 11 bookings and passed 4 messages to the team. Anything unusual goes to a person with a summary.',
    caption: 'Calls answered 24/7 from live rooms and prices; messages handed to your team.',
  },
] as const satisfies readonly TourStop[];

export type TourStopId = (typeof TOUR_STOPS)[number]['id'];

export const TOUR_STOP_IDS = TOUR_STOPS.map((s) => s.id) as TourStopId[];

export function tourStop(id: unknown): TourStop | null {
  return TOUR_STOPS.find((s) => s.id === id) ?? null;
}

/** The stop after `id`, or null at the end. */
export function nextTourStop(id: string): TourStopId | null {
  const i = TOUR_STOP_IDS.indexOf(id as TourStopId);
  return i >= 0 && i < TOUR_STOP_IDS.length - 1 ? TOUR_STOP_IDS[i + 1] : null;
}
