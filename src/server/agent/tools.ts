/**
 * The agent's tools. Read tools answer immediately with UI blocks built from
 * live data. Write tools never change anything when planned: they resolve
 * entities, validate against the same domain rules the classic UI uses, and
 * return plan steps for the person to confirm. Executors run confirmed steps
 * through the domain services (permission-checked and audited).
 */
import { prisma } from '@/lib/prisma';
import type { AgentBlock, AgentContextState, QuickAction, RoomOption } from '@/lib/agent/blocks';
import type { BookingStatus, BookingSummary, ISODate, OccupancyDay } from '@/lib/dto';
import { money, PAYMENT_STATUS } from '@/lib/status';
import { can } from '../authz';
import { addDaysISO, diffDays, eachNight, formatDay, toISODate } from '../dates';
import { DomainError } from '../errors';
import type { OpContext } from '../services/audit';
import { listActivity } from '../services/audit';
import { addBookingNote, allowedTransitions, assignRoom, checkTransition, suggestRooms, transitionBooking } from '../services/bookings';
import { enqueueTask } from '../services/bridge';
import { frontDeskSummary, occupancySeries } from '../services/frontdesk';
import { assignRoomCleaning, listTasks, planAutoAssign } from '../services/housekeeping';
import { propertyAvailability } from '../services/inventory';
import { bookingInclude, floorNumber, toBookingSummary, type BookingWithRelations } from '../services/mappers';
import { changeRates } from '../services/rates';
import { roomBoard, setOutOfOrder, setRoomStatus } from '../services/rooms';
import { listTeam } from '../services/team';
import type { PlanStep } from './plan';
import { hasPrefs, type Intent, type RoomPrefs } from './nlu';
import { resolveBooking, resolveRoom, resolveRoomTypes, resolveTeamMember, type ResolveCtx } from './resolve';

export type ToolCtx = ResolveCtx;

export interface ReadOutput {
  blocks: AgentBlock[];
  memory?: Partial<AgentContextState>;
}

export interface PlanOutput {
  steps: PlanStep[];
  warnings: string[];
  risk: 'low' | 'medium' | 'high';
  blocks?: AgentBlock[];
  memory?: Partial<AgentContextState>;
  /** Stop planning the rest of the message (e.g. a clarifying question). */
  abort?: boolean;
}

const RISK_ORDER = { low: 0, medium: 1, high: 2 } as const;
export const maxRisk = (a: PlanOutput['risk'], b: PlanOutput['risk']) => (RISK_ORDER[a] >= RISK_ORDER[b] ? a : b);

// ---------------------------------------------------------------------------
// Presentation helpers
// ---------------------------------------------------------------------------

export function statusLine(intent: Intent): string {
  switch (intent.kind) {
    case 'overview':
      return 'Pulling together today at a glance…';
    case 'arrivals':
      return `Looking up arrivals ${intent.label}…`;
    case 'departures':
      return `Looking up departures ${intent.label}…`;
    case 'inHouse':
      return 'Checking who’s in house…';
    case 'find':
      return 'Searching reservations…';
    case 'availability':
      return `Checking availability ${intent.range.label}…`;
    case 'occupancy':
      return `Calculating occupancy for ${intent.range.label}…`;
    case 'weekendForecast':
      return `Forecasting ${intent.weekends.length} weekend${intent.weekends.length > 1 ? 's' : ''}…`;
    case 'rooms':
      return 'Reading the room board…';
    case 'housekeeping':
      return 'Checking the housekeeping queue…';
    case 'activity':
      return 'Reading the activity log…';
    case 'suggestRooms':
      return 'Ranking rooms for this stay…';
    case 'checkIn':
      return 'Preparing check-in…';
    case 'checkOut':
      return 'Preparing check-out…';
    case 'assignRoom':
      return 'Finding the right room…';
    case 'assignArrivals':
      return 'Matching rooms to today’s arrivals…';
    case 'autoAssignCleaning':
      return 'Balancing rooms across housekeepers…';
    case 'adjustRates':
      return 'Working out the new rates…';
    case 'note':
      return 'Preparing the note…';
    case 'roomStatus':
    case 'outOfOrder':
    case 'backInService':
      return 'Checking the room…';
    case 'assignCleaning':
      return 'Lining up housekeeping…';
    case 'confirm':
    case 'cancel':
    case 'noShow':
      return 'Finding the reservation…';
    case 'help':
      return 'Here’s what I can do…';
    case 'unknown':
      return 'Thinking…';
    default:
      return 'Working on it…';
  }
}

export function bookingActions(b: BookingSummary, today: ISODate): QuickAction[] {
  const actions: QuickAction[] = [];
  const arrivingNow = (b.status === 'CONFIRMED' || b.status === 'PENDING') && b.checkIn <= today && b.checkOut > today;
  if (b.status === 'PENDING') actions.push({ label: 'Confirm', command: `confirm ${b.code}` });
  if (arrivingNow) actions.push({ label: 'Check in', command: `check in ${b.code}`, tone: 'primary' });
  if (b.status === 'CONFIRMED' || b.status === 'PENDING') actions.push({ label: b.room ? 'Change room' : 'Choose room', command: `best room for ${b.code}` });
  if (b.status === 'CHECKED_IN') actions.push({ label: 'Check out', command: `check out ${b.code}`, tone: 'primary' });
  if (b.status !== 'CANCELLED' && b.status !== 'CHECKED_OUT' && b.status !== 'NO_SHOW') {
    actions.push({ label: 'Add note', command: `add a note to ${b.code}: `, mode: 'prefill' });
  }
  if (arrivingNow) actions.push({ label: 'No-show', command: `mark ${b.code} as no-show`, tone: 'danger' });
  else if (b.status === 'CONFIRMED' || b.status === 'PENDING') actions.push({ label: 'Cancel', command: `cancel ${b.code}`, tone: 'danger' });
  return actions;
}

function bookingMemory(b: BookingWithRelations | BookingSummary): Partial<AgentContextState> {
  if ('guest' in b) return { lastBookingId: b.id, lastBookingCode: b.code, lastGuestName: b.guest.name, lastRoomNumber: b.room?.number };
  return {
    lastBookingId: b.id,
    lastBookingCode: b.code ?? undefined,
    lastGuestName: `${b.user.firstName} ${b.user.lastName}`,
    lastRoomNumber: b.room?.roomNumber,
  };
}

function guestName(b: BookingWithRelations) {
  return `${b.user.firstName} ${b.user.lastName}`.trim();
}

function prefsLabel(p: RoomPrefs): string {
  return [p.highFloor && 'high floor', p.lowFloor && 'low floor', ...p.tags].filter(Boolean).join(', ');
}

/** Which requested preferences a room does not satisfy, in plain words. */
function unmetPrefs(p: RoomPrefs, option: RoomOption): string[] {
  const out: string[] = [];
  if (p.highFloor && !option.reasons.some((r) => r.startsWith('Highest free floor'))) out.push('on a high floor');
  if (p.lowFloor && !option.reasons.some((r) => r.startsWith('Lowest free floor'))) out.push('on a low floor');
  for (const t of p.tags) if (!option.room.tags.map((x) => x.toLowerCase()).includes(t)) out.push(t);
  return out;
}

function fail(text: string): PlanOutput {
  return { steps: [], warnings: [], risk: 'low', blocks: [{ type: 'error', text }], abort: true };
}

function summarizeOccupancy(days: OccupancyDay[]) {
  const sold = days.reduce((s, d) => s + d.roomsSold, 0);
  const capacity = days.reduce((s, d) => s + d.totalRooms, 0);
  const revenue = days.reduce((s, d) => s + d.revenue, 0);
  return {
    averagePct: capacity ? Math.round((sold / capacity) * 100) : 0,
    revenue: Math.round(revenue),
    adr: sold ? Math.round(revenue / sold) : 0,
    sold,
    capacity,
  };
}

// ---------------------------------------------------------------------------
// Read tools
// ---------------------------------------------------------------------------

export async function runRead(ctx: ToolCtx, intent: Intent): Promise<ReadOutput> {
  const { actor, propertyId, today } = ctx;
  switch (intent.kind) {
    case 'overview': {
      const s = await frontDeskSummary(actor, propertyId, today);
      const st = s.stats;
      return {
        blocks: [
          {
            type: 'text',
            text: `Here’s **${s.property.name}** right now: ${st.arrivalsDue} arrival${st.arrivalsDue === 1 ? '' : 's'} still to check in, ${st.departuresDue} departure${st.departuresDue === 1 ? '' : 's'} due, and ${st.occupancyPct}% occupancy tonight.`,
          },
          {
            type: 'stats',
            items: [
              { label: 'Arrivals', value: `${st.arrivalsDone}/${st.arrivalsDone + st.arrivalsDue}`, hint: `${st.unassignedArrivals} need a room`, tone: 'info' },
              { label: 'Departures', value: `${st.departuresDone}/${st.departuresDone + st.departuresDue}`, hint: 'checked out', tone: 'warning' },
              { label: 'In house', value: String(st.inHouse), hint: 'guests staying', tone: 'brand' },
              { label: 'Tonight', value: `${st.occupancyPct}%`, hint: `${st.availableTonight} rooms to sell`, tone: 'agent' },
              { label: 'Ready rooms', value: String(st.clean + st.inspected), hint: `${st.dirty} dirty · ${st.outOfOrder} out of order`, tone: 'success' },
            ],
          },
          ...(s.alerts.length ? [{ type: 'alerts', items: s.alerts } as AgentBlock] : [{ type: 'text', text: 'No alerts — everything is on track. ✨' } as AgentBlock]),
        ],
      };
    }
    case 'arrivals': {
      const s = await frontDeskSummary(actor, propertyId, intent.day);
      const due = s.arrivals.filter((b) => b.status !== 'CHECKED_IN').length;
      return {
        blocks: [
          {
            type: 'bookings',
            title: `Arrivals ${intent.label}`,
            variant: 'arrivals',
            items: s.arrivals,
            emptyText: `No arrivals ${intent.label}.`,
          },
          ...(s.arrivals.length && intent.day === today
            ? [{ type: 'text', text: `${due} still to check in${s.stats.unassignedArrivals ? `, ${s.stats.unassignedArrivals} without a room yet` : ''}.` } as AgentBlock]
            : []),
        ],
      };
    }
    case 'departures': {
      const s = await frontDeskSummary(actor, propertyId, intent.day);
      return {
        blocks: [{ type: 'bookings', title: `Departures ${intent.label}`, variant: 'departures', items: s.departures, emptyText: `No departures ${intent.label}.` }],
      };
    }
    case 'inHouse': {
      const s = await frontDeskSummary(actor, propertyId, today);
      return { blocks: [{ type: 'bookings', title: 'In house now', variant: 'inhouse', items: s.inHouse, emptyText: 'Nobody is checked in right now.' }] };
    }
    case 'find': {
      const r = await resolveBooking(ctx, intent.ref, 'any');
      if (!r.ok) return { blocks: [r.block] };
      const summary = toBookingSummary(r.value);
      const history = await prisma.bookingStatusHistory.findMany({
        where: { bookingId: r.value.id },
        orderBy: { createdAt: 'desc' },
        take: 6,
        select: { status: true, notes: true, createdAt: true },
      });
      return {
        blocks: [
          {
            type: 'booking',
            booking: summary,
            actions: bookingActions(summary, today),
            history: history.map((h) => ({ ...h, createdAt: h.createdAt.toISOString() })),
          },
        ],
        memory: bookingMemory(summary),
      };
    }
    case 'availability': {
      const rows = await propertyAvailability({ propertyId, checkIn: intent.range.from, checkOut: intent.range.to, guests: intent.guests, rooms: intent.rooms });
      const fitting = rows.filter((r) => r.capacity * intent.rooms >= intent.guests);
      const nights = diffDays(intent.range.from, intent.range.to);
      const anyFree = fitting.some((r) => r.available >= intent.rooms);
      return {
        blocks: [
          {
            type: 'availability',
            checkIn: intent.range.from,
            checkOut: intent.range.to,
            guests: intent.guests,
            items: (fitting.length ? fitting : rows).map((r) => ({
              id: r.id,
              name: r.name,
              capacity: r.capacity,
              available: r.available,
              total: r.totalRooms,
              averageNightly: r.quote?.averageNightly ?? 0,
              totalPrice: r.quote?.total ?? 0,
            })),
          },
          {
            type: 'text',
            text: anyFree
              ? `Prices are for ${nights} night${nights > 1 ? 's' : ''}, ${intent.guests} guest${intent.guests > 1 ? 's' : ''}${intent.rooms > 1 ? `, ${intent.rooms} rooms` : ''} — exactly what the booking site charges.`
              : `Nothing fits ${intent.guests} guest${intent.guests > 1 ? 's' : ''} for those dates. Try other dates or more rooms.`,
          },
        ],
      };
    }
    case 'occupancy': {
      const days = await occupancySeries(propertyId, intent.range.from, intent.range.to);
      const sum = summarizeOccupancy(days);
      return {
        blocks: [{ type: 'occupancy', title: `Occupancy · ${intent.range.label}`, days, averagePct: sum.averagePct, revenue: sum.revenue, adr: sum.adr }],
      };
    }
    case 'weekendForecast': {
      const periods = [];
      for (const w of intent.weekends) {
        const days = await occupancySeries(propertyId, w.from, w.to);
        const sum = summarizeOccupancy(days);
        const lead = diffDays(today, w.from);
        const range = `${formatDay(w.from, 'weekday')} – ${formatDay(w.to, 'weekday')}`;
        let recommendation: string;
        let tone: 'success' | 'warning' | 'info' | 'danger' | 'neutral';
        let action: QuickAction | undefined;
        if (sum.averagePct >= 85) {
          recommendation = `Strong demand with ${lead} days to go. Raise remaining inventory 10–15%.`;
          tone = 'success';
          action = { label: 'Raise 10%', command: `raise rates 10% from ${w.from} to ${w.to}` };
        } else if (sum.averagePct >= 60) {
          recommendation = 'On pace. Hold rates and watch pickup.';
          tone = 'info';
        } else if (sum.averagePct >= 40 || lead > 21) {
          recommendation = lead > 21 ? 'Early — hold rates; revisit two weeks out.' : 'Slightly soft. A 2-night package could lift Friday arrivals.';
          tone = 'neutral';
        } else {
          recommendation = `Soft with ${lead} days to go. Consider a 10% promotion.`;
          tone = 'warning';
          action = { label: 'Lower 10%', command: `lower rates 10% from ${w.from} to ${w.to}` };
        }
        periods.push({
          label: range,
          from: w.from,
          to: w.to,
          occupancyPct: sum.averagePct,
          roomsSold: sum.sold,
          roomsAvailable: sum.capacity - sum.sold,
          adr: sum.adr,
          revenue: sum.revenue,
          recommendation,
          tone,
          action,
        });
      }
      return {
        blocks: [
          { type: 'forecast', title: `Weekend outlook · next ${periods.length}`, periods },
          { type: 'text', text: 'Recommendations are rules-of-thumb from current pace (occupancy on the books vs. days to arrival). Nothing changes until you confirm.' },
        ],
      };
    }
    case 'rooms': {
      const board = await roomBoard(actor, propertyId, today);
      let rooms = board;
      const f = intent.filter;
      if (f.departingOn) {
        const departing = await prisma.booking.findMany({
          where: { propertyId, status: 'CHECKED_IN', roomId: { not: null }, checkOut: { gte: new Date(`${f.departingOn}T00:00:00Z`), lt: new Date(`${addDaysISO(f.departingOn, 1)}T00:00:00Z`) } },
          select: { roomId: true },
        });
        const ids = new Set(departing.map((d) => d.roomId));
        rooms = board.filter((r) => ids.has(r.id) || (f.departingOn === today && r.status === 'DIRTY'));
      }
      if (f.status === 'DIRTY') rooms = rooms.filter((r) => r.status === 'DIRTY');
      if (f.status === 'CLEAN') rooms = rooms.filter((r) => r.status === 'CLEAN' || r.status === 'INSPECTED');
      if (f.status === 'OUT_OF_ORDER') rooms = rooms.filter((r) => r.isOutOfOrder);
      if (f.occupancy === 'VACANT') rooms = rooms.filter((r) => r.occupancy === 'VACANT' && !r.isOutOfOrder);
      if (f.floor) rooms = rooms.filter((r) => String(floorNumber(r.floor)) === f.floor);
      const blocks: AgentBlock[] = [{ type: 'rooms', title: `${intent.label} · ${rooms.length}`, rooms }];
      if (intent.note) blocks.push({ type: 'text', text: intent.note });
      if (f.status === 'DIRTY' && rooms.some((r) => !r.task?.assignee)) blocks.push({ type: 'suggestions', items: ['auto-assign housekeeping'] });
      return { blocks };
    }
    case 'housekeeping': {
      const [tasks, team] = await Promise.all([listTasks(actor, propertyId, { includeDone: true }), listTeam(actor, propertyId, ['HOUSEKEEPER'])]);
      return { blocks: [{ type: 'housekeeping', title: 'Housekeeping today', tasks, team }] };
    }
    case 'activity': {
      if (!can(actor, 'activity.view')) return { blocks: [{ type: 'error', text: 'The activity log is visible to managers and owners.' }] };
      const items = await listActivity(propertyId, 15);
      return { blocks: [{ type: 'activity', items }, { type: 'navigate', label: 'Open full activity log', href: '/admin/activity' }] };
    }
    case 'property': {
      const p = await prisma.property.findUnique({
        where: { id: propertyId },
        include: { roomTypes: { where: { isActive: true }, select: { name: true, totalRooms: true, basePrice: true } } },
      });
      if (!p) return { blocks: [{ type: 'error', text: 'Property not found.' }] };
      return {
        blocks: [
          {
            type: 'text',
            text: `**${p.name}** · ${p.address}, ${p.city}, ${p.state} ${p.zipCode} · ${p.phone}\n${p.roomTypes.map((r) => `• ${r.name}: ${r.totalRooms} rooms from ${money(Number(r.basePrice), { cents: false })}`).join('\n')}`,
          },
          { type: 'navigate', label: 'Open the booking site', href: `/properties/${p.id}` },
        ],
      };
    }
    case 'suggestRooms': {
      const r = await resolveBooking(ctx, intent.ref, 'upcoming');
      if (!r.ok) return { blocks: [r.block] };
      const options = (await suggestRooms(actor, r.value.id, intent.prefs, { limit: 6 })) as RoomOption[];
      return {
        blocks: [
          {
            type: 'roomOptions',
            title: `Best rooms for ${guestName(r.value)}${hasPrefs(intent.prefs) ? ` · ${prefsLabel(intent.prefs)}` : ''}`,
            bookingCode: r.value.code ?? r.value.id,
            guestName: guestName(r.value),
            options,
          },
        ],
        memory: bookingMemory(r.value),
      };
    }
    case 'help':
      return {
        blocks: [
          {
            type: 'text',
            text:
              'I run the front desk with you. Ask in plain words — I show live data, and I **always ask before changing anything**.\n' +
              '• **Today:** “brief me”, “who’s arriving?”, “who’s leaving tomorrow?”\n' +
              '• **Guests:** “check in the Smiths, quiet room on a high floor”, “check out room 201”, “add a note to K7Q2MD: late arrival”\n' +
              '• **Rooms:** “which rooms need cleaning?”, “mark 203 clean”, “room 106 out of order — broken AC”\n' +
              '• **Housekeeping:** “auto-assign housekeeping”, “have Rosa clean 303”\n' +
              '• **Revenue:** “availability next Friday for 2 nights”, “forecast the next 3 weekends”, “raise weekend rates 10%”\n' +
              '• **Hotel questions:** “is parking free?”, “what’s our cancellation policy?” — answered from your saved answers',
          },
          { type: 'suggestions', items: ['brief me', 'who’s arriving today?', 'which rooms need cleaning?', 'forecast the next 3 weekends'] },
        ],
      };
    default:
      return {
        blocks: [
          { type: 'text', text: 'I didn’t quite catch that. Here are some things I can do — or switch to Classic for the full screens. If it’s a question about the hotel, a manager can add the answer on the Skills page and I’ll know it next time.' },
          { type: 'suggestions', items: ['brief me', 'who’s arriving today?', 'which rooms need cleaning?', 'help'] },
        ],
      };
  }
}

// ---------------------------------------------------------------------------
// Write planners
// ---------------------------------------------------------------------------

async function bookingWarnings(b: BookingWithRelations): Promise<string[]> {
  const w: string[] = [];
  if (b.notes) w.push(`Note on file: ${b.notes.split('\n').slice(-1)[0].replace(/^\[[^\]]+\]\s*/, '')}`);
  const pay = b.paymentStatus ?? 'UNPAID';
  if (pay === 'AWAITING_PAYMENT') w.push(`Online payment hasn’t completed — collect ${money(Number(b.totalPrice))} at the desk.`);
  return w;
}

async function pickRoom(
  ctx: ToolCtx,
  b: BookingWithRelations,
  opts: { roomNumber?: string; prefs: RoomPrefs; forCheckIn: boolean; exclude?: Set<string> }
): Promise<{ ok: true; room: RoomOption; allowDirty: boolean; reason: string } | { ok: false; block: AgentBlock }> {
  if (opts.roomNumber) {
    const room = await resolveRoom(ctx, opts.roomNumber);
    if (!room.ok) return room;
    const options = await suggestRooms(ctx.actor, b.id, { roomNumber: opts.roomNumber }, { limit: 50 });
    const hit = options.find((o) => o.room.id === room.value.id);
    if (!hit) {
      const why =
        room.value.roomTypeId !== b.roomTypeId
          ? `room ${room.value.roomNumber} is a ${room.value.roomType.name}, but ${guestName(b)} booked a ${b.roomType.name}`
          : room.value.isOutOfOrder
            ? `room ${room.value.roomNumber} is out of order`
            : `room ${room.value.roomNumber} is taken for those nights`;
      return { ok: false, block: { type: 'error', text: `I can’t use that room: ${why}.` } };
    }
    return { ok: true, room: hit, allowDirty: opts.forCheckIn && !hit.ready, reason: 'Requested room' };
  }
  if (!hasPrefs(opts.prefs) && b.room && opts.forCheckIn) {
    const options = await suggestRooms(ctx.actor, b.id, {}, { limit: 50 });
    const keep = options.find((o) => o.room.id === b.room!.id);
    if (keep) return { ok: true, room: keep, allowDirty: !keep.ready, reason: 'Pre-assigned' };
  }
  const options = (await suggestRooms(ctx.actor, b.id, opts.prefs, { limit: 50 })).filter((o) => !opts.exclude?.has(o.room.id));
  const ready = options.find((o) => o.ready);
  if (ready) return { ok: true, room: ready, allowDirty: false, reason: ready.reasons.join(', ') };
  if (options[0]) return { ok: true, room: options[0], allowDirty: opts.forCheckIn, reason: options[0].reasons.join(', ') };
  return { ok: false, block: { type: 'error', text: `No ${b.roomType.name} room is free for ${guestName(b)}’s nights.` } };
}

export async function planWrite(ctx: ToolCtx, intent: Intent): Promise<PlanOutput> {
  const { actor, propertyId, today } = ctx;
  switch (intent.kind) {
    case 'checkIn': {
      if (!can(actor, 'booking.checkin')) return fail('Your role can’t check guests in.');
      const r = await resolveBooking(ctx, intent.ref, 'checkIn');
      if (!r.ok) return { steps: [], warnings: [], risk: 'low', blocks: [r.block], abort: true };
      const b = r.value;
      const check = await checkTransition(actor, b, 'CHECKED_IN');
      if (!check.ok) return { ...fail(check.reason), memory: bookingMemory(b) };
      const pick = await pickRoom(ctx, b, { roomNumber: intent.roomNumber, prefs: intent.prefs, forCheckIn: true });
      if (!pick.ok) return { steps: [], warnings: [], risk: 'low', blocks: [pick.block], abort: true, memory: bookingMemory(b) };
      const warnings = await bookingWarnings(b);
      if (pick.allowDirty) warnings.push(`Room ${pick.room.room.number} hasn’t been cleaned yet — no clean ${b.roomType.name} is free. Check in anyway, or ask housekeeping to rush it.`);
      const unmet = unmetPrefs(intent.prefs, pick.room);
      if (unmet.length) {
        const better = (await suggestRooms(actor, b.id, intent.prefs, { limit: 20 })).find((o) => !o.ready && unmetPrefs(intent.prefs, o).length === 0);
        warnings.push(
          `No ready room is ${unmet.join(' and ')} right now — Room ${pick.room.room.number} is the closest.` +
            (better ? ` Room ${better.room.number} matches everything but still needs cleaning (“check in ${b.code} to room ${better.room.number}” to use it).` : '')
        );
      }
      return {
        steps: [
          {
            tool: 'check_in',
            args: { bookingId: b.id, roomId: pick.room.room.id, allowDirtyRoom: pick.allowDirty },
            summary: `Check in ${guestName(b)} → Room ${pick.room.room.number}`,
            detail: `${b.roomType.name} · floor ${pick.room.room.floor ?? '—'} · ${pick.reason} · ${b.guests} guest${b.guests > 1 ? 's' : ''}, ${diffDays(toISODate(b.checkIn), toISODate(b.checkOut))} nights${b.status === 'PENDING' ? ' · also confirms the booking' : ''}`,
          },
        ],
        warnings,
        risk: 'low',
        memory: { ...bookingMemory(b), lastRoomNumber: pick.room.room.number },
      };
    }
    case 'checkOut': {
      if (!can(actor, 'booking.checkout')) return fail('Your role can’t check guests out.');
      const r = await resolveBooking(ctx, intent.ref, 'checkOut');
      if (!r.ok) return { steps: [], warnings: [], risk: 'low', blocks: [r.block], abort: true };
      const b = r.value;
      const check = await checkTransition(actor, b, 'CHECKED_OUT');
      if (!check.ok) return { ...fail(check.reason), memory: bookingMemory(b) };
      const warnings: string[] = [];
      const due = toISODate(b.checkOut);
      if (due > today) warnings.push(`Early departure — due ${formatDay(due)}. Unused nights go back on sale.`);
      if ((b.paymentStatus ?? 'UNPAID') !== 'PAID') warnings.push(`Balance ${money(Number(b.totalPrice))} — ${PAYMENT_STATUS[b.paymentStatus ?? 'UNPAID']?.label ?? 'unpaid'}. Settle before the guest leaves.`);
      return {
        steps: [
          {
            tool: 'check_out',
            args: { bookingId: b.id },
            summary: `Check out ${guestName(b)}${b.room ? ` from Room ${b.room.roomNumber}` : ''}`,
            detail: b.room ? `Room ${b.room.roomNumber} will be marked dirty and queued for housekeeping` : undefined,
          },
        ],
        warnings,
        risk: 'low',
        memory: bookingMemory(b),
      };
    }
    case 'assignRoom': {
      if (!can(actor, 'booking.assignRoom')) return fail('Your role can’t assign rooms.');
      const r = await resolveBooking(ctx, intent.ref, 'upcoming');
      if (!r.ok) return { steps: [], warnings: [], risk: 'low', blocks: [r.block], abort: true };
      const b = r.value;
      const pick = await pickRoom(ctx, b, { roomNumber: intent.roomNumber, prefs: intent.prefs, forCheckIn: false });
      if (!pick.ok) return { steps: [], warnings: [], risk: 'low', blocks: [pick.block], abort: true };
      return {
        steps: [
          {
            tool: 'assign_room',
            args: { bookingId: b.id, roomId: pick.room.room.id },
            summary: `${b.room ? 'Move' : 'Assign'} ${guestName(b)} ${b.room ? `from Room ${b.room.roomNumber} ` : ''}to Room ${pick.room.room.number}`,
            detail: `${b.roomType.name} · floor ${pick.room.room.floor ?? '—'} · ${pick.reason}`,
          },
        ],
        warnings: pick.room.ready ? [] : [`Room ${pick.room.room.number} still needs cleaning before arrival.`],
        risk: 'low',
        memory: { ...bookingMemory(b), lastRoomNumber: pick.room.room.number },
      };
    }
    case 'note': {
      if (!can(actor, 'booking.note')) return fail('Your role can’t add notes.');
      const r = await resolveBooking(ctx, intent.ref, 'any');
      if (!r.ok) return { steps: [], warnings: [], risk: 'low', blocks: [r.block], abort: true };
      return {
        steps: [{ tool: 'add_note', args: { bookingId: r.value.id, note: intent.text }, summary: `Add note to ${guestName(r.value)}`, detail: `“${intent.text}”` }],
        warnings: [],
        risk: 'low',
        memory: bookingMemory(r.value),
      };
    }
    case 'confirm':
    case 'cancel':
    case 'noShow': {
      const to: BookingStatus = intent.kind === 'confirm' ? 'CONFIRMED' : intent.kind === 'cancel' ? 'CANCELLED' : 'NO_SHOW';
      const r = await resolveBooking(ctx, intent.ref, intent.kind === 'noShow' ? 'checkIn' : 'upcoming');
      if (!r.ok) return { steps: [], warnings: [], risk: 'low', blocks: [r.block], abort: true };
      const b = r.value;
      const check = await checkTransition(actor, b, to);
      if (!check.ok) return { ...fail(check.reason), memory: bookingMemory(b) };
      const verb = intent.kind === 'confirm' ? 'Confirm' : intent.kind === 'cancel' ? 'Cancel' : 'Mark no-show for';
      const reason = intent.kind === 'cancel' ? intent.reason : undefined;
      return {
        steps: [
          {
            tool: 'transition',
            args: { bookingId: b.id, to, note: reason },
            summary: `${verb} ${guestName(b)} (${b.code})`,
            detail: `${b.roomType.name} · ${formatDay(toISODate(b.checkIn))}–${formatDay(toISODate(b.checkOut))} · ${money(Number(b.totalPrice))}${reason ? ` · reason: ${reason}` : ''}`,
          },
        ],
        warnings: to === 'CANCELLED' ? ['Cancelling releases the room back to sale. This can be reinstated by a manager.'] : to === 'NO_SHOW' ? ['The room is released for tonight.'] : [],
        risk: to === 'CONFIRMED' ? 'low' : 'high',
        memory: bookingMemory(b),
      };
    }
    case 'roomStatus': {
      if (!can(actor, 'room.status')) return fail('Your role can’t change room status.');
      const steps: PlanStep[] = [];
      for (const n of intent.roomNumbers) {
        const room = await resolveRoom(ctx, n);
        if (!room.ok) return { steps: [], warnings: [], risk: 'low', blocks: [room.block], abort: true };
        if (room.value.isOutOfOrder) return fail(`Room ${n} is out of order. Say “room ${n} is fixed” first.`);
        steps.push({
          tool: 'set_room_status',
          args: { roomId: room.value.id, status: intent.status },
          summary: `Mark Room ${room.value.roomNumber} ${intent.status.toLowerCase()}`,
          detail: `Currently ${room.value.status.toLowerCase()}${intent.status !== 'DIRTY' ? ' · closes any open cleaning task' : ''}`,
        });
      }
      return { steps, warnings: [], risk: 'low', memory: { lastRoomNumber: intent.roomNumbers[0] } };
    }
    case 'outOfOrder': {
      if (!can(actor, 'room.outOfOrder')) return fail('Your role can’t take rooms out of order.');
      const room = await resolveRoom(ctx, intent.roomNumber);
      if (!room.ok) return { steps: [], warnings: [], risk: 'low', blocks: [room.block], abort: true };
      const occupant = await prisma.booking.findFirst({ where: { roomId: room.value.id, status: 'CHECKED_IN' }, include: bookingInclude });
      if (occupant) return fail(`Room ${intent.roomNumber} is occupied by ${guestName(occupant)}. Move them first (“move ${occupant.code} to another room”).`);
      const arriving = await prisma.booking.findFirst({ where: { roomId: room.value.id, status: { in: ['CONFIRMED', 'PENDING'] } }, include: bookingInclude });
      return {
        steps: [
          {
            tool: 'set_out_of_order',
            args: { roomId: room.value.id, outOfOrder: true, reason: intent.reason },
            summary: `Take Room ${room.value.roomNumber} out of order`,
            detail: intent.reason ? `Reason: ${intent.reason}` : 'Reason: maintenance',
          },
        ],
        warnings: arriving ? [`${guestName(arriving)} (${arriving.code}) is assigned this room for ${formatDay(toISODate(arriving.checkIn))} — reassign them after.`] : [],
        risk: 'medium',
        memory: { lastRoomNumber: room.value.roomNumber },
      };
    }
    case 'backInService': {
      if (!can(actor, 'room.outOfOrder')) return fail('Your role can’t return rooms to service.');
      const room = await resolveRoom(ctx, intent.roomNumber);
      if (!room.ok) return { steps: [], warnings: [], risk: 'low', blocks: [room.block], abort: true };
      if (!room.value.isOutOfOrder) return fail(`Room ${intent.roomNumber} is already in service.`);
      return {
        steps: [
          {
            tool: 'set_out_of_order',
            args: { roomId: room.value.id, outOfOrder: false },
            summary: `Return Room ${room.value.roomNumber} to service`,
            detail: 'It will be marked dirty so housekeeping cleans it first',
          },
        ],
        warnings: [],
        risk: 'low',
        memory: { lastRoomNumber: room.value.roomNumber },
      };
    }
    case 'assignCleaning': {
      if (!can(actor, 'housekeeping.assign')) return fail('Your role can’t assign housekeeping.');
      let person: { id: string; firstName: string; lastName: string } | null = null;
      if (intent.who) {
        const p = await resolveTeamMember(ctx, intent.who);
        if (!p.ok) return { steps: [], warnings: [], risk: 'low', blocks: [p.block], abort: true };
        person = p.value;
      } else {
        const team = (await listTeam(actor, propertyId, ['HOUSEKEEPER'])).sort((a, b) => (a.openTasks ?? 0) - (b.openTasks ?? 0));
        if (!team.length) return fail('No housekeepers are assigned to this property yet.');
        const [firstName, ...rest] = team[0].name.split(' ');
        person = { id: team[0].id, firstName, lastName: rest.join(' ') };
      }
      const steps: PlanStep[] = [];
      for (const n of intent.roomNumbers) {
        const room = await resolveRoom(ctx, n);
        if (!room.ok) return { steps: [], warnings: [], risk: 'low', blocks: [room.block], abort: true };
        steps.push({
          tool: 'assign_cleaning',
          args: { roomId: room.value.id, assigneeId: person.id },
          summary: `Have ${person.firstName} clean Room ${room.value.roomNumber}`,
          detail: `${room.value.roomType.name} · currently ${room.value.status.toLowerCase()}`,
        });
      }
      return { steps, warnings: intent.who ? [] : [`${person.firstName} has the lightest load right now.`], risk: 'low' };
    }
    case 'autoAssignCleaning': {
      if (!can(actor, 'housekeeping.assign')) return fail('Your role can’t assign housekeeping.');
      const { plan, team } = await planAutoAssign(actor, propertyId);
      if (!team.length) return fail('No housekeepers are assigned to this property yet. Invite them under Team.');
      if (!plan.length) return { steps: [], warnings: [], risk: 'low', blocks: [{ type: 'text', text: 'Every dirty room already has someone on it. 🧹' }] };
      return {
        steps: plan.map((p) => ({
          tool: 'assign_cleaning',
          args: { roomId: p.roomId, assigneeId: p.assigneeId, priority: p.priority },
          summary: `Room ${p.roomNumber} → ${p.assigneeName}`,
          detail: `${p.roomType} · floor ${p.floor ?? '—'}${p.priority >= 3 ? ' · needed for today’s arrivals' : ''}`,
        })),
        warnings: [],
        risk: 'low',
      };
    }
    case 'assignArrivals': {
      if (!can(actor, 'booking.assignRoom')) return fail('Your role can’t assign rooms.');
      const s = await frontDeskSummary(actor, propertyId, today);
      const pending = s.arrivals.filter((b) => b.status !== 'CHECKED_IN' && !b.room);
      if (!pending.length) return { steps: [], warnings: [], risk: 'low', blocks: [{ type: 'text', text: 'Every arrival today already has a room. 🎉' }] };
      const taken = new Set<string>();
      const steps: PlanStep[] = [];
      const warnings: string[] = [];
      for (const summary of pending) {
        const b = await prisma.booking.findUniqueOrThrow({ where: { id: summary.id }, include: bookingInclude });
        const pick = await pickRoom(ctx, b, { prefs: intent.prefs, forCheckIn: false, exclude: taken });
        if (!pick.ok) {
          warnings.push(`No ${b.roomType.name} free for ${guestName(b)}.`);
          continue;
        }
        taken.add(pick.room.room.id);
        if (!pick.room.ready) warnings.push(`Room ${pick.room.room.number} (for ${guestName(b)}) still needs cleaning.`);
        steps.push({
          tool: 'assign_room',
          args: { bookingId: b.id, roomId: pick.room.room.id },
          summary: `${guestName(b)} → Room ${pick.room.room.number}`,
          detail: `${b.roomType.name} · floor ${pick.room.room.floor ?? '—'} · ${pick.reason}`,
        });
      }
      return { steps, warnings, risk: 'low' };
    }
    case 'adjustRates': {
      if (!can(actor, 'rates.write')) return fail('Rate changes are made by managers and owners.');
      if (!intent.ranges.length) return fail('Which dates? Try “raise rates 10% next weekend” or “from Oct 20 to Oct 23”.');
      if (Math.abs(intent.percent) > 50) return fail('That’s a big swing. Changes over 50% are best done in the rate calendar.');
      const roomTypes = await resolveRoomTypes(ctx, intent.roomTypeHint);
      const steps: PlanStep[] = [];
      const soldOut: string[] = [];
      for (const range of intent.ranges) {
        const nights = eachNight(range.from, range.to);
        if (!nights.length) continue;
        const avail = await propertyAvailability({ propertyId, checkIn: range.from, checkOut: range.to });
        for (const rt of roomTypes) {
          const row = avail.find((a) => a.id === rt.id);
          if (row && row.available === 0 && !intent.roomTypeHint) {
            soldOut.push(`${rt.name} (${formatDay(nights[0])})`);
            continue;
          }
          const before = row?.quote?.averageNightly ?? Number(rt.basePrice);
          const after = Math.round(before * (1 + intent.percent / 100));
          steps.push({
            tool: 'adjust_rates',
            args: { roomTypeId: rt.id, startDate: nights[0], endDate: nights[nights.length - 1], percent: intent.percent },
            summary: `${rt.name} · ${formatDay(nights[0])}${nights.length > 1 ? `–${formatDay(nights[nights.length - 1])}` : ''}: ${money(before, { cents: false })} → ${money(after, { cents: false })}`,
            detail: `${intent.percent > 0 ? '+' : ''}${intent.percent}% · ${row?.available ?? '?'} of ${rt.totalRooms} still to sell`,
          });
        }
      }
      if (!steps.length) return fail(`Everything is already sold out for those dates — nothing to reprice.`);
      return {
        steps,
        warnings: [
          'Existing reservations keep the price they booked at. The booking site updates immediately.',
          ...(soldOut.length ? [`Skipped sold-out: ${soldOut.join(', ')}.`] : []),
        ],
        risk: 'medium',
      };
    }
    default:
      return { steps: [], warnings: [], risk: 'low' };
  }
}

// ---------------------------------------------------------------------------
// Executors (run only after the person confirms a signed plan)
// ---------------------------------------------------------------------------

export interface StepResult {
  ok: boolean;
  line: string;
  bookingId?: string;
  bridgeTask?: { id: string; system: string; instruction: string; kind: string; mode: string };
}

export async function executeStep(ctx: OpContext, step: PlanStep): Promise<StepResult> {
  const a = step.args as Record<string, string | number | boolean | undefined>;
  try {
    switch (step.tool) {
      case 'check_in': {
        const r = await transitionBooking(ctx, String(a.bookingId), 'CHECKED_IN', { roomId: String(a.roomId), allowDirtyRoom: !!a.allowDirtyRoom });
        return { ok: true, line: `Checked in ${r.booking.guest.name} → Room ${r.booking.room?.number ?? '—'}`, bookingId: r.booking.id };
      }
      case 'check_out': {
        const r = await transitionBooking(ctx, String(a.bookingId), 'CHECKED_OUT');
        return { ok: true, line: `Checked out ${r.booking.guest.name}${r.effects.length ? ` · ${r.effects.join(' · ')}` : ''}`, bookingId: r.booking.id };
      }
      case 'transition': {
        const r = await transitionBooking(ctx, String(a.bookingId), a.to as BookingStatus, { note: a.note ? String(a.note) : undefined });
        return { ok: true, line: `${r.booking.guest.name} (${r.booking.code}) is now ${r.to.toLowerCase().replace('_', ' ')}`, bookingId: r.booking.id };
      }
      case 'assign_room': {
        const b = await assignRoom(ctx, String(a.bookingId), String(a.roomId));
        return { ok: true, line: `${b.guest.name} assigned to Room ${b.room?.number}`, bookingId: b.id };
      }
      case 'add_note': {
        const b = await addBookingNote(ctx, String(a.bookingId), String(a.note));
        return { ok: true, line: `Note added to ${b.guest.name}`, bookingId: b.id };
      }
      case 'set_room_status': {
        const room = await setRoomStatus(ctx, String(a.roomId), a.status as 'CLEAN' | 'DIRTY' | 'INSPECTED');
        return { ok: true, line: `Room ${room.roomNumber} marked ${String(a.status).toLowerCase()}` };
      }
      case 'set_out_of_order': {
        const room = await setOutOfOrder(ctx, String(a.roomId), !!a.outOfOrder, a.reason ? String(a.reason) : undefined);
        return { ok: true, line: a.outOfOrder ? `Room ${room.roomNumber} is out of order` : `Room ${room.roomNumber} is back in service (needs cleaning)` };
      }
      case 'assign_cleaning': {
        await assignRoomCleaning(ctx, String(a.roomId), String(a.assigneeId), { priority: a.priority ? Number(a.priority) : undefined });
        return { ok: true, line: step.summary };
      }
      case 'adjust_rates': {
        const r = await changeRates(ctx, String(a.roomTypeId), String(a.startDate), String(a.endDate), { adjustPercent: Number(a.percent) });
        return { ok: true, line: r.summary };
      }
      case 'bridge_task': {
        const { task, connection } = await enqueueTask(ctx, String(a.propertyId), { kind: String(a.kind ?? 'ACTION'), instruction: String(a.instruction) });
        return { ok: true, line: `Sent to ${connection.system}: “${task.instruction}”`, bridgeTask: { id: task.id, system: connection.system, instruction: task.instruction, kind: task.kind, mode: connection.mode } };
      }
      default:
        return { ok: false, line: `Unknown action “${step.tool}”.` };
    }
  } catch (e) {
    const msg = e instanceof DomainError ? e.message : 'Something went wrong.';
    if (!(e instanceof DomainError)) console.error('Agent step failed:', step.tool, e);
    return { ok: false, line: `${step.summary} — ${msg}` };
  }
}

/** Follow-ups that make sense after the given intents. */
export function followUps(intents: Intent[], executed = false): string[] {
  const kinds = new Set(intents.map((i) => i.kind));
  const out: string[] = [];
  if (kinds.has('checkIn')) out.push(executed ? 'who else is arriving today?' : 'show today’s arrivals');
  if (kinds.has('checkOut')) out.push('which rooms need cleaning?', 'auto-assign housekeeping');
  if (kinds.has('arrivals')) out.push('assign rooms for today’s arrivals', 'which rooms need cleaning?');
  if (kinds.has('departures')) out.push('which rooms need cleaning?');
  if (kinds.has('rooms') || kinds.has('housekeeping')) out.push('auto-assign housekeeping');
  if (kinds.has('overview')) out.push('who’s arriving today?', 'forecast the next 3 weekends');
  if (kinds.has('weekendForecast') || kinds.has('occupancy')) out.push('availability next weekend for 2 guests');
  if (kinds.has('adjustRates')) out.push('forecast the next 3 weekends');
  if (out.length === 0) out.push('brief me', 'who’s arriving today?');
  return [...new Set(out)].slice(0, 3);
}

/** JSON-schema descriptions of the tools, for an LLM tool-calling engine. */
export const TOOL_CATALOG = [
  { name: 'today_overview', kind: 'read', description: 'Today at a glance: arrivals, departures, in-house, occupancy, room readiness and alerts.' },
  { name: 'list_arrivals', kind: 'read', description: 'Guests arriving on a date (YYYY-MM-DD), including late arrivals.' },
  { name: 'list_departures', kind: 'read', description: 'Guests departing on a date.' },
  { name: 'find_reservation', kind: 'read', description: 'Find a reservation by guest name, confirmation code or room number.' },
  { name: 'check_availability', kind: 'read', description: 'Rooms available and exact prices for a stay.' },
  { name: 'occupancy_forecast', kind: 'read', description: 'Occupancy, revenue and ADR per night for a date range.' },
  { name: 'room_board', kind: 'read', description: 'Rooms with cleaning status and occupancy, filterable.' },
  { name: 'check_in', kind: 'write', description: 'Check a guest in, assigning a room by number or preferences (quiet, high floor...).' },
  { name: 'check_out', kind: 'write', description: 'Check a guest out; their room is marked dirty and queued for housekeeping.' },
  { name: 'assign_room', kind: 'write', description: 'Assign or move a reservation to a specific room.' },
  { name: 'add_note', kind: 'write', description: 'Append a note to a reservation.' },
  { name: 'set_room_status', kind: 'write', description: 'Mark rooms clean, dirty or inspected.' },
  { name: 'set_out_of_order', kind: 'write', description: 'Take a room out of order or return it to service.' },
  { name: 'assign_cleaning', kind: 'write', description: 'Assign a room to a housekeeper.' },
  { name: 'adjust_rates', kind: 'write', description: 'Raise or lower nightly rates by a percentage for a date range.' },
] as const;

export { allowedTransitions };
