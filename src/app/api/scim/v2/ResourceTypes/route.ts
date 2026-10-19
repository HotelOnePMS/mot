import { NextRequest } from 'next/server';
import { resourceTypes } from '@/server/auth/scim';
import { scim, scimJson } from '../_http';

export async function GET(request: NextRequest) {
  return scim(request, async (_org, base) => scimJson(resourceTypes(base)));
}
