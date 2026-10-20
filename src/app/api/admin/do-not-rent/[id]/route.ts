import { NextRequest } from 'next/server';
import { requireStaff } from '@/server/authz';
import { handleRoute, json } from '@/server/http';
import { removeDoNotRent } from '@/server/services/doNotRent';

type Params = { params: Promise<{ id: string }> };

/** DELETE — take the guest off the list. The activity log keeps who added and removed them. */
export const DELETE = handleRoute(async (_req: NextRequest, { params }: Params) => {
  const { id } = await params;
  const actor = await requireStaff('dnr.manage');
  return json(await removeDoNotRent({ actor, source: 'classic' }, id));
});
