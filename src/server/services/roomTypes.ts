/**
 * Changing a room type (its name, description, capacity, base price, room count, amenities, whether it is for sale),
 * from the Room types page or a plan confirmed in the agent. The activity log says what changed, before and after.
 */
import { prisma } from '@/lib/prisma';
import { money } from '@/lib/status';
import { assertPropertyAccess, requirePermission } from '../authz';
import { badRequest, notFound } from '../errors';
import { schedulePropertySync } from '../channels/sync';
import { scheduleConfigSkillSync } from '../skills/config';
import { recordAudit, type OpContext } from './audit';

export interface RoomTypeUpdate {
  name?: string;
  description?: string | null;
  capacity?: number;
  basePrice?: number;
  totalRooms?: number;
  amenities?: string[];
  isActive?: boolean;
}

const FIELDS = ['name', 'description', 'capacity', 'basePrice', 'totalRooms', 'amenities', 'isActive'] as const;

export async function updateRoomType(op: OpContext, roomTypeId: string, body: RoomTypeUpdate) {
  requirePermission(op.actor, 'inventory.write');
  const before = await prisma.roomType.findUnique({
    where: { id: roomTypeId },
    select: { id: true, propertyId: true, name: true, description: true, capacity: true, basePrice: true, totalRooms: true, amenities: true, isActive: true, property: { select: { currency: true } } },
  });
  if (!before) throw notFound('Room type');
  assertPropertyAccess(op.actor, before.propertyId);
  if (body.totalRooms !== undefined) {
    const physical = await prisma.room.count({ where: { roomTypeId } });
    if (body.totalRooms < physical) throw badRequest(`There are ${physical} room numbers set up for this type. Remove some before lowering the count.`);
  }
  const updated = await prisma.roomType.update({
    where: { id: roomTypeId },
    data: { ...body, description: body.description === undefined ? undefined : body.description || null },
    include: { property: { select: { id: true, name: true } } },
  });

  const was: Record<string, unknown> = { ...before, basePrice: Number(before.basePrice) };
  const now: Record<string, unknown> = { ...updated, basePrice: Number(updated.basePrice) };
  const changed = FIELDS.filter((f) => body[f] !== undefined && JSON.stringify(was[f]) !== JSON.stringify(now[f]));
  const currency = before.property.currency;
  const words: Record<(typeof FIELDS)[number], () => string> = {
    name: () => `renamed from “${before.name}”`,
    description: () => 'description',
    capacity: () => `sleeps ${updated.capacity} (was ${before.capacity})`,
    basePrice: () => `base price ${money(Number(updated.basePrice), { cents: true, currency })} (was ${money(Number(before.basePrice), { cents: true, currency })})`,
    totalRooms: () => `${updated.totalRooms} rooms (was ${before.totalRooms})`,
    amenities: () => 'amenities',
    isActive: () => (updated.isActive ? 'back on sale' : 'taken off sale'),
  };
  await recordAudit(op, before.propertyId, 'ROOM_TYPE_UPDATE', `Updated room type ${updated.name}${changed.length ? `: ${changed.map((f) => words[f]()).join(', ')}` : ''}`, {
    roomTypeId,
    before: Object.fromEntries(changed.map((f) => [f, was[f]])),
    after: Object.fromEntries(changed.map((f) => [f, now[f]])),
  });
  scheduleConfigSkillSync(before.propertyId);
  // Room count and base price feed what OTAs are sent.
  if (changed.includes('totalRooms') || changed.includes('basePrice')) schedulePropertySync(before.propertyId);
  return updated;
}
