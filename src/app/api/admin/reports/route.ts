import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireStaff, resolvePropertyId } from '@/server/authz';
import { isISODate } from '@/server/dates';
import { handleRoute, json, parseQuery } from '@/server/http';
import { REPORT_PAYMENT_METHODS, REPORT_STATUSES, reportFileName, toCsv, type ReportSpec } from '@/lib/reports';
import { recordReportExport, runReport } from '@/server/services/reports';
import { todayAt } from '@/server/services/hotels';

const day = z.string().refine(isISODate, 'must be YYYY-MM-DD');
/** Comma-separated list → array (empty entries dropped). */
const list = <T extends z.ZodTypeAny>(item: T) =>
  z
    .string()
    .max(4000)
    .optional()
    .transform((s) => (s ? s.split(',').map((v) => v.trim()).filter(Boolean) : []))
    .pipe(z.array(item).max(60));

const query = z.object({
  propertyId: z.string().optional(),
  kind: z.enum(['list', 'summary']).default('list'),
  from: day.optional(),
  to: day.optional(),
  dateField: z.enum(['stay', 'checkIn', 'checkOut', 'created']).default('stay'),
  groupBy: z.enum(['date', 'roomType', 'source', 'paymentMethod']).default('date'),
  roomTypes: list(z.string().max(64)),
  sources: list(z.string().max(40)),
  statuses: list(z.enum(REPORT_STATUSES as [string, ...string[]])),
  paymentMethods: list(z.enum(REPORT_PAYMENT_METHODS as [string, ...string[]])),
  columns: list(z.string().max(40)),
  format: z.enum(['json', 'csv']).default('json'),
  title: z.string().max(80).optional(),
});

/**
 * GET /api/admin/reports — run a front desk report (reports.view).
 * format=csv downloads it as a spreadsheet and records the export in the activity log.
 */
export const GET = handleRoute(async (request: NextRequest) => {
  const actor = await requireStaff('reports.view');
  const q = parseQuery(request, query);
  const propertyId = await resolvePropertyId(actor, q.propertyId);
  const today = q.from && q.to ? '' : await todayAt(propertyId);
  const spec: ReportSpec = {
    kind: q.kind,
    from: q.from ?? q.to ?? today,
    to: q.to ?? q.from ?? today,
    dateField: q.dateField,
    groupBy: q.groupBy,
    roomTypes: q.roomTypes,
    sources: q.sources,
    statuses: q.statuses as ReportSpec['statuses'],
    paymentMethods: q.paymentMethods as ReportSpec['paymentMethods'],
    columns: q.columns,
  };
  const result = await runReport(actor, propertyId, spec);
  if (q.format === 'json') return json(result);

  const title = q.title?.trim() || 'Custom';
  await recordReportExport({ actor, source: 'classic' }, propertyId, title, result);
  return new Response(toCsv(result.columns, result.rows, result.totals), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${reportFileName(result.property.name, title, result.spec.from, result.spec.to)}"`,
      'Cache-Control': 'no-store',
    },
  });
});
