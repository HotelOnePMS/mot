import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requirePermission, requireStaff, scopeProperties } from '@/server/authz';
import { handleRoute, json, parseJson } from '@/server/http';
import { recordAudit } from '@/server/services/audit';
import { propertySchema } from '@/server/schemas';
import { scheduleConfigSkillSync } from '@/server/skills';

/** GET — properties the caller can manage, with room types and booking counts. */
export const GET = handleRoute(async () => {
  const actor = await requireStaff();
  const properties = await prisma.property.findMany({
    where: scopeProperties(actor),
    include: {
      roomTypes: { select: { id: true, name: true, capacity: true, totalRooms: true, basePrice: true, isActive: true } },
      photos: { where: { isMain: true }, take: 1, select: { url: true } },
      _count: { select: { bookings: true, rooms: true } },
    },
    orderBy: [{ isDemo: 'asc' }, { createdAt: 'desc' }],
  });
  return json(properties);
});

/** POST — create a property. Owners are assigned to what they create. */
export const POST = handleRoute(async (request: NextRequest) => {
  const actor = await requireStaff();
  requirePermission(actor, 'property.create');
  const body = await parseJson(request, propertySchema);
  const property = await prisma.$transaction(async (tx) => {
    const p = await tx.property.create({
      data: {
        name: body.name,
        description: body.description || null,
        address: body.address,
        city: body.city,
        state: body.state,
        zipCode: body.zipCode,
        phone: body.phone,
        email: body.email || null,
        amenities: body.amenities ?? [],
        tagline: body.tagline || null,
        primaryColor: body.primaryColor || null,
        type: body.type ?? 'Hotel',
        isActive: body.isActive ?? true,
      },
    });
    if (actor.role !== 'ADMIN') {
      await tx.userPropertyAssignment.create({ data: { userId: actor.userId, propertyId: p.id } });
    }
    return p;
  });
  await recordAudit({ actor, source: 'classic' }, property.id, 'PROPERTY_CREATE', `Created property ${property.name}`);
  scheduleConfigSkillSync(property.id);
  return json(property, { status: 201 });
});
