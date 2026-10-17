import { NextResponse } from 'next/server';
import { contractDocument } from '@/server/pms/contract';
import { publicSiteUrl } from '@/server/public-url';

/** GET /developers/pms/contract.json — the recommended PMS MCP tool contract, machine-readable. */
export async function GET(request: Request) {
  const origin = publicSiteUrl() ?? new URL(request.url).origin;
  return NextResponse.json(contractDocument(origin), {
    headers: { 'Cache-Control': 'public, max-age=3600', 'Access-Control-Allow-Origin': '*' },
  });
}
