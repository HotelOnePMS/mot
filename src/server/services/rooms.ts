/**
 * Room board: physical rooms with housekeeping status and live occupancy
 * derived from today's bookings.
 */
import { prisma } from '@/lib/prisma';
import type { ISODate, Occupancy, RoomStatus, RoomSummary } from '@/lib/dto';
import { ROOM_STATUS } from '@/lib/status';
import { assertPropertyAccess, requirePermission, type Actor } from '../authz';
import { atNoonUTC, hotelToday, toISODate } from '../dates';
import { badRequest, notFound } from '../errors';
import { recordAudit, type OpContext } from './audit';
import { floorNumber, personName } from './mappers';

export async function roomBoard(actor: Actor, propertyId: string, day: ISODate = hotelToday()): Promise<RoomSummary[]> {
  requirePermission(actor, 'room.view');
  assertPropertyAccess(actor, propertyId);

  const [rooms, bookings] = await Promise.all([
    prisma.room.findMany({
      where: { propertyId },
      include: {
        roomType: { select: { id: true, name: true } },
        housekeeping: {
          where: { status: { in: ['PENDING', 'IN_PROGRESS'] } },
          orderBy: { createdAt: 'desc' },
          take: 1,
          include: { assignee: { select: { id: true, firstName: true, lastName: true } } },
        },
      },
    }),
    prisma.booking.findMany({
      where: {
        propertyId,
        roomId: { not: null },
        status: { in: ['PENDING', 'CONFIRMED', 'CHECKED_IN'] },
        checkIn: { lte: atNoonUTC(day) },
        checkOut: { gte: atNoonUTC(day) },
      },
      select: {
        id: true,
        code: true,
        roomId: true,
        status: true,
        checkIn: true,
        checkOut: true,
        user: { select: { firstName: true, lastName: true } },
      },
    }),
  ]);

  const byRoom = new Map<string, typeof bookings>();
  for (const b of bookings) {
    if (!b.roomId) continue;
    byRoom.set(b.roomId, [...(byRoom.get(b.roomId) ?? []), b]);
  }

  return rooms
    .map((r): RoomSummary => {
      const list = byRoom.get(r.id) ?? [];
      const current = list.find((b) => b.status === 'CHECKED_IN');
      const arriving = list.find((b) => b.status !== 'CHECKED_IN' && toISODate(b.checkIn) <= day && toISODate(b.checkOut) > day);
      const departingToday = current && toISODate(current.checkOut) <= day;
      let occupancy: Occupancy = 'VACANT';
      if (current && departingToday && arriving) occupancy = 'TURNOVER';
      else if (current && departingToday) occupancy = 'DEPARTING';
      else if (current) occupancy = 'OCCUPIED';
      else if (arriving) occupancy = 'ARRIVING';
      const task = r.housekeeping[0];
      return {
        id: r.id,
        number: r.roomNumber,
        floor: r.floor,
        status: (r.isOutOfOrder ? 'OUT_OF_ORDER' : r.status) as RoomStatus,
        isOutOfOrder: r.isOutOfOrder,
        outOfOrderReason: r.outOfOrderReason,
        tags: r.tags,
        notes: r.notes,
        roomType: r.roomType,
        occupancy,
        current: current
          ? { bookingId: current.id, code: current.code ?? '', guestName: personName(current.user), checkOut: toISODate(current.checkOut) }
          : null,
        arriving: arriving
          ? { bookingId: arriving.id, code: arriving.code ?? '', guestName: personName(arriving.user), checkIn: toISODate(arriving.checkIn) }
          : null,
        task: task
          ? {
              id: task.id,
              status: task.status,
              priority: task.priority,
              assignee: task.assignee ? { id: task.assignee.id, name: personName(task.assignee) } : null,
            }
          : null,
      };
    })
    .sort((a, b) => floorNumber(a.floor) - floorNumber(b.floor) || a.number.localeCompare(b.number, undefined, { numeric: true }));
}

async function loadRoom(actor: Actor, roomIdOrNumber: string, propertyId?: string) {
  const key = roomIdOrNumber.trim();
  const room = await prisma.room.findFirst({
    where: propertyId ? { propertyId, OR: [{ id: key }, { roomNumber: key }] } : { id: key },
  });
  if (!room) throw notFound(`Room ${key}`);
  assertPropertyAccess(actor, room.propertyId);
  return room;
}

export async function findRoom(actor: Actor, propertyId: string, roomNumberOrId: string) {
  return loadRoom(actor, roomNumberOrId, propertyId);
}

export async function setRoomStatus(
  ctx: OpContext,
  roomIdOrNumber: string,
  status: Exclude<RoomStatus, 'OUT_OF_ORDER'>,
  propertyId?: string
) {
  requirePermission(ctx.actor, 'room.status');
  const room = await loadRoom(ctx.actor, roomIdOrNumber, propertyId);
  if (room.isOutOfOrder) throw badRequest(`Room ${room.roomNumber} is out of order. Return it to service first.`);
  if (ctx.actor.role === 'HOUSEKEEPER' && status === 'INSPECTED') {
    throw badRequest('Inspections are signed off by a supervisor or the front desk.');
  }
  const updated = await prisma.$transaction(async (tx) => {
    const r = await tx.room.update({ where: { id: room.id }, data: { status } });
    if (status === 'CLEAN' || status === 'INSPECTED') {
      await tx.roomHousekeeping.updateMany({
        where: { roomId: room.id, status: { in: ['PENDING', 'IN_PROGRESS'] } },
        data: { status: status === 'INSPECTED' ? 'INSPECTED' : 'COMPLETED', completedAt: new Date() },
      });
    }
    return r;
  });
  await recordAudit(ctx, room.propertyId, 'ROOM_STATUS', `Room ${room.roomNumber}: ${ROOM_STATUS[room.status as RoomStatus]?.label ?? room.status} → ${ROOM_STATUS[status].label}`, {
    roomId: room.id,
    from: room.status,
    to: status,
  });
  return updated;
}

export async function setOutOfOrder(ctx: OpContext, roomIdOrNumber: string, outOfOrder: boolean, reason?: string, propertyId?: string) {
  requirePermission(ctx.actor, 'room.outOfOrder');
  const room = await loadRoom(ctx.actor, roomIdOrNumber, propertyId);
  if (outOfOrder) {
    const occupied = await prisma.booking.findFirst({ where: { roomId: room.id, status: 'CHECKED_IN' }, select: { id: true } });
    if (occupied) throw badRequest(`Room ${room.roomNumber} is occupied. Move the guest before taking it out of order.`);
  }
  const updated = await prisma.room.update({
    where: { id: room.id },
    data: outOfOrder
      ? { isOutOfOrder: true, outOfOrderReason: reason?.trim() || 'Maintenance', status: 'OUT_OF_ORDER' }
      : { isOutOfOrder: false, outOfOrderReason: null, status: 'DIRTY' },
  });
  await recordAudit(
    ctx,
    room.propertyId,
    outOfOrder ? 'ROOM_OUT_OF_ORDER' : 'ROOM_BACK_IN_SERVICE',
    outOfOrder
      ? `Room ${room.roomNumber} out of order: ${updated.outOfOrderReason}`
      : `Room ${room.roomNumber} back in service (needs cleaning)`,
    { roomId: room.id }
  );
  return updated;
}
