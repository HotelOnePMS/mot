import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireStaff, resolvePropertyId } from '@/server/authz';
import { badRequest } from '@/server/errors';
import { handleRoute, json, parseQuery } from '@/server/http';
import { decodeQuery, type ReportQuery } from '@/lib/report-query';
import { reportFileName, toCsv } from '@/lib/reports';
import { ReportInputError, queryFromUrl } from '@/server/agent/report-tool';
import { recordQueryExport, runQuery } from '@/server/services/report-query';

const schema = z.object({
  propertyId: z.string().optional(),
  /** The report, as the agent or the Reports page wrote it (encodeQuery: base64url JSON). */
  q: z.string().min(2).max(8000),
  format: z.enum(['json', 'csv']).default('json'),
});

/**
 * GET /api/admin/reports/query — run a custom report (one the agent built from plain words, or a link to one) for the
 * hotel (reports.view). format=csv downloads it as a spreadsheet and records the export in the activity log.
 */
export const GET = handleRoute(async (request: NextRequest) => {
  const actor = await requireStaff('reports.view');
  const p = parseQuery(request, schema);
  const propertyId = await resolvePropertyId(actor, p.propertyId);
  let query: ReportQuery;
  try {
    query = queryFromUrl(decodeQuery(p.q));
  } catch (e) {
    throw badRequest(e instanceof ReportInputError ? e.message : 'This report link is broken. Ask for the report again.');
  }
  const result = await runQuery(actor, propertyId, query);
  if (p.format === 'json') return json(result);

  await recordQueryExport({ actor, source: 'classic' }, propertyId, result);
  return new Response(toCsv(result.columns, result.rows, result.totals), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${reportFileName(result.property.name, result.title, result.query.from, result.query.to)}"`,
      'Cache-Control': 'no-store',
    },
  });
});
