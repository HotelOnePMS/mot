import { addDays } from '@/lib/date-utils';
import { operationsStatus, pace, performance, trend, WEEKDAYS } from './analysis';
import { LAST_YEAR_OFFSET_DAYS, dayOfWeek, type Kpis, type PortfolioData } from './portfolio-data';

/**
 * Builds the portfolio snapshot that goes into the advisor's system prompt as its
 * global context. Output is deterministic for the same data and day so the prompt
 * cache keeps hitting across turns of a conversation.
 */

// Detailed per-property sections are capped so very large portfolios stay compact;
// the advisor can still reach every property through its tools.
const MAX_DETAILED_PROPERTIES = 40;
const MAX_PROPERTIES_WITH_MONTHLY_TREND = 12;

const usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const usd2 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const int = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

export const money = (n: number | null) => (n === null ? '-' : usd0.format(n));
export const rate = (n: number | null) => (n === null ? '-' : usd2.format(n));
export const pct = (n: number | null) => (n === null ? '-' : `${n.toFixed(1)}%`);
export const count = (n: number | null) => (n === null ? '-' : int.format(n));
const signedPct = (n: number | null) => (n === null ? '-' : `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`);
const oneDecimal = (n: number | null) => (n === null ? '-' : n.toFixed(1));

function changePct(current: number, previous: number) {
  return previous > 0 ? ((current - previous) / previous) * 100 : null;
}

function table(headers: string[], rows: (string | number)[][]): string {
  const escape = (cell: string | number) => String(cell).replace(/\|/g, '/').replace(/\n/g, ' ');
  return [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.map(escape).join(' | ')} |`),
  ].join('\n');
}

function firstOfMonth(date: string, monthsBack = 0): string {
  const [year, month] = date.split('-').map(Number);
  const index = year * 12 + (month - 1) - monthsBack;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}-01`;
}

const kpiCells = (k: Kpis) => [pct(k.occupancyPct), rate(k.adr), rate(k.revpar), money(k.roomRevenue), count(k.roomNightsSold)];

export async function buildPortfolioSnapshot(data: PortfolioData): Promise<string> {
  const today = data.today;
  const allIds = data.properties.map((p) => p.id);
  const lines: string[] = [];

  lines.push(
    '# Portfolio snapshot',
    '',
    `Hotel-local date today: ${today} (${WEEKDAYS[dayOfWeek(today)]}). Periods ending "today" exclude tonight; forward periods start with tonight.`,
    `Scope: ${data.properties.length} ${data.properties.length === 1 ? 'property' : 'properties'} (${
      data.scope.role === 'ADMIN' ? 'every property on the platform; the user is a platform admin' : "the properties assigned to this owner's account"
    }).`,
    '',
    'How figures are computed (from this platform\'s booking records):',
    '- Stay-date basis: each booking\'s total price is spread evenly across its nights, and each night counts in the period it falls in.',
    '- Sold = bookings with status PENDING, CONFIRMED, CHECKED_IN or CHECKED_OUT (the statuses that hold inventory). PENDING means not yet confirmed by staff.',
    '- Occupancy = room nights sold / (active rooms x nights). ADR = room revenue / room nights sold. RevPAR = room revenue / available room nights.',
    `- LY = the same dates ${LAST_YEAR_OFFSET_DAYS} days earlier (weekday-aligned). STLY = what was on the books for those dates at this point last year (cancel dates approximated by last update).`,
    '- Capacity uses the current active room types and room counts for every period.',
    '- Revenue is room revenue in USD as recorded on bookings. The system has no cost, tax, channel, marketing, review or competitor data.',
    '',
  );

  if (data.properties.length === 0) {
    lines.push('No properties are assigned to this account yet, so there is no performance data to analyse.');
    return lines.join('\n');
  }

  // Load every window the sections below need (trailing year, its LY, next 90 days) in one query.
  await data.bookingsOverlapping(addDays(today, -365 - LAST_YEAR_OFFSET_DAYS), addDays(today, 90));

  // Rank properties by trailing-year revenue so the biggest drivers appear first.
  const last365 = await performance(data, { from: addDays(today, -365), to: today, propertyIds: allIds, groupBy: 'property', compareTo: 'none' });
  const revenue365 = new Map(last365.map((r) => [r.group.key, r.kpis.roomRevenue]));
  const ranked = [...data.properties].sort((a, b) => (revenue365.get(b.id) ?? 0) - (revenue365.get(a.id) ?? 0) || a.name.localeCompare(b.name));
  const detailed = ranked.slice(0, MAX_DETAILED_PROPERTIES);
  const detailedIds = detailed.map((p) => p.id);
  if (ranked.length > detailed.length) {
    lines.push(
      `Note: detailed sections cover the top ${detailed.length} properties by trailing-365-day revenue. ${
        ranked.length - detailed.length
      } smaller properties appear only in the property list; use the tools to analyse them.`,
      '',
    );
  }

  // Properties and room types
  lines.push('## Properties and room types', '');
  for (const p of ranked) {
    lines.push(`### ${p.name} (property id \`${p.id}\`), ${p.city}, ${p.state}${p.isActive ? '' : ' [INACTIVE]'}`);
    if (p.roomTypes.length === 0) {
      lines.push('No room types set up.', '');
      continue;
    }
    lines.push(
      table(
        ['Room type', 'Room type id', 'Sleeps', 'Rooms', 'Base rate', 'Active'],
        p.roomTypes.map((rt) => [rt.name, `\`${rt.id}\``, rt.capacity, rt.totalRooms, rate(rt.basePrice), rt.isActive ? 'yes' : 'no']),
      ),
      '',
    );
  }

  // Portfolio KPIs for standard periods
  const periods: { label: string; from: string; to: string }[] = [
    { label: 'Last 7 days', from: addDays(today, -7), to: today },
    { label: 'Last 30 days', from: addDays(today, -30), to: today },
    { label: 'Previous 30 days', from: addDays(today, -60), to: addDays(today, -30) },
    { label: 'Month to date', from: firstOfMonth(today), to: today },
    { label: 'Year to date', from: `${today.slice(0, 4)}-01-01`, to: today },
    { label: 'Last 365 days', from: addDays(today, -365), to: today },
  ].filter((period) => period.from < period.to);

  const portfolioRows: (string | number)[][] = [];
  for (const period of periods) {
    const [row] = await performance(data, { ...period, propertyIds: allIds, groupBy: 'portfolio', compareTo: 'last_year' });
    portfolioRows.push([
      period.label,
      `${period.from} to ${addDays(period.to, -1)}`,
      ...kpiCells(row.kpis),
      money(row.comparison!.kpis.roomRevenue),
      signedPct(row.comparison!.changes.roomRevenuePct),
    ]);
  }
  lines.push(
    '## Portfolio KPIs',
    '',
    table(['Period', 'Nights', 'Occ', 'ADR', 'RevPAR', 'Room revenue', 'Room nights', 'LY revenue', 'vs LY'], portfolioRows),
    '',
  );

  // Property performance, last 30 days vs LY
  const last30 = await performance(data, { from: addDays(today, -30), to: today, propertyIds: detailedIds, groupBy: 'property', compareTo: 'last_year' });
  lines.push(
    `## Property performance, last 30 days (${addDays(today, -30)} to ${addDays(today, -1)}) vs LY`,
    '',
    table(
      ['Property', 'Occ', 'Occ LY', 'ADR', 'ADR LY', 'RevPAR', 'Revenue', 'Revenue LY', 'vs LY', 'Cancel rate', 'Avg LOS', 'Avg lead days', 'Pending arrivals', 'No-shows'],
      last30.map(({ group, kpis, comparison }) => [
        group.label,
        pct(kpis.occupancyPct),
        pct(comparison!.kpis.occupancyPct),
        rate(kpis.adr),
        rate(comparison!.kpis.adr),
        rate(kpis.revpar),
        money(kpis.roomRevenue),
        money(comparison!.kpis.roomRevenue),
        signedPct(comparison!.changes.roomRevenuePct),
        pct(kpis.cancellationRatePct),
        oneDecimal(kpis.avgLengthOfStay),
        oneDecimal(kpis.avgLeadTimeDays),
        kpis.pendingArrivals,
        kpis.noShows,
      ]),
    ),
    '',
  );

  // Property performance, trailing year
  const portfolioRevenue365 = last365.reduce((s, r) => s + r.kpis.roomRevenue, 0);
  lines.push(
    `## Property performance, last 365 days (${addDays(today, -365)} to ${addDays(today, -1)})`,
    '',
    table(
      ['Property', 'Rooms', 'Occ', 'ADR', 'RevPAR', 'Revenue', 'Share of portfolio revenue', 'Cancel rate', 'Avg LOS'],
      last365
        .filter((r) => detailedIds.includes(r.group.key))
        .sort((a, b) => b.kpis.roomRevenue - a.kpis.roomRevenue)
        .map(({ group, kpis }) => [
          group.label,
          group.roomsPerNight,
          pct(kpis.occupancyPct),
          rate(kpis.adr),
          rate(kpis.revpar),
          money(kpis.roomRevenue),
          pct(portfolioRevenue365 > 0 ? (kpis.roomRevenue / portfolioRevenue365) * 100 : null),
          pct(kpis.cancellationRatePct),
          oneDecimal(kpis.avgLengthOfStay),
        ]),
    ),
    '',
  );

  // Forward look
  const next30 = await pace(data, { from: today, to: addDays(today, 30), propertyIds: allIds, groupBy: 'portfolio' });
  const next90 = await pace(data, { from: today, to: addDays(today, 90), propertyIds: allIds, groupBy: 'portfolio' });
  const next30ByProperty = await pace(data, { from: today, to: addDays(today, 30), propertyIds: detailedIds, groupBy: 'property' });
  const next90ByProperty = await pace(data, { from: today, to: addDays(today, 90), propertyIds: detailedIds, groupBy: 'property' });
  const forwardRow = (label: string, p30: (typeof next30)[number]['pace'], p90: (typeof next90)[number]['pace']) => [
    label,
    pct(p30.onTheBooks.occupancyPct),
    money(p30.onTheBooks.revenue),
    money(p30.sameTimeLastYear.revenue),
    signedPct(changePct(p30.onTheBooks.revenue, p30.sameTimeLastYear.revenue)),
    money(p30.lastYearFinal.revenue),
    pct(p90.onTheBooks.occupancyPct),
    money(p90.onTheBooks.revenue),
    money(p90.sameTimeLastYear.revenue),
    signedPct(changePct(p90.onTheBooks.revenue, p90.sameTimeLastYear.revenue)),
    count(p30.pickupLast7Days.roomNights),
  ];
  lines.push(
    `## On the books: next 30 days (${today} to ${addDays(today, 29)}) and next 90 days (to ${addDays(today, 89)})`,
    '',
    table(
      ['Scope', 'Next 30 occ', 'Next 30 revenue', 'STLY', 'vs STLY', 'LY final', 'Next 90 occ', 'Next 90 revenue', 'STLY', 'vs STLY', 'Next-30 room nights picked up in last 7 days'],
      [
        forwardRow('Portfolio', next30[0].pace, next90[0].pace),
        ...next30ByProperty.map((row, i) => forwardRow(row.group.label, row.pace, next90ByProperty[i].pace)),
      ],
    ),
    '',
  );

  // Monthly trend
  const trendFrom = firstOfMonth(today, 12);
  const monthly = await trend(data, {
    from: trendFrom,
    to: addDays(today, 1),
    propertyIds: allIds,
    groupBy: 'portfolio',
    granularity: 'month',
  });
  const monthlyByProperty =
    detailed.length > 1 && detailed.length <= MAX_PROPERTIES_WITH_MONTHLY_TREND
      ? await trend(data, { from: trendFrom, to: addDays(today, 1), propertyIds: detailedIds, groupBy: 'property', granularity: 'month' })
      : [];
  lines.push('## Monthly trend, last 13 months (current month is partial, through today)', '');
  for (const series of [...monthly, ...monthlyByProperty]) {
    lines.push(
      `### ${series.group.label}`,
      table(
        ['Month', 'Occ', 'ADR', 'RevPAR', 'Room revenue', 'Arrivals', 'Cancel rate'],
        series.buckets.map((b) => [
          b.partial ? `${b.label} (MTD)` : b.label,
          pct(b.kpis.occupancyPct),
          rate(b.kpis.adr),
          rate(b.kpis.revpar),
          money(b.kpis.roomRevenue),
          b.kpis.arrivals,
          pct(b.kpis.cancellationRatePct),
        ]),
      ),
      '',
    );
  }
  if (detailed.length > MAX_PROPERTIES_WITH_MONTHLY_TREND) {
    lines.push('Per-property monthly trends are omitted for portfolios this size; use get_trend.', '');
  }

  // Room type performance
  const roomTypes = await performance(data, { from: addDays(today, -90), to: today, propertyIds: detailedIds, groupBy: 'room_type', compareTo: 'none' });
  const propertyRevenue90 = new Map<string, number>();
  for (const r of roomTypes) propertyRevenue90.set(r.group.propertyId!, (propertyRevenue90.get(r.group.propertyId!) ?? 0) + r.kpis.roomRevenue);
  lines.push(
    `## Room type performance, last 90 days (${addDays(today, -90)} to ${addDays(today, -1)})`,
    '',
    table(
      ['Property / room type', 'Rooms', 'Base rate', 'Occ', 'ADR', 'RevPAR', 'Revenue', 'Share of property revenue'],
      roomTypes.map(({ group, kpis }) => {
        const propertyTotal = propertyRevenue90.get(group.propertyId!) ?? 0;
        return [
          group.label,
          group.roomsPerNight,
          rate(data.roomTypeById.get(group.roomTypeId!)!.basePrice),
          ...kpiCells(kpis).slice(0, 4),
          pct(propertyTotal > 0 ? (kpis.roomRevenue / propertyTotal) * 100 : null),
        ];
      }),
    ),
    '',
  );

  // Operations (kept optional: performance context is still useful if room tracking is unavailable)
  let operations: Awaited<ReturnType<typeof operationsStatus>>;
  try {
    operations = await operationsStatus(data, detailedIds);
  } catch (error) {
    console.error('Advisor snapshot: operations status unavailable:', error);
    lines.push('## Operations right now', '', 'Operations data (room status, housekeeping) could not be loaded.');
    return lines.join('\n');
  }
  lines.push(
    '## Operations right now',
    '',
    table(
      ['Property', 'Sellable rooms configured', 'Physical rooms set up', 'Dirty', 'Out of order', 'Open housekeeping tasks'],
      operations.map((o) => [
        o.property,
        o.sellableRoomsConfigured,
        o.physicalRoomsSetUp,
        o.roomsByStatus.dirty,
        o.roomsByStatus.outOfOrder,
        o.openHousekeepingTasks.pending + o.openHousekeepingTasks.inProgress,
      ]),
    ),
  );
  const outOfOrder = operations.filter((o) => o.outOfOrderRooms.length > 0);
  if (outOfOrder.length) {
    lines.push('', 'Out-of-order rooms (reason as entered by staff):');
    for (const o of outOfOrder) {
      lines.push(`- ${o.property}: ${o.outOfOrderRooms.map((r) => `${r.room}${r.reason ? ` (${r.reason})` : ''}`).join(', ')}`);
    }
  }

  return lines.join('\n');
}

/** Headline numbers for the advisor page header. */
export async function buildPortfolioOverview(data: PortfolioData) {
  const today = data.today;
  const allIds = data.properties.map((p) => p.id);
  const [last30] = await performance(data, { from: addDays(today, -30), to: today, propertyIds: allIds, groupBy: 'portfolio', compareTo: 'last_year' });
  const [next30] = await pace(data, { from: today, to: addDays(today, 30), propertyIds: allIds, groupBy: 'portfolio' });

  return {
    today,
    role: data.scope.role,
    properties: data.properties.map((p) => ({
      id: p.id,
      name: p.name,
      city: p.city,
      state: p.state,
      isActive: p.isActive,
      rooms: data.roomsPerNight({ propertyIds: [p.id] }),
    })),
    last30Days: {
      roomRevenue: last30.kpis.roomRevenue,
      revenueVsLastYearPct: last30.comparison!.changes.roomRevenuePct,
      occupancyPct: last30.kpis.occupancyPct,
      adr: last30.kpis.adr,
      revpar: last30.kpis.revpar,
    },
    next30Days: {
      occupancyPct: next30.pace.onTheBooks.occupancyPct,
      roomRevenue: next30.pace.onTheBooks.revenue,
      revenueVsSameTimeLastYearPct: changePct(next30.pace.onTheBooks.revenue, next30.pace.sameTimeLastYear.revenue),
    },
  };
}
