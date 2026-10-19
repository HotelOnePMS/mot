import { NextRequest } from 'next/server';
import { requireStaff } from '@/server/authz';
import { handleRoute, json } from '@/server/http';
import { revokeScimToken, rotateScimToken } from '@/server/services/organizations';

type Params = { params: Promise<{ orgId: string }> };

/** POST — a new SCIM token, shown once (the old one stops working). */
export const POST = handleRoute(async (_req: NextRequest, { params }: Params) => {
  const { orgId } = await params;
  const actor = await requireStaff();
  return json(await rotateScimToken({ actor, source: 'classic' }, orgId), { headers: { 'Cache-Control': 'no-store' } });
});

/** DELETE — turn SCIM provisioning off. */
export const DELETE = handleRoute(async (_req: NextRequest, { params }: Params) => {
  const { orgId } = await params;
  const actor = await requireStaff();
  await revokeScimToken({ actor, source: 'classic' }, orgId);
  return json({ ok: true });
});
