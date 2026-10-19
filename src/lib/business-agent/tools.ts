import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod/v4';
import { addDays } from '@/lib/date-utils';
import {
  demandPatterns,
  groupInfo,
  listBookings,
  operationsStatus,
  pace,
  performance,
  rateCalendar,
  trend,
} from './analysis';
import { daysBetween, type Kpis, type PortfolioData } from './portfolio-data';

/**
 * Read-only tools the advisor can call to dig deeper than the snapshot.
 * Each tool is defined once in zod: the JSON schema sent to Claude is generated
 * from it, and the same schema validates the model's input before running.
 */

const MAX_HISTORY_DAYS = 3 * 365;
const MAX_FUTURE_DAYS = 2 * 365;

const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), 'Not a valid date');

const range = {
  from: date.describe('First night to include, YYYY-MM-DD.'),
  to: date.describe('End of the range, exclusive, YYYY-MM-DD. The last night included is the day before. Use today\'s date to end at last night.'),
};

const propertyIds = z
  .array(z.string())
  .max(100)
  .optional()
  .describe('Property ids from the portfolio snapshot to include. Omit to include the whole portfolio.');

const definitions = {
  get_performance: {
    label: 'Analyzing performance',
    description:
      'Occupancy, ADR, RevPAR, room revenue, room nights, arrivals, cancellation rate, no-shows, average length of stay and lead time for any date range, ' +
      'grouped by portfolio, property or room type, optionally compared with the previous period or the same dates last year (52 weeks earlier). ' +
      'Use it for periods or breakdowns the snapshot does not already show.',
    schema: z.object({
      ...range,
      group_by: z.enum(['portfolio', 'property', 'room_type']).default('property'),
      compare_to: z.enum(['none', 'previous_period', 'last_year']).default('last_year'),
      property_ids: propertyIds,
    }),
    maxDays: 731,
  },
  get_trend: {
    label: 'Pulling trends',
    description:
      'Time series of occupancy, ADR, RevPAR, room revenue, arrivals and cancellation rate by day, week (Mon-Sun) or month, for the portfolio or per property. ' +
      'Use it to find seasonality, turning points, or how a change played out over time. Limits: day up to 120 days, week up to 2 years, month up to 3 years.',
    schema: z.object({
      ...range,
      granularity: z.enum(['day', 'week', 'month']),
      group_by: z.enum(['portfolio', 'property']).default('portfolio'),
      property_ids: propertyIds,
    }),
    maxDays: 1096,
  },
  get_booking_pace: {
    label: 'Checking booking pace',
    description:
      'Forward-looking: for future stay dates, what is on the books now versus what was on the books at this point last year (STLY) for the same dates, ' +
      'how those dates finished last year, and how many room nights were picked up in the last 7 and 30 days. ' +
      'Use it to judge whether upcoming demand is ahead or behind and where to adjust rates or promotions. `from` must be today or later.',
    schema: z.object({
      ...range,
      group_by: z.enum(['portfolio', 'property']).default('property'),
      property_ids: propertyIds,
    }),
    maxDays: 366,
  },
  get_demand_patterns: {
    label: 'Studying demand patterns',
    description:
      'Who books and how, for stays in a date range: occupancy and ADR by day of week, booking lead-time buckets (with cancellation rate and ADR), ' +
      'length-of-stay buckets, party size, multi-room bookings, and repeat-guest share. Use it for pricing by weekday, minimum-stay rules, ' +
      'cancellation policy and segment ideas.',
    schema: z.object({ ...range, property_ids: propertyIds }),
    maxDays: 731,
  },
  get_rate_calendar: {
    label: 'Reviewing rates',
    description:
      'Night-by-night selling rate (custom calendar rate or base rate) next to rooms sold and occupancy for specific room types. ' +
      'Use it to spot underpriced high-demand nights and overpriced empty ones. Up to 62 nights and 10 room types per call.',
    schema: z.object({
      ...range,
      room_type_ids: z.array(z.string()).min(1).max(10).describe('Room type ids from the portfolio snapshot.'),
    }),
    maxDays: 62,
  },
  get_operations_status: {
    label: 'Checking operations',
    description:
      'Current room status by property: rooms set up versus configured, clean/dirty/inspected/out-of-order counts, out-of-order rooms with reasons, ' +
      'and open housekeeping tasks. Use it when sellable inventory or service readiness matters.',
    schema: z.object({ property_ids: propertyIds }),
    maxDays: null,
  },
  list_bookings: {
    label: 'Looking up bookings',
    description:
      'Individual bookings for drill-down (guests are anonymised as stable codes like g-1a2b3c4d; no names, contact or payment details). ' +
      'date_basis "stay" matches bookings with any night in the range, "arrival" matches check-ins in the range, "created" matches bookings made in the range. ' +
      'Returns the total count and value of all matches plus up to `limit` rows.',
    schema: z.object({
      ...range,
      date_basis: z.enum(['stay', 'arrival', 'created']).default('stay'),
      statuses: z
        .array(z.enum(['PENDING', 'CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT', 'CANCELLED', 'NO_SHOW']))
        .optional()
        .describe('Only include these statuses. Omit for all statuses.'),
      property_ids: propertyIds,
      room_type_ids: z.array(z.string()).max(50).optional().describe('Only include these room type ids.'),
      sort: z.enum(['check_in', 'newest', 'highest_value']).default('check_in'),
      limit: z.number().int().min(1).max(100).default(25),
    }),
    maxDays: 731,
  },
} as const;

type ToolName = keyof typeof definitions;

function isToolName(name: string): name is ToolName {
  return Object.prototype.hasOwnProperty.call(definitions, name);
}

export function toolLabel(name: string): string {
  return isToolName(name) ? definitions[name].label : 'Working';
}

export const ADVISOR_TOOLS: Anthropic.Beta.BetaTool[] = Object.entries(definitions).map(([name, def]) => {
  const inputSchema = z.toJSONSchema(def.schema, { io: 'input' }) as Record<string, unknown>;
  delete inputSchema.$schema;
  return {
    name,
    description: def.description,
    input_schema: inputSchema as Anthropic.Beta.BetaTool.InputSchema,
    // Stream tool input as it is generated; inputs are validated with zod before running.
    eager_input_streaming: true,
  };
});

/** An error the model can fix by changing its input; returned as an is_error tool result. */
export class ToolInputError extends Error {}

function checkRange(data: PortfolioData, from: string, to: string, maxDays: number | null) {
  if (from >= to) throw new ToolInputError('`to` must be after `from` (it is exclusive).');
  if (maxDays !== null && daysBetween(from, to) > maxDays) {
    throw new ToolInputError(`Range is ${daysBetween(from, to)} nights; this tool accepts at most ${maxDays}.`);
  }
  if (from < addDays(data.today, -MAX_HISTORY_DAYS) || to > addDays(data.today, MAX_FUTURE_DAYS)) {
    throw new ToolInputError(`Dates must fall between ${addDays(data.today, -MAX_HISTORY_DAYS)} and ${addDays(data.today, MAX_FUTURE_DAYS)}.`);
  }
}

// Round floats so tool results stay compact; the model does not need 15 decimal places.
function compact(value: unknown): unknown {
  if (typeof value === 'number') return Number.isInteger(value) ? value : Math.round(value * 100) / 100;
  if (Array.isArray(value)) return value.map(compact);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).filter(([, v]) => typeof v !== 'function').map(([k, v]) => [k, compact(v)]),
    );
  }
  return value;
}

const trendPoint = (k: Kpis) => ({
  occupancyPct: k.occupancyPct,
  adr: k.adr,
  revpar: k.revpar,
  roomRevenue: k.roomRevenue,
  roomNightsSold: k.roomNightsSold,
  arrivals: k.arrivals,
  cancellationRatePct: k.cancellationRatePct,
});

export async function executeAdvisorTool(data: PortfolioData, name: string, rawInput: unknown): Promise<string> {
  if (!isToolName(name)) throw new ToolInputError(`Unknown tool: ${name}`);

  const parsed = definitions[name].schema.safeParse(rawInput);
  if (!parsed.success) {
    throw new ToolInputError(`Invalid input: ${parsed.error.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; ')}`);
  }
  const input = parsed.data;
  if ('from' in input) checkRange(data, input.from, input.to, definitions[name].maxDays);

  const scoped = <T>(fn: () => T) => {
    try {
      return fn();
    } catch (error) {
      throw new ToolInputError(error instanceof Error ? error.message : String(error));
    }
  };

  let result: unknown;
  switch (name) {
    case 'get_performance': {
      const args = input as z.infer<typeof definitions.get_performance.schema>;
      const ids = scoped(() => data.resolvePropertyIds(args.property_ids));
      const rows = await performance(data, { from: args.from, to: args.to, propertyIds: ids, groupBy: args.group_by, compareTo: args.compare_to });
      result = {
        range: { from: args.from, to: args.to, nights: daysBetween(args.from, args.to) },
        compareRange: rows[0]?.comparison ? { from: rows[0].comparison.from, to: rows[0].comparison.to } : null,
        rows: rows.map((r) => ({
          ...groupInfo(r.group),
          kpis: r.kpis,
          ...(r.comparison ? { comparisonKpis: r.comparison.kpis, changes: r.comparison.changes } : {}),
        })),
      };
      break;
    }
    case 'get_trend': {
      const args = input as z.infer<typeof definitions.get_trend.schema>;
      if (args.granularity === 'day' && daysBetween(args.from, args.to) > 120) throw new ToolInputError('Daily trends accept at most 120 days.');
      if (args.granularity === 'week' && daysBetween(args.from, args.to) > 731) throw new ToolInputError('Weekly trends accept at most 2 years.');
      const ids = scoped(() => data.resolvePropertyIds(args.property_ids));
      const series = await trend(data, { from: args.from, to: args.to, propertyIds: ids, groupBy: args.group_by, granularity: args.granularity });
      result = series.map((s) => ({
        ...groupInfo(s.group),
        buckets: s.buckets.map((b) => ({ period: b.label, from: b.from, to: b.to, ...(b.partial ? { partial: true } : {}), ...trendPoint(b.kpis) })),
      }));
      break;
    }
    case 'get_booking_pace': {
      const args = input as z.infer<typeof definitions.get_booking_pace.schema>;
      if (args.from < data.today) throw new ToolInputError(`Booking pace is for future stays: \`from\` must be ${data.today} or later.`);
      const ids = scoped(() => data.resolvePropertyIds(args.property_ids));
      const rows = await pace(data, { from: args.from, to: args.to, propertyIds: ids, groupBy: args.group_by });
      result = {
        range: { from: args.from, to: args.to, nights: daysBetween(args.from, args.to) },
        rows: rows.map((r) => ({ ...groupInfo(r.group), roomsPerNight: r.group.roomsPerNight, ...r.pace })),
      };
      break;
    }
    case 'get_demand_patterns': {
      const args = input as z.infer<typeof definitions.get_demand_patterns.schema>;
      const ids = scoped(() => data.resolvePropertyIds(args.property_ids));
      result = { range: { from: args.from, to: args.to }, ...(await demandPatterns(data, { from: args.from, to: args.to, propertyIds: ids })) };
      break;
    }
    case 'get_rate_calendar': {
      const args = input as z.infer<typeof definitions.get_rate_calendar.schema>;
      const roomTypeIds = scoped(() => data.resolveRoomTypeIds(args.room_type_ids));
      result = await rateCalendar(data, { from: args.from, to: args.to, roomTypeIds });
      break;
    }
    case 'get_operations_status': {
      const args = input as z.infer<typeof definitions.get_operations_status.schema>;
      const ids = scoped(() => data.resolvePropertyIds(args.property_ids));
      result = await operationsStatus(data, ids);
      break;
    }
    case 'list_bookings': {
      const args = input as z.infer<typeof definitions.list_bookings.schema>;
      const ids = scoped(() => data.resolvePropertyIds(args.property_ids));
      const roomTypeIds = args.room_type_ids ? scoped(() => data.resolveRoomTypeIds(args.room_type_ids!)) : undefined;
      result = await listBookings(data, {
        from: args.from,
        to: args.to,
        dateBasis: args.date_basis,
        propertyIds: ids,
        roomTypeIds,
        statuses: args.statuses,
        sort: args.sort,
        limit: args.limit,
      });
      break;
    }
  }

  return JSON.stringify(compact(result));
}
