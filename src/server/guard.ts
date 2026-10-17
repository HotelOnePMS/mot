/**
 * Guard for legacy-style route handlers (try/catch returning NextResponse):
 * resolves the staff actor, checks a permission and property scope, and
 * either returns `{ actor }` or `{ error: Response }` to return directly.
 */
import { prisma } from '@/lib/prisma';
import { assertPropertyAccess, requireStaff, type Actor, type Permission } from './authz';
import { notFound } from './errors';
import { errorResponse } from './http';

export async function staffGuard(
  perm: Permission | null,
  scope: { propertyId?: string | null; roomTypeId?: string | null } = {}
): Promise<{ actor: Actor; propertyId: string | null } | { error: Response }> {
  try {
    const actor = await requireStaff(perm ?? undefined);
    let propertyId = scope.propertyId ?? null;
    if (!propertyId && scope.roomTypeId) {
      const rt = await prisma.roomType.findUnique({ where: { id: scope.roomTypeId }, select: { propertyId: true } });
      if (!rt) throw notFound('Room type');
      propertyId = rt.propertyId;
    }
    if (propertyId) assertPropertyAccess(actor, propertyId);
    return { actor, propertyId };
  } catch (e) {
    return { error: errorResponse(e) };
  }
}
