import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { staffGuard } from '@/server/guard';

// GET /api/admin/properties/[propertyId]/room-types
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ propertyId: string }> }
) {
  try {
    const guard = await staffGuard('rates.view', { propertyId: (await params).propertyId });
    if ('error' in guard) return guard.error;
    
    const { propertyId } = await params;
    
    // Get all room types for the property
    const roomTypes = await prisma.roomType.findMany({
      where: {
        propertyId,
        isActive: true,
      },
      select: {
        id: true,
        name: true,
        basePrice: true,
        propertyId: true,
      },
      orderBy: {
        name: 'asc',
      },
    });
    
    return NextResponse.json(roomTypes);
  } catch (error) {
    console.error('Error fetching room types:', error);
    return NextResponse.json(
      { error: 'Failed to fetch room types' },
      { status: 500 }
    );
  }
}
