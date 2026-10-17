import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { assertPropertyAccess, requireStaff, scopeByProperty } from '@/server/authz';
import { badRequest, conflict, notFound } from '@/server/errors';
import { handleRoute, json, parseJson, parseQuery } from '@/server/http';
import { recordAudit } from '@/server/services/audit';

const query = z.object({
  propertyId: z.string().optional(),
  roomTypeId: z.string().optional(),
  includeHousekeeping: z.enum(['true', 'false']).optional(),
});

/** GET — physical rooms (scoped to the caller's properties). */
export const GET = handleRoute(async (request: NextRequest) => {
  const actor = await requireStaff('room.view');
  const q = parseQuery(request, query);
  if (q.propertyId) assertPropertyAccess(actor, q.propertyId);
  const rooms = await prisma.room.findMany({
    where: {
      ...(q.propertyId ? { propertyId: q.propertyId } : scopeByProperty(actor)),
      ...(q.roomTypeId ? { roomTypeId: q.roomTypeId } : {}),
    },
    include: {
      roomType: { select: { id: true, name: true } },
      ...(q.includeHousekeeping === 'true'
        ? {
            housekeeping: {
              where: { status: { in: ['PENDING', 'IN_PROGRESS'] } },
              include: { assignee: { select: { id: true, firstName: true, lastName: true } } },
              orderBy: { createdAt: 'desc' },
              take: 1,
            },
          }
        : {}),
    },
    orderBy: [{ floor: 'asc' }, { roomNumber: 'asc' }],
  });
  return json(rooms);
});

const createSchema = z
  .object({
    propertyId: z.string().min(1),
    roomTypeId: z.string().min(1),
    roomNumber: z.string().trim().min(1).max(20).optional(),
    /** Bulk: several room numbers of the same type at once. */
    roomNumbers: z.array(z.string().trim().min(1).max(20)).min(1).max(200).optional(),
    floor: z.string().trim().max(20).optional().nullable(),
    notes: z.string().max(500).optional().nullable(),
    tags: z.array(z.string().trim().min(1).max(24)).max(12).optional(),
  })
  .refine((b) => !!b.roomNumber !== !!b.roomNumbers, { message: 'Provide roomNumber or roomNumbers' });

/** Floor from a room number like 204 → "2", 1203 → "12"; null for "A1". */
function inferFloor(roomNumber: string): string | null {
  const m = roomNumber.match(/^(\d+)\d{2}$/);
  return m ? String(Number(m[1])) : null;
}

/**
 * POST — add one physical room, or several of one type (bulk). The room
 * type's sellable count grows to cover the room numbers that exist.
 */
export const POST = handleRoute(async (request: NextRequest) => {
  const actor = await requireStaff('room.manage');
  const body = await parseJson(request, createSchema);
  assertPropertyAccess(actor, body.propertyId);
  const roomType = await prisma.roomType.findUnique({ where: { id: body.roomTypeId }, select: { propertyId: true, name: true, totalRooms: true } });
  if (!roomType) throw notFound('Room type');
  if (roomType.propertyId !== body.propertyId) throw badRequest('That room type belongs to a different property.');

  const numbers = [...new Set(body.roomNumbers ?? [body.roomNumber!])];
  const existing = await prisma.room.findMany({
    where: { propertyId: body.propertyId, roomNumber: { in: numbers } },
    select: { roomNumber: true },
  });
  if (existing.length) {
    const list = existing.map((r) => r.roomNumber).join(', ');
    throw conflict(`Room${existing.length > 1 ? 's' : ''} ${list} already exist${existing.length > 1 ? '' : 's'} at this property.`);
  }

  const tags = body.tags?.map((t) => t.toLowerCase()) ?? [];
  const created = await prisma.$transaction(async (tx) => {
    const rooms = [];
    for (const roomNumber of numbers) {
      rooms.push(
        await tx.room.create({
          data: {
            propertyId: body.propertyId,
            roomTypeId: body.roomTypeId,
            roomNumber,
            floor: body.floor || inferFloor(roomNumber),
            notes: body.notes || null,
            tags,
            status: 'CLEAN',
            isOutOfOrder: false,
          },
          include: { roomType: { select: { id: true, name: true } } },
        })
      );
    }
    const physical = await tx.room.count({ where: { roomTypeId: body.roomTypeId } });
    if (physical > roomType.totalRooms) await tx.roomType.update({ where: { id: body.roomTypeId }, data: { totalRooms: physical } });
    return rooms;
  });

  await recordAudit(
    { actor, source: 'classic' },
    body.propertyId,
    'ROOM_CREATE',
    created.length === 1 ? `Added room ${created[0].roomNumber} (${roomType.name})` : `Added ${created.length} ${roomType.name} rooms: ${numbers.join(', ')}`.slice(0, 300),
    { roomIds: created.map((r) => r.id) }
  );
  return json(body.roomNumbers ? created : created[0], { status: 201 });
});
