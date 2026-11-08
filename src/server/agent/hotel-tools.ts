/**
 * Running the hotel, for the agent: the night audit (what's still open for a business day, and closing it), a room
 * type's own settings (base price, capacity, name, room count), and how the booking channels are syncing.
 *
 * Reads change nothing. Closing a day and changing a room type are steps the person confirms.
 */
import { prisma } from '@/lib/prisma';
import type { AgentBlock } from '@/lib/agent/blocks';
import type { BookingSummary } from '@/lib/dto';
import { money } from '@/lib/status';
import { can } from '../authz';
import { formatDay } from '../dates';
import { hotelLocale } from '../services/hotels';
import { nightAuditPreview } from '../services/nightAudit';
import { HarnessInputError } from './input-error';
import type { PlanOutput, ToolCtx } from './tools';

type ReadOut = { blocks: AgentBlock[]; forModel: string; isError?: boolean };

const refused = (text: string): PlanOutput => ({ steps: [], warnings: [], risk: 'low', blocks: [{ type: 'error', text }] });
const who = (b: BookingSummary) => ({ guest: b.guest.name, reservation: b.code, room: b.room?.number, checkIn: b.checkIn, checkOut: b.checkOut, balance: b.balance || undefined });

// ---------------------------------------------------------------------------
// Night audit
// ---------------------------------------------------------------------------

export async function nightAuditRead(ctx: ToolCtx, date?: string): Promise<ReadOut> {
  if (!can(ctx.actor, 'audit.run')) return { blocks: [], forModel: 'The night audit isn’t part of this person’s role: say so.', isError: true };
  const p = await nightAuditPreview(ctx.actor, ctx.propertyId, date);
  const fmt = (n: number) => money(n, { currency: p.currency });
  const blocks: AgentBlock[] = [
    {
      type: 'stats',
      items: [
        { label: 'Business day', value: formatDay(p.businessDate, 'weekday'), hint: p.closed ? `Closed by ${p.closed.closedBy}` : 'Not closed yet', tone: p.closed ? 'success' : 'warning' },
        { label: 'Occupancy', value: `${p.numbers.occupancyPct}%`, hint: `${p.numbers.roomsSold} of ${p.numbers.totalRooms} rooms` },
        { label: 'Room revenue', value: fmt(p.numbers.roomRevenue), hint: `ADR ${fmt(p.numbers.adr)}` },
        { label: 'Rooms ready', value: String(p.rooms.ready), hint: `${p.rooms.dirty} dirty · ${p.rooms.outOfOrder} out of order` },
      ],
    },
  ];
  if (p.noShows.length) blocks.push({ type: 'bookings', title: 'Never arrived (possible no-shows)', variant: 'arrivals', items: p.noShows });
  if (p.overdueDepartures.length) blocks.push({ type: 'bookings', title: 'Past check-out, still in house', variant: 'inhouse', items: p.overdueDepartures });
  if (p.unpaidInHouse.length) blocks.push({ type: 'bookings', title: 'In house with something to pay', variant: 'inhouse', items: p.unpaidInHouse });
  return {
    blocks,
    forModel: JSON.stringify({
      businessDate: p.businessDate,
      today: p.today,
      closed: p.closed ? { by: p.closed.closedBy, at: p.closed.closedAt, noShowsMarked: p.closed.summary.noShowsMarked.length, notes: p.closed.notes ?? undefined } : false,
      possibleNoShows: p.noShows.map(who),
      pastCheckOutStillInHouse: p.overdueDepartures.map(who),
      inHouseWithBalance: p.unpaidInHouse.map(who),
      openGuestMessages: p.openRequests,
      rooms: p.rooms,
      numbers: { ...p.numbers, currency: p.currency },
      lastClosed: p.history.slice(0, 3).map((h) => ({ day: h.businessDate, by: h.closedBy })),
      shownToPerson: 'Cards with the day’s numbers and each list that has anyone in it.',
    }),
  };
}

export interface CloseDayInput {
  date?: string;
  no_shows?: 'all' | 'listed' | 'none';
  no_show_codes?: string[];
  flag_stayovers?: boolean;
  notes?: string;
}

/** Close the business day: mark the arrivals that never came as no-shows (as the person says), save the day's report. */
export async function planCloseDay(ctx: ToolCtx, a: CloseDayInput): Promise<PlanOutput> {
  if (!can(ctx.actor, 'audit.run')) return refused('Your role can’t run the night audit.');
  const p = await nightAuditPreview(ctx.actor, ctx.propertyId, a.date);
  if (p.closed) return refused(`${formatDay(p.businessDate, 'weekday')} was already closed by ${p.closed.closedBy}.`);
  const names = (bs: BookingSummary[]) => bs.map((b) => `${b.guest.name} (${b.code})`).join(', ');
  let marked: BookingSummary[] = [];
  if (p.noShows.length) {
    if (!a.no_shows) {
      throw new HarnessInputError(`${p.noShows.length} arrival${p.noShows.length === 1 ? '' : 's'} never checked in: ${names(p.noShows)}. Ask whether to mark them as no-shows (all, some, or none) before closing the day.`);
    }
    if (a.no_shows === 'all') marked = p.noShows;
    else if (a.no_shows === 'listed') {
      const codes = new Set((a.no_show_codes ?? []).map((c) => c.replace(/^#/, '').toUpperCase()));
      marked = p.noShows.filter((b) => codes.has(b.code.toUpperCase()));
      const unknown = [...codes].filter((c) => !p.noShows.some((b) => b.code.toUpperCase() === c));
      if (unknown.length) throw new HarnessInputError(`${unknown.join(', ')} ${unknown.length === 1 ? 'isn’t' : 'aren’t'} among the arrivals that never came: ${names(p.noShows)}.`);
      if (!marked.length) throw new HarnessInputError('Give the confirmation codes to mark as no-shows in no_show_codes, or use no_shows "all" or "none".');
    }
  }
  const flag = a.flag_stayovers ?? true;
  const open = [
    p.overdueDepartures.length ? `${p.overdueDepartures.length} past check-out still in house` : '',
    p.unpaidInHouse.length ? `${p.unpaidInHouse.length} in house with something to pay` : '',
    p.noShows.length - marked.length > 0 ? `${p.noShows.length - marked.length} arrival${p.noShows.length - marked.length === 1 ? '' : 's'} left open` : '',
  ].filter(Boolean);
  return {
    steps: [
      {
        tool: 'close_business_day',
        args: { propertyId: ctx.propertyId, businessDate: p.businessDate, noShowBookingIds: marked.map((b) => b.id), flagOccupiedRooms: flag, notes: a.notes?.trim() || null },
        summary: `Close the business day ${formatDay(p.businessDate, 'weekday')}`,
        detail: [
          marked.length ? `Mark ${marked.length} no-show${marked.length === 1 ? '' : 's'}: ${names(marked)}` : 'No no-shows marked',
          flag ? 'flag occupied rooms for stayover cleaning' : '',
          `${p.numbers.occupancyPct}% occupancy`,
          open.length ? `still open: ${open.join(', ')}` : '',
        ]
          .filter(Boolean)
          .join(' · '),
      },
    ],
    warnings: ['A closed day can’t be reopened.'],
    risk: 'high',
  };
}

// ---------------------------------------------------------------------------
// Room type settings
// ---------------------------------------------------------------------------

export interface RoomTypeChange {
  base_price?: number;
  capacity?: number;
  name?: string;
  description?: string;
  total_rooms?: number;
  for_sale?: boolean;
}

/** "Raise the deluxe base price to $165", "the twin sleeps 3 now". */
export async function planRoomType(ctx: ToolCtx, rt: { id: string; name: string }, a: RoomTypeChange): Promise<PlanOutput> {
  if (!can(ctx.actor, 'inventory.write')) return refused('Room types are changed by managers and owners.');
  const row = await prisma.roomType.findFirst({
    where: { id: rt.id, propertyId: ctx.propertyId },
    select: { id: true, name: true, description: true, capacity: true, basePrice: true, totalRooms: true, isActive: true, _count: { select: { rooms: true } } },
  });
  if (!row) throw new HarnessInputError('No such room type here. Call list_room_types.');
  const { currency } = await hotelLocale(ctx.propertyId);
  const fmt = (n: number) => money(n, { cents: true, currency });
  const args: Record<string, unknown> = { roomTypeId: row.id };
  const parts: string[] = [];
  if (a.name !== undefined && a.name.trim() !== row.name) {
    const name = a.name.replace(/\s+/g, ' ').trim();
    if (name.length < 2) throw new HarnessInputError('A room type’s name needs at least 2 characters.');
    args.name = name;
    parts.push(`rename to “${name}”`);
  }
  if (a.base_price !== undefined && a.base_price !== Number(row.basePrice)) {
    args.basePrice = a.base_price;
    parts.push(`base price ${fmt(Number(row.basePrice))} → ${fmt(a.base_price)}`);
  }
  if (a.capacity !== undefined && a.capacity !== row.capacity) {
    args.capacity = a.capacity;
    parts.push(`sleeps ${row.capacity} → ${a.capacity}`);
  }
  if (a.total_rooms !== undefined && a.total_rooms !== row.totalRooms) {
    if (a.total_rooms < row._count.rooms) throw new HarnessInputError(`${row.name} has ${row._count.rooms} room numbers set up; it can’t have fewer rooms than that. Remove room numbers on the Room types page first.`);
    args.totalRooms = a.total_rooms;
    parts.push(`${row.totalRooms} → ${a.total_rooms} rooms`);
  }
  if (a.description !== undefined && a.description.trim() !== (row.description ?? '')) {
    args.description = a.description.trim();
    parts.push('new description');
  }
  if (a.for_sale !== undefined && a.for_sale !== row.isActive) {
    args.isActive = a.for_sale;
    parts.push(a.for_sale ? 'put back on sale' : 'take off sale');
  }
  if (!parts.length) throw new HarnessInputError(`${row.name} already has those settings; nothing to change.`);
  const warnings: string[] = [];
  if (args.basePrice !== undefined) {
    warnings.push('The base price is used on nights without their own rate. Nights with a custom rate keep it; reservations keep the price they booked at.');
    const before = Number(row.basePrice);
    if (before > 0 && Math.abs((a.base_price! - before) / before) > 0.5) warnings.push(`${fmt(a.base_price!)} is more than 50% away from ${fmt(before)}: double-check it.`);
  }
  if (args.basePrice !== undefined || args.totalRooms !== undefined) warnings.push('The booking site and connected channels update right away.');
  return {
    steps: [{ tool: 'update_room_type', args, summary: `${row.name}: ${parts.join(', ')}`, detail: 'Room type settings' }],
    warnings,
    risk: 'medium',
  };
}

// ---------------------------------------------------------------------------
// Booking channels
// ---------------------------------------------------------------------------

const CHANNEL_NAMES: Record<string, string> = { EXPEDIA: 'Expedia', BOOKING_COM: 'Booking.com' };

export async function channelStatusRead(ctx: ToolCtx): Promise<ReadOut> {
  if (!can(ctx.actor, 'channels.view')) return { blocks: [], forModel: 'The booking channels aren’t part of this person’s role: say so.', isError: true };
  const since = new Date(Date.now() - 7 * 86_400_000);
  const connections = await prisma.channelConnection.findMany({
    where: { propertyId: ctx.propertyId },
    select: {
      id: true,
      channel: true,
      mode: true,
      status: true,
      otaPropertyName: true,
      syncRates: true,
      syncAvailability: true,
      importReservations: true,
      defaultMarkupPercent: true,
      lastAriSyncAt: true,
      lastReservationPullAt: true,
      lastError: true,
      syncLogs: { where: { createdAt: { gte: since }, status: 'FAILED' }, orderBy: { createdAt: 'desc' }, take: 3, select: { action: true, message: true, createdAt: true } },
      _count: { select: { syncLogs: { where: { createdAt: { gte: since }, status: 'FAILED' } } } },
    },
  });
  if (!connections.length) {
    return { blocks: [], forModel: 'No booking channels (Expedia, Booking.com) are connected at this hotel. They’re set up on the Channels page.' };
  }
  return {
    blocks: [],
    forModel: JSON.stringify({
      channels: connections.map((c) => ({
        channel: CHANNEL_NAMES[c.channel] ?? c.channel,
        listing: c.otaPropertyName ?? undefined,
        status: c.status.toLowerCase(),
        mode: c.mode === 'SANDBOX' ? 'sandbox (test)' : 'live',
        sends: [c.syncRates && 'rates', c.syncAvailability && 'availability'].filter(Boolean),
        importsReservations: c.importReservations,
        markupPercent: Number(c.defaultMarkupPercent) || undefined,
        lastRatesSent: c.lastAriSyncAt?.toISOString(),
        lastReservationsPulled: c.lastReservationPullAt?.toISOString(),
        lastError: c.lastError ?? undefined,
        failuresLast7Days: c._count.syncLogs,
        recentFailures: c.syncLogs.map((l) => ({ at: l.createdAt.toISOString(), action: l.action.toLowerCase().replace(/_/g, ' '), message: l.message.slice(0, 200) })),
      })),
      note: 'For their full history use search_activity_log with kinds ["channels"]. Channel rates, markups and promotions are managed on the Channels page (its own assistant).',
    }),
  };
}
