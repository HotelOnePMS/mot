import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireStaff } from '@/server/authz';
import { handleRoute, json, parseJson } from '@/server/http';
import { recordAudit } from '@/server/services/audit';
import { pmsProperty } from '@/server/pms/guard';
import { setToolEnabled } from '@/server/pms/tools';

/** PATCH { propertyId, tool, enabled } — let HotelOne use one of the PMS's tools, or not. */
export const PATCH = handleRoute(async (request: NextRequest) => {
  const actor = await requireStaff('bridge.manage');
  const body = await parseJson(request, z.object({ propertyId: z.string().min(1), tool: z.string().min(1).max(128), enabled: z.boolean() }));
  const property = await pmsProperty(actor, body.propertyId);
  const tool = await setToolEnabled(property.id, body.tool, body.enabled);
  await recordAudit({ actor, source: 'classic' }, property.id, 'PMS_MCP_TOOLS', `${body.enabled ? 'Switched on' : 'Switched off'} the PMS tool “${tool.title}”`, { tool: body.tool });
  return json(tool);
});
