import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireStaff, resolvePropertyId } from '@/server/authz';
import { handleRoute, json, parseJson, parseQuery } from '@/server/http';
import { clearCredentials, setCredentials } from '@/server/services/bridge';

const schema = z.object({
  propertyId: z.string().min(1),
  username: z.string().trim().min(1).max(200),
  password: z.string().min(1).max(500),
  totpSecret: z
    .string()
    .trim()
    .max(200)
    .regex(/^[A-Za-z2-7=\s]*$/, 'must be the base32 secret from your authenticator setup')
    .nullable()
    .optional(),
});

/** PUT — seal the PMS login for the cloud browser. Write-only: it is never returned. */
export const PUT = handleRoute(async (request: NextRequest) => {
  const actor = await requireStaff('bridge.manage');
  const body = await parseJson(request, schema);
  const propertyId = await resolvePropertyId(actor, body.propertyId);
  await setCredentials({ actor, source: 'classic' }, propertyId, { username: body.username, password: body.password, totpSecret: body.totpSecret || null });
  return json({ ok: true });
});

export const DELETE = handleRoute(async (request: NextRequest) => {
  const actor = await requireStaff('bridge.manage');
  const q = parseQuery(request, z.object({ propertyId: z.string().min(1) }));
  const propertyId = await resolvePropertyId(actor, q.propertyId);
  await clearCredentials({ actor, source: 'classic' }, propertyId);
  return json({ ok: true });
});
