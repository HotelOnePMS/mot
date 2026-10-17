import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

/**
 * GET /api/owner/properties — properties the signed-in user is assigned to
 * (ADMIN sees all). Used by the owner dashboard and the agent panel.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ message: 'Sign in required' }, { status: 401 });
  }

  const role = (session.user as { role?: string }).role;
  const isAdmin = role === 'ADMIN';

  const properties = await prisma.property.findMany({
    where: isAdmin
      ? {}
      : { assignedUsers: { some: { userId: session.user.id } } },
    select: {
      id: true,
      name: true,
      city: true,
      state: true,
      tagline: true,
      primaryColor: true,
      type: true,
      isActive: true,
      isDemo: true,
      interfaceMode: true,
      _count: { select: { bookings: true, roomTypes: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  return NextResponse.json({ properties });
}
