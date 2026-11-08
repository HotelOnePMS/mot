import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireStaff, resolvePropertyId } from '@/server/authz';
import { DomainError } from '@/server/errors';
import { handleRoute, json, parseJson } from '@/server/http';
import { llmConfigured } from '@/server/agent/harness';
import { askForReport } from '@/server/agent/report-agent';
import { encodeQuery } from '@/lib/report-query';

export const maxDuration = 60;

const schema = z.object({
  propertyId: z.string().optional(),
  question: z.string().trim().min(3).max(1000),
});

/**
 * POST /api/admin/reports/ask: build a report from plain words ("pet fees by month this year", "occupancy by
 * weekday in October") and run it (reports.view). Returns the query (and its link form), the result, and a short note;
 * or only a note when the request needs more detail.
 */
export const POST = handleRoute(async (request: NextRequest) => {
  const actor = await requireStaff('reports.view');
  const body = await parseJson(request, schema);
  const propertyId = await resolvePropertyId(actor, body.propertyId);
  if (!llmConfigured()) throw new DomainError(503, 'UNAVAILABLE', 'Describing a report needs the AI assistant, which isn’t set up here. Use the ready-made reports or the filters instead.');
  const out = await askForReport(actor, propertyId, body.question, { signal: request.signal });
  return json({ ...out, q: out.query ? encodeQuery(out.query) : null });
});
