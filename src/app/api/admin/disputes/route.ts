import { NextRequest } from 'next/server';
import { handleRoute, json } from '@/server/http';
import { listDisputes } from '@/server/payments/disputes';

/** GET ?propertyId= — card disputes for the properties the signed-in user can access. */
export const GET = handleRoute(async (request: NextRequest) => {
  return json(await listDisputes(request.nextUrl.searchParams.get('propertyId')));
});
