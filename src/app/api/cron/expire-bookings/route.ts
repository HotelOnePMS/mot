import { NextRequest, NextResponse } from 'next/server';
import { releaseExpiredHolds } from '@/server/payments/expiry';

/**
 * GET — releases unpaid online bookings whose hold has run out. Optional: the
 * same sweep also runs whenever someone books that room type. Protected by
 * CRON_SECRET (Vercel Cron sends it as a bearer token); disabled without one.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const released = await releaseExpiredHolds();
  return NextResponse.json({ released });
}
