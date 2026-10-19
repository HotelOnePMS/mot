import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { databaseConfigured } from '@/lib/db-url';

export const dynamic = 'force-dynamic';

/** Deploy check: `{ ok: true }` when the database answers, 503 `{ ok: false }` otherwise. No internals are exposed. */
export async function GET() {
  const headers = { 'Cache-Control': 'no-store' };
  if (!databaseConfigured()) return NextResponse.json({ ok: false }, { status: 503, headers });
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ ok: true }, { headers });
  } catch {
    return NextResponse.json({ ok: false }, { status: 503, headers });
  }
}
