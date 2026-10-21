import { NextRequest, NextResponse } from 'next/server';
import { purgeExpiredIdPhotos } from '@/server/payments/cardAuthorization';
import { releaseExpiredHolds } from '@/server/payments/expiry';

/**
 * GET — releases unpaid online bookings whose hold has run out, and deletes
 * card-authorization ID photos past their retention period. Optional: the
 * same sweeps also run now and then during normal use. Protected by
 * CRON_SECRET (Vercel Cron sends it as a bearer token); disabled without one.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const released = await releaseExpiredHolds();
  const idPhotosPurged = await purgeExpiredIdPhotos();
  return NextResponse.json({ released, idPhotosPurged });
}
