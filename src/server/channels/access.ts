/**
 * Property scoping for the channel manager. Channel services take ids; every
 * route and every channel-agent tool checks them here first, so an owner or
 * manager only ever reaches the connections, promotions and room types of
 * the properties assigned to them.
 */
import { prisma } from '@/lib/prisma';
import { assertPropertyAccess, requireStaff, scopeByProperty, scopeProperties, type Actor, type Permission } from '../authz';
import { assertNotDemoHotel } from '../demo';
import { notFound } from '../errors';

export { scopeByProperty, scopeProperties };

export async function assertConnectionAccess(actor: Actor, connectionIds: string | string[]): Promise<void> {
  const ids = Array.from(new Set(Array.isArray(connectionIds) ? connectionIds : [connectionIds]));
  if (ids.length === 0) return;
  const rows = await prisma.channelConnection.findMany({ where: { id: { in: ids } }, select: { id: true, propertyId: true } });
  for (const id of ids) {
    const row = rows.find((r) => r.id === id);
    if (!row) throw notFound('Channel connection');
    assertPropertyAccess(actor, row.propertyId);
  }
}

export async function assertRoomTypeAccess(actor: Actor, roomTypeIds: string[]): Promise<void> {
  const ids = Array.from(new Set(roomTypeIds));
  if (ids.length === 0) return;
  const rows = await prisma.roomType.findMany({ where: { id: { in: ids } }, select: { id: true, propertyId: true } });
  for (const id of ids) {
    const row = rows.find((r) => r.id === id);
    if (!row) throw notFound('Room type');
    assertPropertyAccess(actor, row.propertyId);
  }
}

export async function assertPromotionAccess(actor: Actor, promotionId: string): Promise<void> {
  const row = await prisma.channelPromotion.findUnique({
    where: { id: promotionId },
    select: { connection: { select: { propertyId: true } } },
  });
  if (!row) throw notFound('Promotion');
  assertPropertyAccess(actor, row.connection.propertyId);
}

/** Connection ids the actor can see that are syncing (for "every active connection"). */
export async function activeConnectionIds(actor: Actor): Promise<string[]> {
  const rows = await prisma.channelConnection.findMany({
    where: { status: { in: ['ACTIVE', 'ERROR'] }, ...scopeByProperty(actor) },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

/** Everything a rate change touches: its connections, its property and its room types. */
export async function assertRateChangeAccess(
  actor: Actor,
  request: { connectionIds: string[]; propertyId?: string | null; roomTypeIds: string[] }
): Promise<void> {
  await assertConnectionAccess(actor, request.connectionIds);
  if (request.propertyId) assertPropertyAccess(actor, request.propertyId);
  await assertRoomTypeAccess(actor, request.roomTypeIds);
}

/** Route guard: a staff member holding `perm` who may reach this connection's property. */
export async function connectionActor(perm: Permission, connectionId: string): Promise<Actor> {
  const actor = await requireStaff(perm);
  await assertConnectionAccess(actor, connectionId);
  return actor;
}

/** Shared demo hotels stay in sandbox: a visitor must not point one at a real OTA account. */
export async function assertLiveAllowed(actor: Actor, propertyId: string): Promise<void> {
  const property = await prisma.property.findUnique({ where: { id: propertyId }, select: { isDemo: true } });
  if (!property) throw notFound('Property');
  assertNotDemoHotel(actor, property.isDemo, 'Demo hotels can only connect to the OTA sandbox. Set up your own hotel to connect a live Expedia or Booking.com account.');
}
