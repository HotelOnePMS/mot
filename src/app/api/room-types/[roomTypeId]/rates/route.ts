import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { isISODate } from '@/server/dates';
import { badRequest, notFound } from '@/server/errors';
import { handleRoute, json, parseQuery } from '@/server/http';
import { nightlyRates } from '@/server/services/inventory';

type Params = { params: Promise<{ roomTypeId: string }> };

const query = z.object({
  checkIn: z.string().refine(isISODate, 'must be YYYY-MM-DD'),
  checkOut: z.string().refine(isISODate, 'must be YYYY-MM-DD'),
});

/** GET — public nightly prices for a stay (see also /api/quote for totals). */
export const GET = handleRoute(async (request: NextRequest, { params }: Params) => {
  const { roomTypeId } = await params;
  const q = parseQuery(request, query);
  if (q.checkOut <= q.checkIn) throw badRequest('Check-out must be after check-in.');
  const roomType = await prisma.roomType.findFirst({
    where: { id: roomTypeId, isActive: true },
    select: { id: true, name: true, basePrice: true },
  });
  if (!roomType) throw notFound('Room type');
  const nights = await nightlyRates(prisma, roomTypeId, q.checkIn, q.checkOut);
  return json(
    {
      roomTypeId: roomType.id,
      roomTypeName: roomType.name,
      basePrice: Number(roomType.basePrice),
      checkIn: q.checkIn,
      checkOut: q.checkOut,
      dailyRates: nights.map((n) => ({ date: n.date, price: n.price, isCustomRate: n.isCustom })),
    },
    { headers: { 'Cache-Control': 'no-store' } }
  );
});
