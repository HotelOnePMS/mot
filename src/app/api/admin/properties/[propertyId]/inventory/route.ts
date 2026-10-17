import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { staffGuard } from '@/server/guard';

// GET room inventory for a property
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ propertyId: string }> }
) {
  try {
    const guard = await staffGuard('inventory.write', { propertyId: (await params).propertyId });
    if ('error' in guard) return guard.error;
    const propertyId = (await params).propertyId;
    
    if (!propertyId) {
      return NextResponse.json(
        { error: 'Property ID is required' },
        { status: 400 }
      );
    }

    // Get all room types for this property
    const roomTypes = await prisma.roomType.findMany({
      where: {
        propertyId,
        isActive: true
      },
      include: {
        rooms: true,
        bookings: {
          where: {
            // Only include active bookings
            status: {
              in: ['CONFIRMED', 'PENDING']
            },
            // Only current and future bookings
            checkOut: {
              gte: new Date()
            }
          }
        }
      }
    });

    // Calculate availability for each room type
    const inventoryWithAvailability = roomTypes.map((roomType: any) => {
      // Get total rooms for this type
      const totalInventory = roomType.rooms.length;
      
      // Count booked rooms for current date
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      const bookedToday = roomType.bookings.filter((booking: any) => {
        const checkIn = new Date(booking.checkIn);
        const checkOut = new Date(booking.checkOut);
        return today >= checkIn && today < checkOut;
      }).length;
      
      const availableToday = totalInventory - bookedToday;

      return {
        roomTypeId: roomType.id,
        name: roomType.name,
        capacity: roomType.capacity,
        basePrice: roomType.basePrice,
        description: roomType.description,
        totalRooms: totalInventory,
        availableRooms: availableToday,
        bookingsCount: roomType.bookings.length
      };
    });

    return NextResponse.json(inventoryWithAvailability);
  } catch (error) {
    console.error('Error getting room inventory:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// POST update room inventory for a property
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ propertyId: string }> }
) {
  try {
    const guard = await staffGuard('inventory.write', { propertyId: (await params).propertyId });
    if ('error' in guard) return guard.error;

    const propertyId = (await params).propertyId;
    const body = await request.json();
    const { roomTypeId, count } = body;

    if (!roomTypeId || count === undefined || count < 0) {
      return NextResponse.json(
        { error: 'Room type ID and valid count are required' },
        { status: 400 }
      );
    }

    // Check if room type exists and belongs to this property
    const roomType = await prisma.roomType.findFirst({
      where: {
        id: roomTypeId,
        propertyId
      }
    });

    if (!roomType) {
      return NextResponse.json(
        { error: 'Room type not found for this property' },
        { status: 404 }
      );
    }

    // Get current inventory
    const currentInventory = await prisma.room.count({
      where: {
        roomTypeId
      }
    });

    // If increasing inventory
    if (count > currentInventory) {
      // Add new inventory items
      const newItems = [];
      for (let i = 0; i < count - currentInventory; i++) {
        // Generate a room number using the current count and an incrementing value
        const roomNumber = `${roomType.name.substring(0, 2).toUpperCase()}${currentInventory + i + 1}`.padStart(4, '0');
        newItems.push({
          propertyId,
          roomTypeId,
          roomNumber
        });
      }

      if (newItems.length > 0) {
        await prisma.room.createMany({
          data: newItems
        });
      }
    }
    // If decreasing inventory
    else if (count < currentInventory) {
      // Get inventory items to delete
      const inventoryItems = await prisma.room.findMany({
        where: {
          roomTypeId
        },
        take: currentInventory - count
      });

      if (inventoryItems.length > 0) {
        await prisma.room.deleteMany({
          where: {
            id: {
              in: inventoryItems.map((item: any) => item.id)
            }
          }
        });
      }
    }

    // Get updated inventory
    const updatedInventory = await prisma.room.count({
      where: {
        roomTypeId
      }
    });

    return NextResponse.json({ 
      roomTypeId, 
      inventoryCount: updatedInventory 
    });
  } catch (error) {
    console.error('Error updating room inventory:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
