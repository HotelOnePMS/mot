import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireStaff } from '@/server/authz';
import { handleRoute, json, parseJson } from '@/server/http';
import { setGuestRequestStatus } from '@/server/services/guestRequests';

type Params = { params: Promise<{ requestId: string }> };

/** PATCH { status } — mark a guest request handled (or reopen it). */
export const PATCH = handleRoute(async (request: NextRequest, { params }: Params) => {
  const { requestId } = await params;
  const actor = await requireStaff('requests.view');
  const { status } = await parseJson(request, z.object({ status: z.enum(['NEW', 'DONE']) }));
  return json(await setGuestRequestStatus({ actor, source: 'classic' }, requestId, status));
});
