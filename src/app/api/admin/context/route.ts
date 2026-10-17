import { prisma } from '@/lib/prisma';
import type { StaffContext } from '@/lib/dto';
import { PERMISSIONS, can, requireStaff, scopeProperties, type Permission } from '@/server/authz';
import { hotelToday } from '@/server/dates';
import { handleRoute, json } from '@/server/http';
import { LLM_AGENT_AVAILABLE } from '@/server/agent/llm';
import { voiceAvailable } from '@/server/voice/provider';

/** GET /api/admin/context — who am I, which properties, what can I do. */
export const GET = handleRoute(async () => {
  const actor = await requireStaff();
  const properties = await prisma.property.findMany({
    where: scopeProperties(actor),
    select: { id: true, name: true, city: true, state: true, interfaceMode: true, setupPath: true, primaryColor: true, isDemo: true },
    orderBy: [{ isDemo: 'asc' }, { createdAt: 'asc' }],
  });
  const body: StaffContext = {
    user: { id: actor.userId, name: actor.name, email: actor.email, role: actor.role },
    properties,
    permissions: (Object.keys(PERMISSIONS) as Permission[]).filter((p) => can(actor, p)),
    today: hotelToday(),
    agent: { llmEnabled: LLM_AGENT_AVAILABLE, voiceEnabled: voiceAvailable() },
  };
  return json(body);
});
