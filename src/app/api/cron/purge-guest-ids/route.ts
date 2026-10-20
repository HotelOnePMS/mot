import { NextRequest, NextResponse } from 'next/server';
import { purgeExpiredGuestIds } from '@/server/services/guestIds';

/**
 * GET — deletes guest ID photos past each hotel's retention (Vercel Cron,
 * daily). Protected by CRON_SECRET (sent as a bearer token); disabled without one.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const deleted = await purgeExpiredGuestIds();
  return NextResponse.json({ deleted });
}
