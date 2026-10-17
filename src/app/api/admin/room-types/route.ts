import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { assertPropertyAccess, requireStaff, scopeByProperty } from '@/server/authz';
import { notFound } from '@/server/errors';
import { handleRoute, json, parseJson, parseQuery } from '@/server/http';
import { recordAudit } from '@/server/services/audit';
import { scheduleConfigSkillSync } from '@/server/skills';

/** GET — room types across the caller's properties (optionally one property). */
export const GET = handleRoute(async (request: NextRequest) => {
  const actor = await requireStaff();
  const q = parseQuery(request, z.object({ propertyId: z.string().optional() }));
  if (q.propertyId) assertPropertyAccess(actor, q.propertyId);
  const roomTypes = await prisma.roomType.findMany({
    where: q.propertyId ? { propertyId: q.propertyId } : scopeByProperty(actor),
    include: {
      property: { select: { id: true, name: true } },
      photos: { orderBy: { isMain: 'desc' }, take: 1, select: { url: true } },
      _count: { select: { bookings: true, rooms: true } },
    },
    orderBy: [{ property: { name: 'asc' } }, { basePrice: 'asc' }],
  });
  return json(roomTypes);
});

const createSchema = z.object({
  propertyId: z.string().min(1),
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(2000).optional().nullable(),
  capacity: z.coerce.number().int().min(1).max(20),
  basePrice: z.coerce.number().min(0).max(100000),
  totalRooms: z.coerce.number().int().min(0).max(2000).default(0),
  amenities: z.array(z.string().trim().min(1).max(60)).max(60).optional(),
});

/**
 * POST — create a room type. Nightly prices default to the base price;
 * the rate calendar only stores exceptions, so nothing is pre-generated.
 */
export const POST = handleRoute(async (request: NextRequest) => {
  const actor = await requireStaff('inventory.write');
  const body = await parseJson(request, createSchema);
  assertPropertyAccess(actor, body.propertyId);
  const property = await prisma.property.findUnique({ where: { id: body.propertyId }, select: { id: true } });
  if (!property) throw notFound('Property');
  const roomType = await prisma.roomType.create({
    data: {
      propertyId: body.propertyId,
      name: body.name,
      description: body.description || null,
      capacity: body.capacity,
      basePrice: body.basePrice,
      totalRooms: body.totalRooms,
      amenities: body.amenities ?? [],
    },
    include: { property: { select: { id: true, name: true } } },
  });
  await recordAudit({ actor, source: 'classic' }, body.propertyId, 'ROOM_TYPE_CREATE', `Created room type ${roomType.name}`, { roomTypeId: roomType.id });
  scheduleConfigSkillSync(body.propertyId);
  return json(roomType, { status: 201 });
});
