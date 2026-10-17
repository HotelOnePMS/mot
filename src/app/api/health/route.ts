import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { databaseConfigured } from '@/lib/db-url';

export const dynamic = 'force-dynamic';

/** Deploy check: is the database connected and migrated? No details beyond that. */
export async function GET() {
  if (!databaseConfigured()) {
    return NextResponse.json({ ok: false, database: 'not_configured' }, { status: 503 });
  }
  try {
    const properties = await prisma.property.count();
    return NextResponse.json({ ok: true, database: 'up', seeded: properties > 0 });
  } catch {
    return NextResponse.json({ ok: false, database: 'unreachable_or_not_migrated' }, { status: 503 });
  }
}
