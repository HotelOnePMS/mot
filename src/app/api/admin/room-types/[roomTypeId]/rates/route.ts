import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { assertPropertyAccess, requireStaff } from '@/server/authz';
import { addDaysISO, dayOfWeek, diffDays, eachNight, isISODate } from '@/server/dates';
import { badRequest, notFound } from '@/server/errors';
import { handleRoute, json, parseJson, parseQuery } from '@/server/http';
import { recordAudit } from '@/server/services/audit';
import { nightlyInventory, nightlyRates } from '@/server/services/inventory';

type Params = { params: Promise<{ roomTypeId: string }> };

async function loadRoomType(roomTypeId: string, perm: 'rates.view' | 'rates.write') {
  const actor = await requireStaff(perm);
  const roomType = await prisma.roomType.findUnique({
    where: { id: roomTypeId },
    select: { id: true, name: true, basePrice: true, totalRooms: true, propertyId: true },
  });
  if (!roomType) throw notFound('Room type');
  assertPropertyAccess(actor, roomType.propertyId);
  return { actor, roomType };
}

const getQuery = z.object({
  startDate: z.string().refine(isISODate, 'must be YYYY-MM-DD'),
  endDate: z.string().refine(isISODate, 'must be YYYY-MM-DD'),
});

/**
 * GET ?startDate&endDate (inclusive) — every night with its price (custom
 * or base) and how many rooms are sold, for the rate calendar.
 */
export const GET = handleRoute(async (request: NextRequest, { params }: Params) => {
  const { roomTypeId } = await params;
  const { roomType } = await loadRoomType(roomTypeId, 'rates.view');
  const q = parseQuery(request, getQuery);
  const endExclusive = addDaysISO(q.endDate, 1);
  if (endExclusive <= q.startDate) throw badRequest('endDate must not be before startDate.');
  if (diffDays(q.startDate, endExclusive) > 400) throw badRequest('Ranges are limited to about 13 months.');
  const [rates, inventory] = await Promise.all([
    nightlyRates(prisma, roomTypeId, q.startDate, endExclusive),
    nightlyInventory(prisma, roomTypeId, q.startDate, endExclusive),
  ]);
  return json({
    roomType: { id: roomType.id, name: roomType.name, basePrice: Number(roomType.basePrice), totalRooms: roomType.totalRooms },
    days: rates.map((r) => ({ ...r, sold: inventory.soldByNight[r.date] ?? 0, total: inventory.total })),
  });
});

const priceSchema = z.coerce.number().min(0).max(100000);

const postSchema = z.union([
  // Explicit per-night prices.
  z.object({ rates: z.array(z.object({ date: z.string().refine(isISODate), price: priceSchema })).min(1).max(800) }),
  // Bulk: a range, optionally limited to weekdays, setting or adjusting price.
  z
    .object({
      startDate: z.string().refine(isISODate),
      endDate: z.string().refine(isISODate),
      daysOfWeek: z.array(z.number().int().min(0).max(6)).optional(),
      price: priceSchema.optional(),
      adjustPercent: z.number().min(-90).max(500).optional(),
      reset: z.boolean().optional(),
    })
    .refine((b) => [b.price !== undefined, b.adjustPercent !== undefined, !!b.reset].filter(Boolean).length === 1, {
      message: 'Provide exactly one of price, adjustPercent or reset',
    }),
]);

/** POST — save prices (per night or bulk). Base price is used where no custom rate exists. */
export const POST = handleRoute(async (request: NextRequest, { params }: Params) => {
  const { roomTypeId } = await params;
  const { actor, roomType } = await loadRoomType(roomTypeId, 'rates.write');
  const body = await parseJson(request, postSchema);
  const ctx = { actor, source: 'classic' as const };

  if ('rates' in body) {
    const unique = new Map(body.rates.map((r) => [r.date, r.price]));
    await prisma.$transaction(
      [...unique].map(([date, price]) =>
        prisma.roomTypeRate.upsert({
          where: { roomTypeId_date: { roomTypeId, date: new Date(`${date}T00:00:00Z`) } },
          create: { roomTypeId, date: new Date(`${date}T00:00:00Z`), price },
          update: { price },
        })
      )
    );
    await recordAudit(ctx, roomType.propertyId, 'RATES_UPDATE', `Updated ${unique.size} night${unique.size > 1 ? 's' : ''} of ${roomType.name} rates`, { roomTypeId });
    return json({ success: true, count: unique.size });
  }

  const endExclusive = addDaysISO(body.endDate, 1);
  if (endExclusive <= body.startDate) throw badRequest('endDate must not be before startDate.');
  if (diffDays(body.startDate, endExclusive) > 400) throw badRequest('Ranges are limited to about 13 months.');
  const nights = eachNight(body.startDate, endExclusive).filter((d) => !body.daysOfWeek?.length || body.daysOfWeek.includes(dayOfWeek(d)));
  if (nights.length === 0) throw badRequest('No nights match those days of the week.');

  if (body.reset) {
    const { count } = await prisma.roomTypeRate.deleteMany({
      where: { roomTypeId, date: { in: nights.map((d) => new Date(`${d}T00:00:00Z`)) } },
    });
    await recordAudit(ctx, roomType.propertyId, 'RATES_RESET', `Reset ${count} night${count === 1 ? '' : 's'} of ${roomType.name} to the base price`, { roomTypeId });
    return json({ success: true, count });
  }

  const current = await nightlyRates(prisma, roomTypeId, body.startDate, endExclusive);
  const byDay = new Map(current.map((c) => [c.date, c.price]));
  const updates = nights.map((date) => {
    const price =
      body.price !== undefined
        ? body.price
        : Math.max(0, Math.round((byDay.get(date) ?? Number(roomType.basePrice)) * (1 + (body.adjustPercent ?? 0) / 100) * 100) / 100);
    return { date, price };
  });
  await prisma.$transaction(
    updates.map(({ date, price }) =>
      prisma.roomTypeRate.upsert({
        where: { roomTypeId_date: { roomTypeId, date: new Date(`${date}T00:00:00Z`) } },
        create: { roomTypeId, date: new Date(`${date}T00:00:00Z`), price },
        update: { price },
      })
    )
  );
  const how = body.price !== undefined ? `set to $${body.price}` : `adjusted ${(body.adjustPercent ?? 0) > 0 ? '+' : ''}${body.adjustPercent}%`;
  await recordAudit(ctx, roomType.propertyId, 'RATES_UPDATE', `${roomType.name}: ${updates.length} night${updates.length > 1 ? 's' : ''} ${how}`, { roomTypeId });
  return json({ success: true, count: updates.length });
});
