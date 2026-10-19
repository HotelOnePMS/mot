import { NextRequest } from 'next/server';
import { requireStaff } from '@/server/authz';
import { handleRoute, json, parseJson } from '@/server/http';
import { pricingSettingsSchema } from '@/server/schemas';
import { getPricingSettings, updatePricingSettings } from '@/server/services/hotels';
import { scheduleConfigSkillSync } from '@/server/skills';

type Params = { params: Promise<{ propertyId: string }> };

/** GET — the hotel's time zone, currency, taxes and fees. */
export const GET = handleRoute(async (_req: NextRequest, { params }: Params) => {
  const { propertyId } = await params;
  const actor = await requireStaff('charges.manage');
  return json(await getPricingSettings(actor, propertyId));
});

/** PUT — replace them (taxes and fees apply to quotes and bookings made from now on). */
export const PUT = handleRoute(async (request: NextRequest, { params }: Params) => {
  const { propertyId } = await params;
  const actor = await requireStaff('charges.manage');
  const body = await parseJson(request, pricingSettingsSchema);
  const saved = await updatePricingSettings({ actor, source: 'classic' }, propertyId, body);
  // Room answers quote prices in the hotel's currency.
  scheduleConfigSkillSync(propertyId);
  return json(saved);
});
