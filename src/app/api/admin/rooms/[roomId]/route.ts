import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { assertPropertyAccess, can, requireStaff } from '@/server/authz';
import { badRequest, forbidden, notFound } from '@/server/errors';
import { handleRoute, json, parseJson } from '@/server/http';
import { recordAudit } from '@/server/services/audit';
import { setOutOfOrder, setRoomStatus } from '@/server/services/rooms';

type Params = { params: Promise<{ roomId: string }> };

async function loadScoped(roomId: string, perm: Parameters<typeof requireStaff>[0]) {
  const actor = await requireStaff(perm);
  const room = await prisma.room.findUnique({ where: { id: roomId } });
  if (!room) throw notFound('Room');
  assertPropertyAccess(actor, room.propertyId);
  return { actor, room };
}

export const GET = handleRoute(async (_req: NextRequest, { params }: Params) => {
  const { roomId } = await params;
  await loadScoped(roomId, 'room.view');
  const room = await prisma.room.findUnique({
    where: { id: roomId },
    include: { roomType: true, property: { select: { id: true, name: true } }, housekeeping: { orderBy: { createdAt: 'desc' }, take: 5 } },
  });
  return json(room);
});

const patchSchema = z.object({
  status: z.enum(['CLEAN', 'DIRTY', 'INSPECTED', 'OUT_OF_ORDER']).optional(),
  isOutOfOrder: z.boolean().optional(),
  outOfOrderReason: z.string().max(300).nullable().optional(),
  floor: z.string().max(20).nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(24)).max(12).optional(),
  roomNumber: z.string().trim().min(1).max(20).optional(),
});

/**
 * PATCH — housekeeping status, out-of-order, or room details. Status and
 * out-of-order changes go through the room service (audited, guarded).
 */
export const PATCH = handleRoute(async (request: NextRequest, { params }: Params) => {
  const { roomId } = await params;
  const { actor, room } = await loadScoped(roomId, 'room.view');
  const body = await parseJson(request, patchSchema);
  const ctx = { actor, source: 'classic' as const };

  if (body.isOutOfOrder !== undefined || body.status === 'OUT_OF_ORDER') {
    const ooo = body.isOutOfOrder ?? true;
    await setOutOfOrder(ctx, room.id, ooo, body.outOfOrderReason ?? undefined);
  } else if (body.status) {
    await setRoomStatus(ctx, room.id, body.status as 'CLEAN' | 'DIRTY' | 'INSPECTED');
  }

  const details = { floor: body.floor, notes: body.notes, tags: body.tags, roomNumber: body.roomNumber };
  if (Object.values(details).some((v) => v !== undefined)) {
    if (!can(actor, 'room.manage')) throw forbidden('Only managers can edit room details.');
    if (body.roomNumber && body.roomNumber !== room.roomNumber) {
      const clash = await prisma.room.findUnique({
        where: { propertyId_roomNumber: { propertyId: room.propertyId, roomNumber: body.roomNumber } },
      });
      if (clash) throw badRequest(`Room ${body.roomNumber} already exists.`);
    }
    await prisma.room.update({
      where: { id: room.id },
      data: {
        ...(body.floor !== undefined ? { floor: body.floor || null } : {}),
        ...(body.notes !== undefined ? { notes: body.notes || null } : {}),
        ...(body.tags !== undefined ? { tags: body.tags.map((t) => t.toLowerCase()) } : {}),
        ...(body.roomNumber !== undefined ? { roomNumber: body.roomNumber } : {}),
      },
    });
    await recordAudit(ctx, room.propertyId, 'ROOM_UPDATE', `Updated details for room ${body.roomNumber ?? room.roomNumber}`, { roomId: room.id });
  }

  const updated = await prisma.room.findUnique({ where: { id: room.id }, include: { roomType: { select: { id: true, name: true } } } });
  return json(updated);
});

export const DELETE = handleRoute(async (_req: NextRequest, { params }: Params) => {
  const { roomId } = await params;
  const { actor, room } = await loadScoped(roomId, 'room.manage');
  const active = await prisma.booking.findFirst({ where: { roomId, status: { in: ['CONFIRMED', 'CHECKED_IN', 'PENDING'] } }, select: { id: true } });
  if (active) throw badRequest(`Room ${room.roomNumber} has upcoming or in-house guests assigned. Move them first.`);
  await prisma.room.delete({ where: { id: roomId } });
  await recordAudit({ actor, source: 'classic' }, room.propertyId, 'ROOM_DELETE', `Removed room ${room.roomNumber}`, { roomId });
  return json({ message: 'Room deleted successfully' });
});
