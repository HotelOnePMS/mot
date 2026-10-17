/**
 * Housekeeping: task queue, assignment (manual + balanced auto-assign),
 * and status updates that keep the room's clean/dirty state in sync.
 */
import type { HousekeepingStatus as PrismaHkStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type { HousekeepingStatus, HousekeepingTaskDTO, ISODate, Occupancy, RoomStatus } from '@/lib/dto';
import { HOUSEKEEPING_STATUS } from '@/lib/status';
import { assertPropertyAccess, requirePermission, type Actor } from '../authz';
import { atNoonUTC, dayBounds, hotelToday } from '../dates';
import { badRequest, forbidden, notFound } from '../errors';
import { recordAudit, type OpContext } from './audit';
import { floorNumber, personName } from './mappers';
import { listTeam } from './team';

const OPEN: PrismaHkStatus[] = ['PENDING', 'IN_PROGRESS'];

export async function listTasks(
  actor: Actor,
  propertyId: string,
  opts: { mine?: boolean; includeDone?: boolean } = {}
): Promise<HousekeepingTaskDTO[]> {
  requirePermission(actor, 'housekeeping.view');
  assertPropertyAccess(actor, propertyId);
  const today = hotelToday();
  const tasks = await prisma.roomHousekeeping.findMany({
    where: {
      room: { propertyId },
      AND: [
        // "Mine" for housekeepers also includes unassigned rooms they can claim.
        opts.mine ? { OR: [{ assignedTo: actor.userId }, { assignedTo: null }] } : {},
        opts.includeDone
          ? { OR: [{ status: { in: OPEN } }, { completedAt: { gte: dayBounds(today).gte } }] }
          : { status: { in: OPEN } },
      ],
    },
    include: {
      room: {
        include: {
          roomType: { select: { name: true } },
          bookings: {
            where: { status: { in: ['CONFIRMED', 'CHECKED_IN', 'PENDING'] }, checkIn: { lte: atNoonUTC(today) }, checkOut: { gte: atNoonUTC(today) } },
            select: { status: true, checkIn: true, checkOut: true },
          },
        },
      },
      assignee: { select: { id: true, firstName: true, lastName: true } },
    },
    orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
  });
  return tasks
    .map((t) => {
      const inHouse = t.room.bookings.find((b) => b.status === 'CHECKED_IN');
      const arriving = t.room.bookings.find((b) => b.status !== 'CHECKED_IN');
      const occupancy: Occupancy = inHouse ? 'OCCUPIED' : arriving ? 'ARRIVING' : 'VACANT';
      return {
        id: t.id,
        status: t.status as HousekeepingStatus,
        priority: t.priority,
        notes: t.notes,
        createdAt: t.createdAt.toISOString(),
        completedAt: t.completedAt?.toISOString() ?? null,
        room: {
          id: t.room.id,
          number: t.room.roomNumber,
          floor: t.room.floor,
          roomTypeName: t.room.roomType.name,
          status: (t.room.isOutOfOrder ? 'OUT_OF_ORDER' : t.room.status) as RoomStatus,
          occupancy,
        },
        assignee: t.assignee ? { id: t.assignee.id, name: personName(t.assignee) } : null,
      };
    })
    .sort((a, b) => {
      const doneA = a.status === 'COMPLETED' || a.status === 'INSPECTED' ? 1 : 0;
      const doneB = b.status === 'COMPLETED' || b.status === 'INSPECTED' ? 1 : 0;
      return doneA - doneB || b.priority - a.priority || floorNumber(a.room.floor) - floorNumber(b.room.floor);
    });
}

async function assertHousekeeperForProperty(propertyId: string, userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, isActive: true, firstName: true, lastName: true, assignedProperties: { where: { propertyId }, select: { id: true } } },
  });
  if (!user || !user.isActive) throw notFound('Team member');
  if (user.role !== 'HOUSEKEEPER' && user.role !== 'MANAGER') throw badRequest(`${personName(user)} is not on the housekeeping team.`);
  if (user.assignedProperties.length === 0) throw badRequest(`${personName(user)} is not assigned to this property.`);
  return user;
}

export async function assignRoomCleaning(
  ctx: OpContext,
  roomId: string,
  assigneeId: string | null,
  opts: { priority?: number; notes?: string } = {}
) {
  requirePermission(ctx.actor, 'housekeeping.assign');
  const room = await prisma.room.findUnique({ where: { id: roomId } });
  if (!room) throw notFound('Room');
  assertPropertyAccess(ctx.actor, room.propertyId);
  const assignee = assigneeId ? await assertHousekeeperForProperty(room.propertyId, assigneeId) : null;

  const existing = await prisma.roomHousekeeping.findFirst({ where: { roomId, status: { in: OPEN } } });
  const task = existing
    ? await prisma.roomHousekeeping.update({
        where: { id: existing.id },
        data: {
          assignedTo: assignee?.id ?? null,
          ...(opts.priority ? { priority: opts.priority } : {}),
          ...(opts.notes ? { notes: opts.notes } : {}),
        },
      })
    : await prisma.roomHousekeeping.create({
        data: { roomId, assignedTo: assignee?.id ?? null, status: 'PENDING', priority: opts.priority ?? 1, notes: opts.notes ?? null },
      });
  await recordAudit(
    ctx,
    room.propertyId,
    'HOUSEKEEPING_ASSIGN',
    assignee ? `Room ${room.roomNumber} assigned to ${personName(assignee)}` : `Room ${room.roomNumber} queued for cleaning (unassigned)`,
    { roomId, taskId: task.id, assigneeId: assignee?.id ?? null }
  );
  return task;
}

/**
 * Plan (without writing) a balanced assignment of every dirty, unassigned
 * room. Rooms needed for today's arrivals are prioritised.
 */
export async function planAutoAssign(actor: Actor, propertyId: string) {
  requirePermission(actor, 'housekeeping.assign');
  assertPropertyAccess(actor, propertyId);
  const today = hotelToday();
  const [team, rooms, openTasks, arrivalsByType] = await Promise.all([
    listTeam(actor, propertyId, ['HOUSEKEEPER']),
    prisma.room.findMany({
      where: { propertyId, isOutOfOrder: false, status: 'DIRTY' },
      include: { roomType: { select: { id: true, name: true } }, housekeeping: { where: { status: { in: OPEN } }, select: { id: true, assignedTo: true } } },
    }),
    prisma.roomHousekeeping.groupBy({
      by: ['assignedTo'],
      where: { status: { in: OPEN }, room: { propertyId }, assignedTo: { not: null } },
      _count: { _all: true },
    }),
    prisma.booking.groupBy({
      by: ['roomTypeId'],
      where: { propertyId, status: { in: ['PENDING', 'CONFIRMED'] }, checkIn: dayBounds(today) },
      _sum: { rooms: true },
    }),
  ]);
  const needed = new Map(arrivalsByType.map((a) => [a.roomTypeId, a._sum.rooms ?? 0]));
  const load = new Map(team.map((m) => [m.id, 0]));
  for (const t of openTasks) if (t.assignedTo && load.has(t.assignedTo)) load.set(t.assignedTo, t._count._all);

  const todo = rooms
    .filter((r) => !r.housekeeping.some((h) => h.assignedTo))
    .map((r) => ({ room: r, priority: (needed.get(r.roomType.id) ?? 0) > 0 ? 3 : 1 }))
    .sort((a, b) => b.priority - a.priority || floorNumber(a.room.floor) - floorNumber(b.room.floor));

  const plan: { roomId: string; roomNumber: string; floor: string | null; roomType: string; assigneeId: string; assigneeName: string; priority: number }[] = [];
  if (team.length === 0) return { plan, team, unassignable: todo.length };
  for (const { room, priority } of todo) {
    // Least-loaded housekeeper; ties broken by keeping floors together.
    const sorted = [...team].sort((a, b) => (load.get(a.id) ?? 0) - (load.get(b.id) ?? 0));
    const pick = sorted[0];
    load.set(pick.id, (load.get(pick.id) ?? 0) + 1);
    plan.push({ roomId: room.id, roomNumber: room.roomNumber, floor: room.floor, roomType: room.roomType.name, assigneeId: pick.id, assigneeName: pick.name, priority });
  }
  return { plan, team, unassignable: 0 };
}

export async function autoAssign(ctx: OpContext, propertyId: string) {
  const { plan, team } = await planAutoAssign(ctx.actor, propertyId);
  if (team.length === 0) throw badRequest('No housekeepers are assigned to this property yet. Add them under Team.');
  for (const p of plan) {
    await assignRoomCleaning({ ...ctx, source: ctx.source }, p.roomId, p.assigneeId, { priority: p.priority });
  }
  return plan;
}

export async function updateTaskStatus(ctx: OpContext, taskId: string, status: HousekeepingStatus) {
  requirePermission(ctx.actor, 'housekeeping.update');
  const task = await prisma.roomHousekeeping.findUnique({ where: { id: taskId }, include: { room: true } });
  if (!task) throw notFound('Task');
  assertPropertyAccess(ctx.actor, task.room.propertyId);
  if (ctx.actor.role === 'HOUSEKEEPER') {
    if (task.assignedTo && task.assignedTo !== ctx.actor.userId) throw forbidden('This room is assigned to someone else.');
    if (status === 'INSPECTED') throw forbidden('Inspections are signed off by a supervisor or the front desk.');
  }
  const done = status === 'COMPLETED' || status === 'INSPECTED';
  const updated = await prisma.$transaction(async (tx) => {
    const t = await tx.roomHousekeeping.update({
      where: { id: taskId },
      data: {
        status,
        completedAt: done ? new Date() : null,
        // A housekeeper starting an unassigned room claims it.
        ...(ctx.actor.role === 'HOUSEKEEPER' && !task.assignedTo ? { assignedTo: ctx.actor.userId } : {}),
      },
    });
    if (done && !task.room.isOutOfOrder) {
      await tx.room.update({ where: { id: task.roomId }, data: { status: status === 'INSPECTED' ? 'INSPECTED' : 'CLEAN' } });
    }
    return t;
  });
  await recordAudit(ctx, task.room.propertyId, 'HOUSEKEEPING_STATUS', `Room ${task.room.roomNumber}: ${HOUSEKEEPING_STATUS[status].label}`, {
    taskId,
    roomId: task.roomId,
    status,
  });
  return updated;
}

export async function deleteTask(ctx: OpContext, taskId: string) {
  requirePermission(ctx.actor, 'housekeeping.delete');
  const task = await prisma.roomHousekeeping.findUnique({ where: { id: taskId }, include: { room: true } });
  if (!task) throw notFound('Task');
  assertPropertyAccess(ctx.actor, task.room.propertyId);
  await prisma.roomHousekeeping.delete({ where: { id: taskId } });
  await recordAudit(ctx, task.room.propertyId, 'HOUSEKEEPING_DELETE', `Removed cleaning task for room ${task.room.roomNumber}`, { taskId });
}

export type { ISODate };
