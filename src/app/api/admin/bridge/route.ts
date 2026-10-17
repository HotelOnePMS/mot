import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireStaff, requirePermission, resolvePropertyId } from '@/server/authz';
import { badRequest, notFound } from '@/server/errors';
import { handleRoute, json, parseJson, parseQuery } from '@/server/http';
import { recordAudit } from '@/server/services/audit';
import { assertNotDemoHotel } from '@/server/demo';
import { PMS_SYSTEMS, connectionView, getConnection, listTasks, taskView, upsertConnection } from '@/server/services/bridge';
import { deleteCachedTools } from '@/server/pms';
import { OPERATOR_MODEL, operatorConfigured } from '@/server/bridge/operator';
import { vaultAvailable } from '@/server/vault';
import { cloudLoginUrlIssue, pmsLoginUrlSchema } from '@/server/schemas';

/** GET — the property's PMS connection (no secrets) and recent bridge tasks. */
export const GET = handleRoute(async (request: NextRequest) => {
  const actor = await requireStaff('bridge.use');
  const q = parseQuery(request, z.object({ propertyId: z.string().optional() }));
  const propertyId = await resolvePropertyId(actor, q.propertyId);
  const [connection, tasks] = await Promise.all([getConnection(propertyId), listTasks(propertyId, 40)]);
  return json({
    connection: connectionView(connection),
    tasks: tasks.map(taskView),
    systems: PMS_SYSTEMS,
    operator: { ready: operatorConfigured(), model: OPERATOR_MODEL },
    vaultReady: vaultAvailable(),
    cloudWorker: !!process.env.BRIDGE_WORKER_SECRET,
  });
});

const putSchema = z.object({
  propertyId: z.string().min(1),
  system: z.string().trim().min(2).max(60),
  mode: z.enum(['DESKTOP', 'CLOUD']),
  loginUrl: pmsLoginUrlSchema,
});

/**
 * PUT — choose the PMS and how HotelOne reaches it (desktop connector or
 * cloud browser). MCP connections are set up with POST /api/admin/pms/connect,
 * which tests the server first; this route never accepts mode MCP.
 */
export const PUT = handleRoute(async (request: NextRequest) => {
  const actor = await requireStaff('bridge.manage');
  const body = await parseJson(request, putSchema);
  const propertyId = await resolvePropertyId(actor, body.propertyId);
  const urlIssue = cloudLoginUrlIssue(body.mode, body.loginUrl);
  if (urlIssue) throw badRequest(urlIssue);
  const c = await upsertConnection({ actor, source: 'classic' }, propertyId, { system: body.system, mode: body.mode, loginUrl: body.loginUrl || null });
  return json(connectionView(c));
});

/** PATCH { paused } — pause or resume the bridge without disconnecting. */
export const PATCH = handleRoute(async (request: NextRequest) => {
  const actor = await requireStaff('bridge.manage');
  const body = await parseJson(request, z.object({ propertyId: z.string().min(1), paused: z.boolean() }));
  const propertyId = await resolvePropertyId(actor, body.propertyId);
  const c = await getConnection(propertyId);
  if (!c) throw notFound('PMS connection');
  const ready = c.mode === 'CLOUD' ? !!c.credentialsCipher : c.mode === 'MCP' ? !!c.loginUrl : !!c.deviceTokenHash;
  const updated = await prisma.pmsConnection.update({ where: { id: c.id }, data: { status: body.paused ? 'PAUSED' : ready ? 'CONNECTED' : 'PENDING' } });
  await recordAudit({ actor, source: 'classic' }, propertyId, 'BRIDGE_SETUP', body.paused ? `Paused the ${c.system} bridge` : `Resumed the ${c.system} bridge`);
  return json(connectionView(updated));
});

/** DELETE — disconnect the PMS entirely (queued work is cancelled). */
export const DELETE = handleRoute(async (request: NextRequest) => {
  const actor = await requireStaff('bridge.manage');
  const q = parseQuery(request, z.object({ propertyId: z.string().min(1) }));
  const propertyId = await resolvePropertyId(actor, q.propertyId);
  requirePermission(actor, 'bridge.manage');
  const property = await prisma.property.findUnique({ where: { id: propertyId }, select: { isDemo: true } });
  if (!property) throw notFound('Property');
  // The shared demo hotels keep their PMS setup for every visitor.
  assertNotDemoHotel(actor, property.isDemo, 'Demo hotels keep their PMS connection for every visitor. Set up your own hotel to try disconnecting.');
  const c = await getConnection(propertyId);
  if (!c) return json({ ok: true });
  await prisma.$transaction([
    prisma.bridgeTask.updateMany({ where: { connectionId: c.id, status: { in: ['QUEUED', 'NEEDS_HELP'] } }, data: { status: 'CANCELLED', finishedAt: new Date() } }),
    prisma.pmsConnection.delete({ where: { id: c.id } }),
  ]);
  if (c.mode === 'MCP') await deleteCachedTools(propertyId);
  await recordAudit({ actor, source: 'classic' }, propertyId, 'BRIDGE_SETUP', `Disconnected ${c.system}`);
  return json({ ok: true });
});
