import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { databaseConfigured } from '@/lib/db-url';
import { isEmailConfigured } from '@/server/email';
import { errorTrackingEnabled } from '@/server/log';

export const dynamic = 'force-dynamic';

/** Deploy check: is the database connected and migrated? No details beyond that. */
export async function GET() {
  if (!databaseConfigured()) {
    return NextResponse.json({ ok: false, database: 'not_configured' }, { status: 503 });
  }
  try {
    const properties = await prisma.property.count();
    // Which optional services are switched on (no keys or addresses).
    return NextResponse.json({ ok: true, database: 'up', seeded: properties > 0, errorTracking: errorTrackingEnabled(), email: isEmailConfigured() });
  } catch {
    return NextResponse.json({ ok: false, database: 'unreachable_or_not_migrated' }, { status: 503 });
  }
}
