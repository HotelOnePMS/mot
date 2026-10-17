import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { assertPropertyAccess, requireStaff } from '@/server/authz';
import { errorResponse } from '@/server/http';

// GET payment metadata for a booking (admin only).
// Raw card data is never stored (PCI compliance), so only safe metadata
// (status, last4, brand, Stripe references) is returned — never PANs or CVVs.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ bookingId: string }> }
) {
  try {
    const { bookingId } = await params;

    const actor = await requireStaff('booking.payment.view');

    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: {
        id: true,
        propertyId: true,
        paymentStatus: true,
        cardLast4: true,
        cardBrand: true,
        billingName: true,
        billingZip: true,
        stripeCheckoutSessionId: true,
        stripePaymentIntentId: true,
        totalPrice: true,
      },
    });

    if (!booking) {
      return NextResponse.json(
        { error: 'Booking not found' },
        { status: 404 }
      );
    }

    assertPropertyAccess(actor, booking.propertyId);
    const { propertyId: _propertyId, ...payment } = booking;
    return NextResponse.json(payment);
  } catch (error) {
    return errorResponse(error);
  }
}
