/**
 * run_report: the one tool behind every custom report. The model writes a ReportQuery (src/lib/report-query.ts) for
 * whatever the person asked ("pet fees by month", "occupancy by weekday in October", "top 10 guests by spend"); this
 * validates it, runs it against the hotel's live data and returns both the table the person sees (a `report` block
 * with CSV download) and a compact copy for the model to talk about. Shared by the console agent and the Reports
 * page's "describe a report" box.
 */
import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod/v4';
import type { AgentBlock } from '@/lib/agent/blocks';
import {
  DATASET_IDS,
  DATE_BUCKETS,
  FILTER_OPS,
  METRIC_FNS,
  checkQuery,
  describeDatasets,
  encodeQuery,
  type DatasetId,
  type QueryResult,
  type ReportQuery,
} from '@/lib/report-query';
import { isISODate } from '../dates';
import { runQuery } from '../services/report-query';
import type { Actor } from '../authz';

const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .refine((v) => isISODate(v), 'Not a valid date');

const value = z.union([z.string().max(200), z.number()]);

export const reportQuerySchema = z.object({
  dataset: z.enum(DATASET_IDS as [DatasetId, ...DatasetId[]]),
  title: z.string().max(80).optional().describe('Short title for the table, e.g. "Pet fees by month".'),
  from: date.describe('First day of the range.'),
  to: date.describe('Last day of the range (INCLUSIVE).'),
  date_field: z.string().max(20).optional().describe('Which date the range applies to (see each dataset); defaults to the first.'),
  filters: z
    .array(
      z.object({
        field: z.string().max(40),
        op: z.enum(FILTER_OPS),
        value: z.union([value, z.array(value).max(50)]).optional().describe('A value, or a list for in / not_in. Text compares ignore case.'),
      })
    )
    .max(20)
    .optional(),
  group_by: z
    .array(z.object({ field: z.string().max(40), by: z.enum(DATE_BUCKETS).optional().describe('Date fields: day, week, month, quarter, year or weekday.') }))
    .max(3)
    .optional()
    .describe('One row per value of these fields. Omit for a plain list (with columns) or a single row of metrics.'),
  metrics: z
    .array(
      z.object({
        fn: z.enum(METRIC_FNS),
        field: z.string().max(40).optional(),
        per: z.string().max(40).optional().describe('ratio only: sum(field) ÷ sum(per).'),
        label: z.string().max(60).optional().describe('Column name, when the default isn’t clear.'),
      })
    )
    .max(12)
    .optional(),
  columns: z.array(z.string().max(40)).max(30).optional().describe('A plain list’s columns, in order.'),
  sort: z
    .array(z.object({ key: z.string().max(60).describe('A result column: field, group field or metric key.'), dir: z.enum(['asc', 'desc']).optional() }))
    .max(4)
    .optional(),
  limit: z.number().int().min(1).max(5000).optional().describe('Keep only the first N rows after sorting (top 10…).'),
});

export type ReportToolInput = z.infer<typeof reportQuerySchema>;

export const REPORT_TOOL_DESCRIPTION =
  'Build and run ANY report from the hotel’s live data: the person sees it as a table with totals and a CSV download. ' +
  'Pick a dataset and the date range, then either columns (a list of rows) or group_by + metrics (a summary; metrics without group_by give one row). ' +
  'Metrics: count; count_distinct(field); sum/avg/min/max(field); share(field?) = % of the whole; ratio(field, per) = sum(field)/sum(per); adr; occupancy, revpar and available (nights only). ' +
  'Group dates by day/week/month/quarter/year/weekday. Filter ops: eq, ne, in, not_in, gt, gte, lt, lte, contains, not_contains, empty, not_empty. ' +
  'Sort by any result column: a field, a group field, or a metric key (count, sum_total, avg_leadDays, share_total, ratio_total_guests, occupancy…). ' +
  'Examples: pet fees this month → charges, filters [name contains "pet"], metrics [sum amount, count]. Occupancy by weekday in October → nights, group_by [date by weekday], metrics [occupancy, adr, revpar]. ' +
  'Top 10 guests by spend this year → reservations, group_by [guest], metrics [sum total, count], sort [sum_total desc], limit 10. Cash taken yesterday → payments, filters [method eq Cash], metrics [sum amount, count].\n' +
  `Datasets:\n${describeDatasets()}`;

export function reportToolDef(): Anthropic.Beta.BetaTool {
  const schema = z.toJSONSchema(reportQuerySchema, { io: 'input' }) as Record<string, unknown>;
  delete schema.$schema;
  return { name: 'run_report', description: REPORT_TOOL_DESCRIPTION, input_schema: schema as Anthropic.Beta.BetaTool.InputSchema };
}

/** A query the model can fix: returned to it as an is_error result. */
export class ReportInputError extends Error {}

/** The model's tool input as a ReportQuery, or the problems with it. */
export function toReportQuery(raw: unknown): ReportQuery {
  const parsed = reportQuerySchema.safeParse(raw ?? {});
  if (!parsed.success) throw new ReportInputError(`Invalid input: ${parsed.error.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; ')}`);
  const a = parsed.data;
  const q: ReportQuery = {
    dataset: a.dataset,
    ...(a.title ? { title: a.title } : {}),
    from: a.from,
    to: a.to,
    ...(a.date_field ? { dateField: a.date_field } : {}),
    ...(a.filters?.length ? { filters: a.filters.map((f) => ({ field: f.field, op: f.op, ...(f.value !== undefined ? { value: f.value } : {}) })) } : {}),
    ...(a.group_by?.length ? { groupBy: a.group_by.map((g) => ({ field: g.field, ...(g.by ? { by: g.by } : {}) })) } : {}),
    ...(a.metrics?.length ? { metrics: a.metrics.map((m) => ({ fn: m.fn, ...(m.field ? { field: m.field } : {}), ...(m.per ? { per: m.per } : {}), ...(m.label ? { label: m.label } : {}) })) } : {}),
    ...(a.columns?.length ? { columns: a.columns } : {}),
    ...(a.sort?.length ? { sort: a.sort.map((s) => ({ key: s.key, ...(s.dir ? { dir: s.dir } : {}) })) } : {}),
    ...(a.limit ? { limit: a.limit } : {}),
  };
  const problems = checkQuery(q);
  if (problems.length) throw new ReportInputError(problems.join(' '));
  return q;
}

/** A report from a link (?q=, as encodeQuery wrote it: camelCase keys), checked like the model's. */
export function queryFromUrl(raw: unknown): ReportQuery {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new ReportInputError('That isn’t a report.');
  const { dateField, groupBy, ...rest } = raw as Record<string, unknown>;
  return toReportQuery({ ...rest, ...(dateField !== undefined ? { date_field: dateField } : {}), ...(groupBy !== undefined ? { group_by: groupBy } : {}) });
}

/** Rows a report card shows (the CSV and the Reports page have them all). */
export const REPORT_BLOCK_ROWS = 50;

export function reportLinks(propertyId: string, query: ReportQuery) {
  const q = encodeQuery(query);
  return {
    csvHref: `/api/admin/reports/query?propertyId=${encodeURIComponent(propertyId)}&format=csv&q=${q}`,
    openHref: `/admin/reports?q=${q}`,
  };
}

export function reportBlock(propertyId: string, result: QueryResult): AgentBlock {
  const { query } = result;
  return {
    type: 'report',
    title: result.title,
    from: query.from,
    to: query.to,
    currency: result.property.currency,
    columns: result.columns,
    rows: result.rows.slice(0, REPORT_BLOCK_ROWS),
    totals: result.totals,
    totalRows: result.rows.length,
    matched: result.matched,
    truncated: result.truncated,
    ...reportLinks(propertyId, query),
  };
}

/** The result for the model: what's in the table (capped), so it can answer from it. */
export function reportForModel(result: QueryResult, max = 12_000): string {
  const out = {
    title: result.title,
    currency: result.property.currency,
    range: `${result.query.from} to ${result.query.to}`,
    columns: result.columns.map((c) => `${c.key} (${c.label})`),
    rows: result.rows.slice(0, 80),
    ...(result.rows.length > 80 ? { moreRows: result.rows.length - 80 } : {}),
    totals: result.totals,
    matchedSourceRows: result.matched,
    ...(result.truncated ? { truncated: 'More source rows than a report reads: narrow the dates or filters for exact totals.' } : {}),
    shownToPerson: 'The person sees this table with a CSV download; don’t repeat it row by row.',
  };
  const text = JSON.stringify(out);
  return text.length > max ? `${text.slice(0, max)}… (truncated)` : text;
}

/** Validate and run the model's report for this person and hotel. */
export async function runReportTool(actor: Actor, propertyId: string, raw: unknown): Promise<{ query: ReportQuery; result: QueryResult }> {
  const query = toReportQuery(raw);
  const result = await runQuery(actor, propertyId, query);
  return { query, result };
}
