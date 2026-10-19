import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { notFound } from '@/server/errors';
import { handleRoute, json } from '@/server/http';
import { voiceAvailable } from '@/server/voice/provider';
import { LISTED_PROPERTY } from '@/server/concierge/facts';

type Params = { params: Promise<{ propertyId: string }> };

/**
 * GET — the public booking-page view of a property: story, photos, brand
 * and its room types. Live prices come from ./availability for a stay.
 */
export const GET = handleRoute(async (_req: NextRequest, { params }: Params) => {
  const { propertyId } = await params;
  const p = await prisma.property.findFirst({
    where: { id: propertyId, ...LISTED_PROPERTY },
    include: {
      photos: { orderBy: [{ isMain: 'desc' }, { createdAt: 'asc' }], select: { id: true, url: true, isMain: true } },
      roomTypes: {
        where: { isActive: true },
        orderBy: { basePrice: 'asc' },
        include: { photos: { orderBy: [{ isMain: 'desc' }, { createdAt: 'asc' }], select: { id: true, url: true, isMain: true } } },
      },
      voiceAgent: { select: { enabled: true, guestWidget: true } },
      charges: { where: { isActive: true }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }], select: { name: true, kind: true, amount: true } },
    },
  });
  if (!p) throw notFound('Property');
  return json(
    {
      id: p.id,
      name: p.name,
      tagline: p.tagline,
      type: p.type,
      description: p.description,
      address: p.address,
      city: p.city,
      state: p.state,
      zipCode: p.zipCode,
      phone: p.phone,
      email: p.email,
      amenities: p.amenities,
      primaryColor: p.primaryColor,
      logoUrl: p.logoUrl,
      isDemo: p.isDemo,
      currency: p.currency,
      /** Taxes and fees added to every stay (shown before checkout). */
      charges: p.charges.map((c) => ({ name: c.name, kind: c.kind, rate: Number(c.amount) })),
      voice: { available: voiceAvailable() && (p.voiceAgent?.enabled ?? true) && (p.voiceAgent?.guestWidget ?? true) },
      photos: p.photos,
      roomTypes: p.roomTypes.map((rt) => ({
        id: rt.id,
        name: rt.name,
        description: rt.description,
        capacity: rt.capacity,
        basePrice: Number(rt.basePrice),
        amenities: rt.amenities,
        photos: rt.photos,
      })),
    },
    { headers: { 'Cache-Control': 'no-store' } }
  );
});
