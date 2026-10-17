import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { assertPropertyAccess, requireStaff, type Permission } from '@/server/authz';
import { badRequest, notFound } from '@/server/errors';
import { handleRoute, json, parseJson } from '@/server/http';
import { recordAudit } from '@/server/services/audit';
import { scheduleConfigSkillSync } from '@/server/skills';

type Params = { params: Promise<{ roomTypeId: string }> };

async function loadScoped(roomTypeId: string, perm?: Permission) {
  const actor = await requireStaff(perm);
  const roomType = await prisma.roomType.findUnique({ where: { id: roomTypeId }, select: { id: true, propertyId: true, name: true } });
  if (!roomType) throw notFound('Room type');
  assertPropertyAccess(actor, roomType.propertyId);
  return { actor, roomType };
}

/** GET — a room type with its photos, physical rooms and booking count. */
export const GET = handleRoute(async (_req: NextRequest, { params }: Params) => {
  const { roomTypeId } = await params;
  await loadScoped(roomTypeId);
  const roomType = await prisma.roomType.findUnique({
    where: { id: roomTypeId },
    include: {
      property: { select: { id: true, name: true, city: true, state: true } },
      photos: { orderBy: [{ isMain: 'desc' }, { createdAt: 'asc' }] },
      rooms: { orderBy: [{ floor: 'asc' }, { roomNumber: 'asc' }], select: { id: true, roomNumber: true, floor: true, tags: true, notes: true, status: true, isOutOfOrder: true } },
      _count: { select: { bookings: true } },
    },
  });
  return json(roomType ? { ...roomType, basePrice: Number(roomType.basePrice) } : null);
});

const updateSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    description: z.string().trim().max(2000).nullable(),
    capacity: z.coerce.number().int().min(1).max(20),
    basePrice: z.coerce.number().min(0).max(100000),
    totalRooms: z.coerce.number().int().min(0).max(2000),
    amenities: z.array(z.string().trim().min(1).max(60)).max(60),
    isActive: z.boolean(),
  })
  .partial();

async function update(request: NextRequest, { params }: Params) {
  const { roomTypeId } = await params;
  const { actor, roomType } = await loadScoped(roomTypeId, 'inventory.write');
  const body = await parseJson(request, updateSchema);
  if (body.totalRooms !== undefined) {
    const physical = await prisma.room.count({ where: { roomTypeId } });
    if (body.totalRooms < physical) throw badRequest(`There are ${physical} room numbers set up for this type — remove some before lowering the count.`);
  }
  const updated = await prisma.roomType.update({
    where: { id: roomTypeId },
    data: { ...body, description: body.description === undefined ? undefined : body.description || null },
    include: { property: { select: { id: true, name: true } } },
  });
  await recordAudit({ actor, source: 'classic' }, roomType.propertyId, 'ROOM_TYPE_UPDATE', `Updated room type ${updated.name}`, { roomTypeId });
  scheduleConfigSkillSync(roomType.propertyId);
  return json({ ...updated, basePrice: Number(updated.basePrice) });
}

/** PATCH (and legacy PUT) — update any subset of the room type's fields. */
export const PATCH = handleRoute(update);
export const PUT = handleRoute(update);

/** DELETE — remove a room type, or retire it if it has booking history. */
export const DELETE = handleRoute(async (_req: NextRequest, { params }: Params) => {
  const { roomTypeId } = await params;
  const { actor, roomType } = await loadScoped(roomTypeId, 'inventory.write');
  const bookings = await prisma.booking.count({ where: { roomTypeId } });
  if (bookings > 0) {
    await prisma.roomType.update({ where: { id: roomTypeId }, data: { isActive: false } });
    await recordAudit({ actor, source: 'classic' }, roomType.propertyId, 'ROOM_TYPE_UPDATE', `Retired room type ${roomType.name}`, { roomTypeId });
    scheduleConfigSkillSync(roomType.propertyId);
    return json({ retired: true, message: `${roomType.name} has booking history, so it was hidden from sale instead of deleted.` });
  }
  await prisma.roomType.delete({ where: { id: roomTypeId } });
  await recordAudit({ actor, source: 'classic' }, roomType.propertyId, 'ROOM_TYPE_DELETE', `Deleted room type ${roomType.name}`, { roomTypeId });
  scheduleConfigSkillSync(roomType.propertyId);
  return json({ retired: false, message: `${roomType.name} deleted.` });
});
