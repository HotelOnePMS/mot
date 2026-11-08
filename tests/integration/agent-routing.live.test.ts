/**
 * Does the agent pick the right tool? Real requests, the way staff type them, against the live model.
 *
 * Opt-in, because it calls the Anthropic API (a few cents a run) and needs a key:
 *
 *   AGENT_ROUTING_EVAL=1 ANTHROPIC_API_KEY=sk-ant-… TEST_DATABASE_URL=postgresql://…/hotelone_test \
 *     npx vitest run --project integration tests/integration/agent-routing.live.test.ts
 *
 * It builds a small hotel in the test database (reset before every integration run), sends each request through the
 * same harness the console uses, and checks which tools the model called. Changes are only planned, never confirmed,
 * so nothing is changed. Skipped everywhere else (CI included).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { BookingStatus, User } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { addDaysISO, atNoonUTC } from '@/server/dates';
import { runHarness } from '@/server/agent/harness';
import { actorFor, makeHotel, makeUser, uid } from './fixtures';
import { drain } from './scripted-client';

const live = process.env.AGENT_ROUTING_EVAL === '1' && !!process.env.ANTHROPIC_API_KEY;

interface Case {
  say: string;
  /** At least one of these must be called. */
  any: string[];
  /** And all of these. */
  all?: string[];
  /** And none of these. */
  not?: string[];
}

const CASES: Case[] = [
  // The logs
  { say: 'who cancelled the okafor booking?', any: ['search_activity_log'] },
  { say: 'anything I should look at from this week?', any: ['search_activity_log'] },
  { say: 'what did maria change yesterday', any: ['search_activity_log'] },
  { say: 'why is room 102 out of order', any: ['search_activity_log', 'room_board'] },
  { say: 'did expedia fail to sync this week', any: ['search_activity_log', 'channel_status'] },
  // Money
  { say: 'patel paid the rest in cash', any: ['record_payment'] },
  { say: 'ben cole paid by bank transfer, 230', any: ['record_payment'] },
  { say: 'refund lucas $50, the AC was broken', any: ['refund_payment'], not: ['edit_folio'] },
  { say: 'how much can we refund lucas?', any: ['refund_payment', 'get_folio', 'find_reservation'] },
  { say: 'lucas silva raised a chargeback, get the evidence ready', any: ['get_dispute'] },
  { say: 'send the card authorization form to Acme Travel for the patel stay, ap@acme.example', any: ['request_card_authorization'] },
  // Folios and usual charges
  { say: 'add a $30 pet fee to patel', any: ['edit_folio'] },
  { say: 'pet fee is always $50 from now on', any: ['save_charge'], not: ['remember'] },
  // Guests
  { say: 'is rick moran on the do not rent list?', any: ['check_do_not_rent'] },
  { say: 'put ben cole on the do not rent list, he damaged the room', any: ['update_do_not_rent'] },
  { say: 'any voicemails or messages from guests?', any: ['list_guest_requests'] },
  { say: 'i called priya back, mark it done', any: ['mark_guest_request'] },
  // Running the hotel
  { say: 'what’s left before I close the day?', any: ['night_audit_status'] },
  { say: 'is booking.com syncing ok?', any: ['channel_status'] },
  { say: 'make the queen base price 120', any: ['update_room_type'], not: ['set_rates'] },
  { say: 'queen 150 next friday and saturday', any: ['set_rates'], not: ['update_room_type'] },
  { say: 'revenue by booking source last month', any: ['run_report'] },
  { say: 'who’s arriving today?', any: ['list_arrivals', 'today_overview'] },
  { say: 'check out patel', any: ['check_out'] },
  { say: 'cancel ben cole’s upcoming booking and refund him in full', any: ['change_booking_status'], all: ['refund_payment'] },
  { say: 'is parking free?', any: ['hotel_knowledge'] },
];

describe.skipIf(!live)('the agent picks the right tool (live model)', () => {
  let ctx: (message: string) => Parameters<typeof runHarness>[0];

  beforeAll(async () => {
    const h = await makeHotel({ timezone: 'America/Los_Angeles', rooms: 4 });
    const guest = (firstName: string, lastName: string) =>
      prisma.user.create({ data: { email: `${firstName.toLowerCase()}-${uid()}@example.org`, phone: `+1 831 555 ${1000 + Math.floor(Math.random() * 8999)}`, password: '', firstName, lastName, role: 'CUSTOMER' } });
    const book = (user: User, checkIn: string, status: BookingStatus) =>
      prisma.booking.create({
        data: {
          userId: user.id,
          propertyId: h.property.id,
          roomTypeId: h.roomType.id,
          checkIn: atNoonUTC(checkIn),
          checkOut: atNoonUTC(addDaysISO(checkIn, 2)),
          guests: 1,
          rooms: 1,
          totalPrice: 230,
          subtotalPrice: 230,
          status,
          code: `R${uid().toUpperCase().slice(0, 5)}`,
        },
      });
    const owner = await makeUser({ role: 'OWNER', propertyIds: [h.property.id] });
    const maria = await prisma.user.create({ data: { email: `maria-${uid()}@example.com`, password: '', firstName: 'Maria', lastName: 'Lopez', role: 'MANAGER', assignedProperties: { create: [{ propertyId: h.property.id }] } } });
    await book(await guest('Ana', 'Patel'), h.today, 'CHECKED_IN');
    const lucas = await book(await guest('Lucas', 'Silva'), addDaysISO(h.today, -6), 'CHECKED_OUT');
    await prisma.payment.create({ data: { bookingId: lucas.id, propertyId: h.property.id, stripePaymentIntentId: `pi_${uid()}${uid()}`, status: 'SUCCEEDED', amount: 230, currency: 'usd', cardLast4: '4242', paidAt: new Date() } });
    const okafor = await book(await guest('James', 'Okafor'), addDaysISO(h.today, 4), 'CANCELLED');
    await book(await guest('Ben', 'Cole'), addDaysISO(h.today, 9), 'CONFIRMED');
    await book(await guest('Rick', 'Moran'), addDaysISO(h.today, -20), 'CHECKED_OUT');
    await prisma.agentAuditLog.create({ data: { propertyId: h.property.id, userId: maria.id, action: 'BOOKING_CANCELLED', detail: JSON.stringify({ source: 'classic', summary: `Cancelled James Okafor (${okafor.code})`, bookingId: okafor.id }) } });
    await prisma.guestRequest.create({ data: { propertyId: h.property.id, name: 'Priya Shah', phone: '+1 831 555 0199', message: 'Please call back about a late check-out', source: 'PHONE' } });
    await prisma.channelConnection.create({ data: { propertyId: h.property.id, channel: 'EXPEDIA', status: 'ACTIVE' } });
    await prisma.channelConnection.create({ data: { propertyId: h.property.id, channel: 'BOOKING_COM', status: 'ACTIVE' } });
    const actor = await actorFor(owner.id);
    ctx = (message) => ({ actor, propertyId: h.property.id, propertyName: h.property.name, today: h.today, memory: {}, message });
  });

  it.each(CASES)('“$say”', async (c) => {
    const { result } = await drain(runHarness(ctx(c.say)));
    const used = result.toolsUsed;
    const why = `called: ${used.join(', ') || 'nothing'}`;
    expect(c.any.some((t) => used.includes(t)), why).toBe(true);
    for (const t of c.all ?? []) expect(used, why).toContain(t);
    for (const t of c.not ?? []) expect(used, why).not.toContain(t);
  }, 120_000);
});
