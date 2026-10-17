import { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { assertPropertyAccess, requireStaff } from '@/server/authz';
import { badRequest, notFound } from '@/server/errors';
import { handleRoute, json, parseJson } from '@/server/http';
import { recordAudit } from '@/server/services/audit';
import { propertySchema } from '@/server/schemas';
import { assertDemoHotelUnchanged } from '@/server/demo';
import { scheduleConfigSkillSync } from '@/server/skills';

type Params = { params: Promise<{ propertyId: string }> };

export const GET = handleRoute(async (_req: NextRequest, { params }: Params) => {
  const { propertyId } = await params;
  const actor = await requireStaff();
  assertPropertyAccess(actor, propertyId);
  const property = await prisma.property.findUnique({
    where: { id: propertyId },
    include: { photos: true, roomTypes: { include: { photos: true } }, _count: { select: { rooms: true, bookings: true } } },
  });
  if (!property) throw notFound('Property');
  return json(property);
});

export const PUT = handleRoute(async (request: NextRequest, { params }: Params) => {
  const { propertyId } = await params;
  const actor = await requireStaff('property.write');
  assertPropertyAccess(actor, propertyId);
  const body = await parseJson(request, propertySchema);
  const current = await prisma.property.findUniqueOrThrow({ where: { id: propertyId }, select: { isDemo: true, name: true, tagline: true, description: true, isActive: true } });
  assertDemoHotelUnchanged(actor, current, body, ['name', 'tagline', 'description', 'isActive']);
  const updated = await prisma.property.update({
    where: { id: propertyId },
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
      ...(body.tagline !== undefined ? { tagline: body.tagline || null } : {}),
      ...(body.primaryColor !== undefined ? { primaryColor: body.primaryColor || null } : {}),
      ...(body.type !== undefined ? { type: body.type } : {}),
      ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
    },
  });
  await recordAudit({ actor, source: 'classic' }, propertyId, 'PROPERTY_UPDATE', `Updated property details for ${updated.name}`);
  // Amenities, address and contact details are agent skills.
  scheduleConfigSkillSync(propertyId);
  return json(updated);
});

export const DELETE = handleRoute(async (_req: NextRequest, { params }: Params) => {
  const { propertyId } = await params;
  const actor = await requireStaff('property.delete');
  assertPropertyAccess(actor, propertyId);
  const active = await prisma.booking.count({ where: { propertyId, status: { in: ['PENDING', 'CONFIRMED', 'CHECKED_IN'] } } });
  if (active > 0) throw badRequest(`This property has ${active} active booking${active > 1 ? 's' : ''}. Cancel or complete them first.`);
  try {
    await prisma.property.delete({ where: { id: propertyId } });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2003') {
      throw badRequest('This property still has booking history. Deactivate it instead of deleting.');
    }
    throw e;
  }
  return json({ success: true });
});
