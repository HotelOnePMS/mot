/**
 * Shared checks for the PMS console routes: property access, the public-demo
 * lock (a demo visitor must not point a shared demo hotel at an arbitrary
 * URL or read its secrets) and a small per-user rate limit on outbound tests.
 */
import { prisma } from '@/lib/prisma';
import { resolvePropertyId, type Actor } from '../authz';
import { assertNotDemoHotel } from '../demo';
import { DomainError, notFound } from '../errors';
import { floodGuard } from './events';

export async function pmsProperty(actor: Actor, requested: string | null | undefined, opts: { demoLock?: string } = {}) {
  const propertyId = await resolvePropertyId(actor, requested);
  const property = await prisma.property.findUnique({ where: { id: propertyId }, select: { id: true, name: true, isDemo: true } });
  if (!property) throw notFound('Property');
  if (opts.demoLock) assertNotDemoHotel(actor, property.isDemo, opts.demoLock);
  return property;
}

export const DEMO_LOCK_MESSAGE = 'Demo hotels can’t be connected to an outside PMS. Set up your own hotel to connect yours.';

/** Outbound connection attempts (connect / test / refresh) per user: 12 a minute. */
export function limitOutbound(actor: Actor): void {
  if (!floodGuard(`pms-outbound:${actor.userId}`, 12, 60_000)) {
    throw new DomainError(429, 'RATE_LIMITED', 'That’s a lot of connection attempts — wait a minute and try again.');
  }
}
