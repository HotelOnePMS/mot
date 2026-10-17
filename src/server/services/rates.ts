/**
 * Rate calendar writes: bulk set / adjust / reset over a date range.
 * Only exceptions to the base price are stored.
 */
import { prisma } from '@/lib/prisma';
import type { ISODate } from '@/lib/dto';
import { assertPropertyAccess, requirePermission } from '../authz';
import { addDaysISO, dayOfWeek, diffDays, eachNight, formatDay } from '../dates';
import { badRequest, notFound } from '../errors';
import { recordAudit, type OpContext } from './audit';
import { nightlyRates } from './inventory';

export type RateChange = { price: number } | { adjustPercent: number } | { reset: true };

export async function changeRates(
  ctx: OpContext,
  roomTypeId: string,
  startDate: ISODate,
  endDateInclusive: ISODate,
  change: RateChange,
  daysOfWeek?: number[]
): Promise<{ count: number; summary: string }> {
  requirePermission(ctx.actor, 'rates.write');
  const roomType = await prisma.roomType.findUnique({
    where: { id: roomTypeId },
    select: { id: true, name: true, basePrice: true, propertyId: true },
  });
  if (!roomType) throw notFound('Room type');
  assertPropertyAccess(ctx.actor, roomType.propertyId);

  const endExclusive = addDaysISO(endDateInclusive, 1);
  if (endExclusive <= startDate) throw badRequest('End date must not be before start date.');
  if (diffDays(startDate, endExclusive) > 400) throw badRequest('Ranges are limited to about 13 months.');
  const nights = eachNight(startDate, endExclusive).filter((d) => !daysOfWeek?.length || daysOfWeek.includes(dayOfWeek(d)));
  if (!nights.length) throw badRequest('No nights match those days of the week.');
  const range = nights.length === 1 ? formatDay(nights[0]) : `${formatDay(nights[0])}–${formatDay(nights[nights.length - 1])}`;

  if ('reset' in change) {
    const { count } = await prisma.roomTypeRate.deleteMany({
      where: { roomTypeId, date: { in: nights.map((d) => new Date(`${d}T00:00:00Z`)) } },
    });
    const summary = `${roomType.name} ${range}: reset to base price`;
    await recordAudit(ctx, roomType.propertyId, 'RATES_RESET', summary, { roomTypeId });
    return { count, summary };
  }

  const current = new Map((await nightlyRates(prisma, roomTypeId, nights[0], addDaysISO(nights[nights.length - 1], 1))).map((r) => [r.date, r.price]));
  const updates = nights.map((date) => ({
    date,
    price:
      'price' in change
        ? change.price
        : Math.max(0, Math.round((current.get(date) ?? Number(roomType.basePrice)) * (1 + change.adjustPercent / 100))),
  }));
  await prisma.$transaction(
    updates.map(({ date, price }) =>
      prisma.roomTypeRate.upsert({
        where: { roomTypeId_date: { roomTypeId, date: new Date(`${date}T00:00:00Z`) } },
        create: { roomTypeId, date: new Date(`${date}T00:00:00Z`), price },
        update: { price },
      })
    )
  );
  const how = 'price' in change ? `set to $${change.price}` : `${change.adjustPercent > 0 ? '+' : ''}${change.adjustPercent}%`;
  const summary = `${roomType.name} ${range}: ${how}`;
  await recordAudit(ctx, roomType.propertyId, 'RATES_UPDATE', summary, { roomTypeId, nights: updates.length });
  return { count: updates.length, summary };
}
