import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { LISTED_PROPERTY } from '@/server/concierge/facts';

export async function GET() {
  try {
    // Get all active properties for dropdown selection
    const properties = await prisma.property.findMany({
      where: LISTED_PROPERTY,
      select: {
        id: true,
        name: true,
        city: true,
        state: true,
      },
      orderBy: {
        name: 'asc'
      }
    });
    
    return NextResponse.json(properties);
  } catch (error) {
    console.error('Error fetching properties:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
