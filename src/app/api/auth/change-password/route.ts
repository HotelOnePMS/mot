import { NextRequest } from 'next/server';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { badRequest, unauthorized } from '@/server/errors';
import { clientIp, handleRoute, json, parseJson } from '@/server/http';
import { consumeRateLimit } from '@/server/concierge/rateLimit';
import { recordTeamAudit } from '@/server/services/team-audit';

export const dynamic = 'force-dynamic';

const schema = z.object({
  currentPassword: z.string().min(1).max(200),
  password: z.string().min(8, 'must be at least 8 characters').max(200),
});

/**
 * POST /api/auth/change-password — a signed-in person replaces their own password.
 * Required first thing for people whose password someone else chose (mustChangePassword).
 * Ends all other sessions (sessionVersion), so the caller signs in again with the new password.
 */
export const POST = handleRoute(async (request: NextRequest) => {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) throw unauthorized();
  await consumeRateLimit(`pwchange:${userId}:${clientIp(request)}`, 10, 3_600_000, 'Too many attempts. Please try again later.');
  const body = await parseJson(request, schema);
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, password: true, isActive: true, role: true, firstName: true, lastName: true, assignedProperties: { select: { propertyId: true } } },
  });
  if (!user || !user.isActive || !user.password) throw unauthorized();
  if (!(await bcrypt.compare(body.currentPassword, user.password))) throw badRequest('Your current password is not right.');
  if (body.currentPassword === body.password) throw badRequest('Choose a password you are not using already.');
  await prisma.user.update({
    where: { id: userId },
    data: { password: await bcrypt.hash(body.password, 12), mustChangePassword: false, sessionVersion: { increment: 1 } },
  });
  if (user.role !== 'CUSTOMER') {
    await recordTeamAudit(
      { actorUserId: userId, source: 'system', targetUserId: userId, propertyIds: user.assignedProperties.map((a) => a.propertyId) },
      [{ action: 'TEAM_PASSWORD_RESET', summary: `${`${user.firstName} ${user.lastName}`.trim() || user.email}: changed their own password`, before: {}, after: { passwordChanged: true } }],
    );
  }
  return json({ message: 'Password updated.', email: user.email });
});
