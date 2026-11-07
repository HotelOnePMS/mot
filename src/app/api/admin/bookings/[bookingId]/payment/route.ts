import { NextRequest, NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { assertPropertyAccess, requireStaff } from '@/server/authz';
import { errorResponse } from '@/server/http';

const paymentRows = {
  orderBy: { createdAt: 'desc' },
  select: {
    id: true,
    method: true,
    kind: true,
    status: true,
    amount: true,
    amountRefunded: true,
    currency: true,
    cardholderName: true,
    billingEmail: true,
    billingCountry: true,
    cardCountry: true,
    cardBrand: true,
    cardLast4: true,
    threeDSecure: true,
    riskLevel: true,
    riskScore: true,
    failureMessage: true,
    paidAt: true,
    createdAt: true,
  },
} satisfies Prisma.Booking$paymentsArgs;

const disputeRows = { orderBy: { createdAt: 'desc' }, select: { id: true, status: true, reason: true, amount: true, currency: true, evidenceDueBy: true, evidenceSubmittedAt: true } } satisfies Prisma.Booking$disputesArgs;

// GET payment details for a booking (admin only).
// Raw card data is never stored (PCI compliance), so only safe metadata is
// returned: card brand and last 4, the cardholder and billing details Stripe
// reported (kept apart from the guest's name), 3D Secure and fraud-screening
// results, amounts, and any dispute. Never PANs or CVVs.
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
        paymentDue: true,
        cardLast4: true,
        cardBrand: true,
        billingName: true,
        billingZip: true,
        stripeCheckoutSessionId: true,
        stripePaymentIntentId: true,
        totalPrice: true,
        payments: paymentRows,
        disputes: disputeRows,
        // Several room types booked together: the one payment (and any dispute) is on the lead line.
        reservationLead: { select: { code: true, payments: paymentRows, disputes: disputeRows, _count: { select: { reservationLines: true } } } },
        policyAcceptance: { select: { version: true, acceptedAt: true } },
      },
    });

    if (!booking) {
      return NextResponse.json(
        { error: 'Booking not found' },
        { status: 404 }
      );
    }

    assertPropertyAccess(actor, booking.propertyId);
    const { propertyId: _propertyId, reservationLead: lead, ...own } = booking;
    const shared = lead && lead._count.reservationLines > 1;
    const payment = shared ? { ...own, payments: lead.payments, disputes: lead.disputes } : own;
    return NextResponse.json({
      ...payment,
      // Set when the payment shown covers every room type of this reservation.
      reservation: shared ? { code: lead.code, roomTypes: lead._count.reservationLines } : null,
      paymentDue: payment.paymentDue === null ? null : Number(payment.paymentDue),
      payments: payment.payments.map((p) => ({ ...p, amount: Number(p.amount), amountRefunded: Number(p.amountRefunded) })),
      disputes: payment.disputes.map((d) => ({ ...d, amount: Number(d.amount) })),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
