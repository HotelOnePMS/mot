import { randomUUID } from 'node:crypto';
import type { ChargeKind, UserRole } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { actorFromUser, type Actor } from '@/server/authz';
import { hotelToday } from '@/server/dates';

export const uid = () => randomUUID().slice(0, 8);

export async function makeHotel(opts: { timezone?: string | null; currency?: string; rooms?: number; basePrice?: number; charges?: { name: string; kind: ChargeKind; amount: number }[] } = {}) {
  const property = await prisma.property.create({
    data: {
      name: `Test Hotel ${uid()}`,
      address: '1 Harbor Way',
      city: 'Santa Cruz',
      state: 'CA',
      zipCode: '95060',
      phone: '+1 831 555 0100',
      amenities: [],
      timezone: opts.timezone ?? null,
      currency: opts.currency ?? 'USD',
      charges: opts.charges ? { create: opts.charges.map((c, i) => ({ ...c, sortOrder: i })) } : undefined,
    },
  });
  const count = opts.rooms ?? 2;
  const roomType = await prisma.roomType.create({
    data: { propertyId: property.id, name: 'Queen', capacity: 2, basePrice: opts.basePrice ?? 100, totalRooms: count, amenities: [] },
  });
  const rooms = [];
  for (let i = 0; i < count; i++) {
    rooms.push(await prisma.room.create({ data: { propertyId: property.id, roomTypeId: roomType.id, roomNumber: String(101 + i), floor: '1', status: 'CLEAN' } }));
  }
  return { property, roomType, rooms, today: hotelToday(new Date(), property.timezone ?? process.env.HOTEL_TIMEZONE) };
}

export async function makeUser(opts: { role?: UserRole; propertyIds?: string[]; email?: string; password?: string } = {}) {
  const bcrypt = await import('bcryptjs');
  return prisma.user.create({
    data: {
      email: opts.email ?? `user-${uid()}@example.com`,
      password: opts.password ? await bcrypt.hash(opts.password, 4) : '',
      firstName: 'Test',
      lastName: `User${uid()}`,
      role: opts.role ?? 'OWNER',
      assignedProperties: opts.propertyIds ? { create: opts.propertyIds.map((propertyId) => ({ propertyId })) } : undefined,
    },
  });
}

/** The Actor getActor would build for this user (password session). */
export async function actorFor(userId: string): Promise<Actor> {
  const u = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    include: { assignedProperties: { select: { propertyId: true } }, organizations: { select: { role: true, organizationId: true, organization: { select: { requireMfa: true, properties: { select: { id: true } } } } } } },
  });
  return actorFromUser(u, 'password');
}
