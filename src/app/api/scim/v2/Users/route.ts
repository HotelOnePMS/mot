import { NextRequest } from 'next/server';
import { createUser, listUsers } from '@/server/auth/scim';
import { scim, scimBody, scimJson } from '../_http';

export const dynamic = 'force-dynamic';

/** GET /api/scim/v2/Users?filter=userName eq "…"&startIndex=1&count=100 */
export async function GET(request: NextRequest) {
  return scim(request, async (org, base) => {
    const p = request.nextUrl.searchParams;
    return scimJson(await listUsers(org, { filter: p.get('filter'), startIndex: Number(p.get('startIndex') || 1), count: Number(p.get('count') || 100) }, base));
  });
}

/** POST /api/scim/v2/Users — provision a person. */
export async function POST(request: NextRequest) {
  return scim(request, async (org, base) => scimJson(await createUser(org, await scimBody(request), base), 201));
}
