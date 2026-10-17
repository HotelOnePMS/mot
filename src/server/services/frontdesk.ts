/**
 * The front desk's "today" view: arrivals, departures, in-house, room
 * readiness and the alerts that need someone's attention.
 */
import { prisma } from '@/lib/prisma';
import type { FrontDeskAlert, FrontDeskSummary, ISODate, OccupancyDay } from '@/lib/dto';
import { assertPropertyAccess, requirePermission, type Actor } from '../authz';
import { addDaysISO, atNoonUTC, eachNight, formatDay, hotelToday, toISODate } from '../dates';
import { notFound } from '../errors';
import { arrivalsOn, departuresOn, inHouse } from './bookings';
import { OCCUPYING_STATUSES } from './inventory';

export async function frontDeskSummary(actor: Actor, propertyId: string, day: ISODate = hotelToday()): Promise<FrontDeskSummary> {
  requirePermission(actor, 'frontdesk.view');
  assertPropertyAccess(actor, propertyId);

  const property = await prisma.property.findUnique({ where: { id: propertyId }, select: { id: true, name: true } });
  if (!property) throw notFound('Property');

  const [arrivals, departures, staying, rooms, roomTypes, tonight] = await Promise.all([
    arrivalsOn(propertyId, day),
    departuresOn(propertyId, day),
    inHouse(propertyId),
    prisma.room.findMany({
      where: { propertyId },
      select: {
        id: true,
        roomTypeId: true,
        status: true,
        isOutOfOrder: true,
        housekeeping: { where: { status: { in: ['PENDING', 'IN_PROGRESS'] } }, select: { assignedTo: true } },
      },
    }),
    prisma.roomType.findMany({ where: { propertyId, isActive: true }, select: { id: true, name: true, totalRooms: true } }),
    occupancyForNight(propertyId, day),
  ]);

  const arrivalsDue = arrivals.filter((b) => b.status !== 'CHECKED_IN');
  const departuresDue = departures.filter((b) => b.status === 'CHECKED_IN');
  const outOfOrder = rooms.filter((r) => r.isOutOfOrder).length;
  const dirtyRooms = rooms.filter((r) => !r.isOutOfOrder && r.status === 'DIRTY');
  const clean = rooms.filter((r) => !r.isOutOfOrder && r.status === 'CLEAN').length;
  const inspected = rooms.filter((r) => !r.isOutOfOrder && r.status === 'INSPECTED').length;
  const unassignedArrivals = arrivalsDue.filter((b) => !b.room).length;

  const alerts: FrontDeskAlert[] = [];
  const overdue = departuresDue.filter((b) => b.checkOut < day);
  if (overdue.length) {
    alerts.push({
      id: 'overdue',
      tone: 'danger',
      title: `${overdue.length} overdue check-out${overdue.length > 1 ? 's' : ''}`,
      detail: overdue.map((b) => `${b.guest.name} (due ${formatDay(b.checkOut)})`).join(', '),
      command: `check out ${overdue[0].guest.name}`,
    });
  }
  const late = arrivalsDue.filter((b) => b.checkIn < day);
  if (late.length) {
    alerts.push({
      id: 'late',
      tone: 'warning',
      title: `${late.length} late arrival${late.length > 1 ? 's' : ''} from a previous day`,
      detail: 'Decide whether to keep holding the room or mark a no-show.',
      command: `show reservation ${late[0].code}`,
    });
  }
  const pending = arrivalsDue.filter((b) => b.status === 'PENDING');
  if (pending.length) {
    alerts.push({
      id: 'pending',
      tone: 'info',
      title: `${pending.length} arrival${pending.length > 1 ? 's are' : ' is'} still unconfirmed`,
      command: `confirm ${pending[0].guest.name}`,
    });
  }
  if (unassignedArrivals) {
    alerts.push({
      id: 'unassigned',
      tone: 'info',
      title: `${unassignedArrivals} arrival${unassignedArrivals > 1 ? 's need' : ' needs'} a room`,
      detail: 'Pre-assigning rooms makes check-in a single tap.',
      command: 'assign rooms for today’s arrivals',
    });
  }
  // Room readiness per type: arrivals needing a room vs clean rooms free.
  for (const rt of roomTypes) {
    const needing = arrivalsDue.filter((b) => b.roomType.id === rt.id && !b.room).reduce((s, b) => s + b.rooms, 0);
    if (!needing) continue;
    const ready = rooms.filter((r) => r.roomTypeId === rt.id && !r.isOutOfOrder && (r.status === 'CLEAN' || r.status === 'INSPECTED')).length;
    if (ready < needing) {
      alerts.push({
        id: `ready-${rt.id}`,
        tone: 'warning',
        title: `${rt.name}: ${needing} arriving, ${ready} ready`,
        detail: 'Prioritise these rooms with housekeeping.',
        command: `which ${rt.name} rooms are dirty`,
      });
    }
  }
  const unassignedDirty = dirtyRooms.filter((r) => !r.housekeeping.some((h) => h.assignedTo)).length;
  if (unassignedDirty) {
    alerts.push({
      id: 'dirty',
      tone: 'info',
      title: `${unassignedDirty} dirty room${unassignedDirty > 1 ? 's' : ''} not assigned to housekeeping`,
      command: 'auto-assign housekeeping',
    });
  }

  const totalRooms = roomTypes.reduce((s, r) => s + r.totalRooms, 0);
  return {
    date: day,
    property,
    arrivals,
    departures,
    inHouse: staying,
    stats: {
      arrivalsDue: arrivalsDue.length,
      arrivalsDone: arrivals.length - arrivalsDue.length,
      departuresDue: departuresDue.length,
      departuresDone: departures.length - departuresDue.length,
      inHouse: staying.length,
      totalRooms,
      occupiedTonight: tonight.roomsSold,
      occupancyPct: tonight.occupancyPct,
      availableTonight: Math.max(0, totalRooms - tonight.roomsSold - outOfOrder),
      outOfOrder,
      dirty: dirtyRooms.length,
      clean,
      inspected,
      unassignedArrivals,
    },
    alerts,
  };
}

async function occupancyForNight(propertyId: string, day: ISODate): Promise<OccupancyDay> {
  const [series] = await occupancySeries(propertyId, day, addDaysISO(day, 1));
  return series;
}

/** Rooms sold, occupancy %, revenue and ADR per night in [from, to). */
export async function occupancySeries(propertyId: string, from: ISODate, to: ISODate): Promise<OccupancyDay[]> {
  const [roomTypes, bookings] = await Promise.all([
    prisma.roomType.aggregate({ where: { propertyId, isActive: true }, _sum: { totalRooms: true } }),
    prisma.booking.findMany({
      where: {
        propertyId,
        status: { in: [...OCCUPYING_STATUSES] },
        checkIn: { lt: atNoonUTC(to) },
        checkOut: { gt: atNoonUTC(from) },
      },
      select: { checkIn: true, checkOut: true, rooms: true, totalPrice: true },
    }),
  ]);
  const totalRooms = roomTypes._sum.totalRooms ?? 0;
  return eachNight(from, to).map((date) => {
    let roomsSold = 0;
    let revenue = 0;
    for (const b of bookings) {
      const bIn = toISODate(b.checkIn);
      const bOut = toISODate(b.checkOut);
      if (date >= bIn && date < bOut) {
        const nights = Math.max(1, eachNight(bIn, bOut).length);
        roomsSold += b.rooms;
        revenue += Number(b.totalPrice) / nights;
      }
    }
    return {
      date,
      roomsSold,
      totalRooms,
      occupancyPct: totalRooms ? Math.min(100, Math.round((roomsSold / totalRooms) * 100)) : 0,
      revenue: Math.round(revenue * 100) / 100,
      adr: roomsSold ? Math.round((revenue / roomsSold) * 100) / 100 : 0,
    };
  });
}

export async function occupancyForActor(actor: Actor, propertyId: string, from: ISODate, to: ISODate) {
  requirePermission(actor, 'frontdesk.view');
  assertPropertyAccess(actor, propertyId);
  return occupancySeries(propertyId, from, to);
}
