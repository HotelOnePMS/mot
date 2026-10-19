/**
 * Each hotel's clock and currency. A hotel's "today", its policy cut-offs
 * and its prices follow Property.timezone and Property.currency; hotels that
 * never chose a time zone use the platform default (HOTEL_TIMEZONE).
 *
 * Looked up on almost every request, so they are cached briefly per server
 * instance; settings changes call `forgetHotelLocale`.
 */
import type { ChargeKind } from '@prisma/client';
import type { ISODate } from '@/lib/dto';
import { currencyOrDefault, isCurrencyCode } from '@/lib/currency';
import { prisma } from '@/lib/prisma';
import { assertPropertyAccess, requirePermission, type Actor } from '../authz';
import { HOTEL_TIMEZONE, hotelToday, isTimeZone } from '../dates';
import { assertDemoHotelUnchanged } from '../demo';
import { badRequest, notFound } from '../errors';
import { recordAudit, type OpContext } from './audit';

export interface HotelLocale {
  timezone: string;
  currency: string;
}

/** The locale stored on a property row (`timezone` null = platform default). */
export function localeOf(p: { timezone?: string | null; currency?: string | null }): HotelLocale {
  return { timezone: p.timezone && isTimeZone(p.timezone) ? p.timezone : HOTEL_TIMEZONE, currency: currencyOrDefault(p.currency) };
}

const TTL_MS = 30_000;
const cache = new Map<string, { at: number; value: HotelLocale }>();

export async function hotelLocale(propertyId: string): Promise<HotelLocale> {
  const hit = cache.get(propertyId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const p = await prisma.property.findUnique({ where: { id: propertyId }, select: { timezone: true, currency: true } });
  if (!p) throw notFound('Property');
  const value = localeOf(p);
  cache.set(propertyId, { at: Date.now(), value });
  if (cache.size > 5000) cache.delete(cache.keys().next().value!);
  return value;
}

export function forgetHotelLocale(propertyId: string): void {
  cache.delete(propertyId);
}

/** Today's date at this hotel. */
export async function todayAt(propertyId: string, now: Date = new Date()): Promise<ISODate> {
  return hotelToday(now, (await hotelLocale(propertyId)).timezone);
}

// ---------------------------------------------------------------------------
// Settings: time zone, currency, taxes and fees
// ---------------------------------------------------------------------------

export interface ChargeSetting {
  name: string;
  kind: ChargeKind;
  /** A percentage for PERCENT, otherwise an amount in the hotel's currency. */
  amount: number;
  isActive: boolean;
}

export interface PricingSettings {
  /** The hotel's own time zone, or null when it follows the platform default. */
  timezone: string | null;
  platformTimezone: string;
  currency: string;
  charges: ChargeSetting[];
  /** Upcoming bookings keep the currency they were made in. */
  upcomingBookings: number;
}

export async function getPricingSettings(actor: Actor, propertyId: string): Promise<PricingSettings> {
  requirePermission(actor, 'charges.manage');
  assertPropertyAccess(actor, propertyId);
  const p = await prisma.property.findUnique({
    where: { id: propertyId },
    select: {
      timezone: true,
      currency: true,
      charges: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }], select: { name: true, kind: true, amount: true, isActive: true } },
    },
  });
  if (!p) throw notFound('Property');
  const upcomingBookings = await prisma.booking.count({ where: { propertyId, status: { in: ['PENDING', 'CONFIRMED', 'CHECKED_IN'] } } });
  return {
    timezone: p.timezone,
    platformTimezone: HOTEL_TIMEZONE,
    currency: currencyOrDefault(p.currency),
    charges: p.charges.map((c) => ({ name: c.name, kind: c.kind, amount: Number(c.amount), isActive: c.isActive })),
    upcomingBookings,
  };
}

export async function updatePricingSettings(
  ctx: OpContext,
  propertyId: string,
  input: { timezone: string | null; currency: string; charges: ChargeSetting[] },
): Promise<PricingSettings> {
  requirePermission(ctx.actor, 'charges.manage');
  assertPropertyAccess(ctx.actor, propertyId);
  const current = await prisma.property.findUnique({ where: { id: propertyId }, select: { isDemo: true, timezone: true, currency: true } });
  if (!current) throw notFound('Property');
  assertDemoHotelUnchanged(ctx.actor, { ...current, charges: 'seeded' }, { timezone: input.timezone, currency: input.currency, charges: 'changed' }, ['currency', 'timezone', 'charges']);
  if (input.timezone !== null && !isTimeZone(input.timezone)) throw badRequest('Choose a time zone from the list.');
  if (!isCurrencyCode(input.currency)) throw badRequest('Choose a currency from the list.');
  const names = new Set<string>();
  for (const c of input.charges) {
    const key = c.name.trim().toLowerCase();
    if (names.has(key)) throw badRequest(`“${c.name.trim()}” is listed twice.`);
    names.add(key);
    if (c.kind === 'PERCENT' && c.amount > 100) throw badRequest(`${c.name.trim()}: a percentage can be at most 100.`);
  }
  await prisma.$transaction([
    prisma.property.update({ where: { id: propertyId }, data: { timezone: input.timezone, currency: input.currency } }),
    prisma.propertyCharge.deleteMany({ where: { propertyId } }),
    prisma.propertyCharge.createMany({
      data: input.charges.map((c, i) => ({ propertyId, name: c.name.trim(), kind: c.kind, amount: c.amount, isActive: c.isActive, sortOrder: i })),
    }),
  ]);
  forgetHotelLocale(propertyId);
  const active = input.charges.filter((c) => c.isActive).length;
  await recordAudit(ctx, propertyId, 'PRICING_SETTINGS', `Prices in ${input.currency}, clock ${input.timezone ?? `${HOTEL_TIMEZONE} (platform default)`}, ${active} active tax${active === 1 ? '' : 'es'} or fee${active === 1 ? '' : 's'}`, {
    currency: input.currency,
    timezone: input.timezone,
    charges: input.charges,
  });
  return getPricingSettings(ctx.actor, propertyId);
}
