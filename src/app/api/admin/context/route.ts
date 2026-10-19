import { prisma } from '@/lib/prisma';
import type { StaffContext } from '@/lib/dto';
import { PERMISSIONS, can, requireStaff, scopeProperties, type Permission } from '@/server/authz';
import { hotelToday } from '@/server/dates';
import { handleRoute, json } from '@/server/http';
import { LLM_AGENT_AVAILABLE } from '@/server/agent/llm';
import { localeOf } from '@/server/services/hotels';
import { voiceAvailable } from '@/server/voice/provider';

/** GET /api/admin/context — who am I, which properties (with each hotel's clock and currency), what can I do. */
export const GET = handleRoute(async () => {
  const actor = await requireStaff();
  const [properties, orgs] = await Promise.all([
    prisma.property.findMany({
      where: scopeProperties(actor),
      select: {
        id: true,
        name: true,
        city: true,
        state: true,
        interfaceMode: true,
        setupPath: true,
        primaryColor: true,
        isDemo: true,
        timezone: true,
        currency: true,
        organization: { select: { id: true, name: true } },
      },
      orderBy: [{ isDemo: 'asc' }, { createdAt: 'asc' }],
    }),
    actor.orgAdminOf.length
      ? prisma.organization.findMany({ where: { id: { in: actor.orgAdminOf } }, select: { id: true, name: true }, orderBy: { name: 'asc' } })
      : Promise.resolve([]),
  ]);
  const now = new Date();
  const body: StaffContext = {
    user: { id: actor.userId, name: actor.name, email: actor.email, role: actor.role, mfaEnabled: actor.mfaEnabled, emailVerified: actor.emailVerified },
    properties: properties.map((p) => {
      const locale = localeOf(p);
      return { ...p, timezone: locale.timezone, currency: locale.currency, today: hotelToday(now, locale.timezone) };
    }),
    permissions: (Object.keys(PERMISSIONS) as Permission[]).filter((p) => can(actor, p)),
    today: hotelToday(now),
    orgAdminOf: orgs,
    agent: { llmEnabled: LLM_AGENT_AVAILABLE, voiceEnabled: voiceAvailable() },
  };
  return json(body);
});
