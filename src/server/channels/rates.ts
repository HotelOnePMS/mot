/**
 * Rate, restriction and markup changes for OTA channels.
 * Every change is planned first (so it can be previewed / approved) and then
 * applied and pushed to the affected channels.
 */
import { prisma } from '@/lib/prisma';
import { computeChannelDays, getPmsRates, loadConnection, roundPrice, type ConnectionWithMappings } from './ari';
import { addDays, eachDate, earliestToday, isDateString, toDbDate, todayAt, toISODate, Weekday, WEEKDAYS, weekdayOf } from './dates';
import { AriPushSummary, errorMessage, pushAri, syncRoomTypeToChannels } from './sync';
import { CHANNEL_LABELS, ChannelApiError } from './types';

export const MIN_PRICE = 1;
export const MAX_PRICE = 10000;
const MAX_RANGE_DAYS = 366;
const WRITE_BATCH = 100;

export const ADJUSTMENT_TYPES = [
  'set_price',
  'increase_percent',
  'decrease_percent',
  'increase_amount',
  'decrease_amount',
  'reset_to_pms_rate',
] as const;
export type AdjustmentType = (typeof ADJUSTMENT_TYPES)[number];

export type RateScope = 'channel' | 'all_channels_and_direct';

export interface RateChangeRequest {
  /** channel = OTA-only price; all_channels_and_direct = PMS rate used by the website and every channel */
  scope: RateScope;
  connectionIds: string[];
  propertyId: string | null;
  /** Empty = every mapped room type (channel scope) / every room type of the property (direct scope) */
  roomTypeIds: string[];
  startDate: string;
  endDate: string;
  /** Empty = every day */
  daysOfWeek: Weekday[];
  adjustment: { type: AdjustmentType; value: number | null };
}

export interface ChangeGroup {
  target: string;
  connectionId: string | null;
  roomTypeId: string;
  roomTypeName: string;
  dates: number;
  firstDate: string;
  lastDate: string;
  oldMin: number;
  oldMax: number;
  newMin: number;
  newMax: number;
}

interface PlannedCell {
  connectionId: string | null;
  roomTypeId: string;
  date: string;
  oldPrice: number;
  /** null = remove the channel override */
  newOverride: number | null;
  resultingPrice: number;
}

export interface RateChangePlan {
  summary: string;
  groups: ChangeGroup[];
  warnings: string[];
  cellCount: number;
}

export function validateDateRange(startDate: string, endDate: string): void {
  if (!isDateString(startDate) || !isDateString(endDate)) {
    throw new ChannelApiError('Dates must be in YYYY-MM-DD format');
  }
  const today = earliestToday();
  if (startDate < today) throw new ChannelApiError(`Start date ${startDate} is in the past (today is ${today})`);
  if (endDate < startDate) throw new ChannelApiError('End date must be on or after the start date');
  if (endDate > addDays(today, 730)) throw new ChannelApiError('Dates can be at most 2 years ahead');
  if (eachDate(startDate, endDate).length > MAX_RANGE_DAYS) {
    throw new ChannelApiError(`A single change can cover at most ${MAX_RANGE_DAYS} days`);
  }
}

function validateAdjustment(adjustment: RateChangeRequest['adjustment']): void {
  const { type, value } = adjustment;
  if (!ADJUSTMENT_TYPES.includes(type)) throw new ChannelApiError(`Unknown adjustment ${type}`);
  if (type === 'reset_to_pms_rate') return;
  if (value === null || !Number.isFinite(value) || value <= 0) {
    throw new ChannelApiError('Adjustment value must be a positive number');
  }
  if (type === 'set_price' && (value < MIN_PRICE || value > MAX_PRICE)) {
    throw new ChannelApiError(`Prices must be between $${MIN_PRICE} and $${MAX_PRICE}`);
  }
  if (type === 'increase_percent' && value > 200) throw new ChannelApiError('Increases are limited to 200%');
  if (type === 'decrease_percent' && value > 90) throw new ChannelApiError('Decreases are limited to 90%');
  if ((type === 'increase_amount' || type === 'decrease_amount') && value > 5000) {
    throw new ChannelApiError('Amount changes are limited to $5000');
  }
}

function adjust(oldPrice: number, { type, value }: RateChangeRequest['adjustment']): number {
  const v = value ?? 0;
  switch (type) {
    case 'set_price':
      return roundPrice(v);
    case 'increase_percent':
      return roundPrice(oldPrice * (1 + v / 100));
    case 'decrease_percent':
      return roundPrice(oldPrice * (1 - v / 100));
    case 'increase_amount':
      return roundPrice(oldPrice + v);
    case 'decrease_amount':
      return roundPrice(oldPrice - v);
    case 'reset_to_pms_rate':
      return oldPrice;
  }
}

function matchesWeekday(date: string, daysOfWeek: Weekday[]): boolean {
  return daysOfWeek.length === 0 || daysOfWeek.includes(weekdayOf(date));
}

function describeDays(daysOfWeek: Weekday[]): string {
  if (daysOfWeek.length === 0 || daysOfWeek.length === 7) return 'every day';
  return WEEKDAYS.filter((d) => daysOfWeek.includes(d)).join('/');
}

function summarizeAdjustment({ type, value }: RateChangeRequest['adjustment']): string {
  switch (type) {
    case 'set_price':
      return `set price to $${value}`;
    case 'increase_percent':
      return `increase by ${value}%`;
    case 'decrease_percent':
      return `decrease by ${value}%`;
    case 'increase_amount':
      return `increase by $${value}`;
    case 'decrease_amount':
      return `decrease by $${value}`;
    case 'reset_to_pms_rate':
      return 'remove channel-specific prices (back to PMS rate + markup)';
  }
}

function groupCells(cells: PlannedCell[], targetName: (cell: PlannedCell) => string, roomNames: Map<string, string>) {
  const groups = new Map<string, ChangeGroup>();
  for (const cell of cells) {
    const key = `${cell.connectionId}|${cell.roomTypeId}`;
    const group = groups.get(key);
    if (!group) {
      groups.set(key, {
        target: targetName(cell),
        connectionId: cell.connectionId,
        roomTypeId: cell.roomTypeId,
        roomTypeName: roomNames.get(cell.roomTypeId) ?? cell.roomTypeId,
        dates: 1,
        firstDate: cell.date,
        lastDate: cell.date,
        oldMin: cell.oldPrice,
        oldMax: cell.oldPrice,
        newMin: cell.resultingPrice,
        newMax: cell.resultingPrice,
      });
    } else {
      group.dates++;
      group.firstDate = cell.date < group.firstDate ? cell.date : group.firstDate;
      group.lastDate = cell.date > group.lastDate ? cell.date : group.lastDate;
      group.oldMin = Math.min(group.oldMin, cell.oldPrice);
      group.oldMax = Math.max(group.oldMax, cell.oldPrice);
      group.newMin = Math.min(group.newMin, cell.resultingPrice);
      group.newMax = Math.max(group.newMax, cell.resultingPrice);
    }
  }
  return Array.from(groups.values());
}

async function loadConnections(connectionIds: string[]): Promise<ConnectionWithMappings[]> {
  if (connectionIds.length === 0) throw new ChannelApiError('Choose at least one channel connection');
  const connections: ConnectionWithMappings[] = [];
  for (const id of Array.from(new Set(connectionIds))) {
    const connection = await loadConnection(id);
    if (!connection) throw new ChannelApiError(`Channel connection ${id} not found`);
    connections.push(connection);
  }
  return connections;
}

async function connectionLabels(connections: ConnectionWithMappings[]): Promise<Map<string, string>> {
  const properties = await prisma.property.findMany({
    where: { id: { in: connections.map((c) => c.propertyId) } },
    select: { id: true, name: true },
  });
  const names = new Map(properties.map((p) => [p.id, p.name]));
  return new Map(connections.map((c) => [c.id, `${CHANNEL_LABELS[c.channel]} (${names.get(c.propertyId) ?? 'property'})`]));
}

async function planCells(request: RateChangeRequest): Promise<{ cells: PlannedCell[]; plan: RateChangePlan }> {
  validateDateRange(request.startDate, request.endDate);
  validateAdjustment(request.adjustment);
  const warnings: string[] = [];
  const cells: PlannedCell[] = [];
  const roomNames = new Map<string, string>();
  let targetName: (cell: PlannedCell) => string;

  if (request.scope === 'channel') {
    const connections = await loadConnections(request.connectionIds);
    const labels = await connectionLabels(connections);
    targetName = (cell) => labels.get(cell.connectionId!) ?? 'channel';

    for (const connection of connections) {
      for (const m of connection.roomMappings) roomNames.set(m.roomTypeId, m.roomType.name);
      const mappedIds = new Set(connection.roomMappings.map((m) => m.roomTypeId));
      for (const id of request.roomTypeIds.filter((id) => !mappedIds.has(id))) {
        warnings.push(`Room type ${id} is not mapped on ${labels.get(connection.id)} and was skipped`);
      }
      const days = await computeChannelDays(connection, request.startDate, request.endDate, request.roomTypeIds);
      for (const day of days) {
        if (!matchesWeekday(day.date, request.daysOfWeek)) continue;
        const reset = request.adjustment.type === 'reset_to_pms_rate';
        const resultingPrice = reset
          ? roundPrice(day.pmsRate * (1 + day.markupPercent / 100))
          : adjust(day.channelRate, request.adjustment);
        if (reset && day.overridePrice === null) continue;
        cells.push({
          connectionId: connection.id,
          roomTypeId: day.roomTypeId,
          date: day.date,
          oldPrice: day.channelRate,
          newOverride: reset ? null : resultingPrice,
          resultingPrice,
        });
      }
    }
  } else {
    if (request.adjustment.type === 'reset_to_pms_rate') {
      throw new ChannelApiError('reset_to_pms_rate only applies to channel-specific prices (scope "channel")');
    }
    const roomTypes = await prisma.roomType.findMany({
      where:
        request.roomTypeIds.length > 0
          ? { id: { in: request.roomTypeIds } }
          : request.propertyId
            ? { propertyId: request.propertyId, isActive: true }
            : { id: { in: [] } },
      select: { id: true, name: true, basePrice: true },
    });
    if (roomTypes.length === 0) {
      throw new ChannelApiError('Specify the room types (or the property) whose PMS rates should change');
    }
    for (const missing of request.roomTypeIds.filter((id) => !roomTypes.some((rt) => rt.id === id))) {
      warnings.push(`Room type ${missing} was not found and was skipped`);
    }
    for (const rt of roomTypes) roomNames.set(rt.id, rt.name);
    targetName = () => 'PMS rate (website + all channels)';

    const pmsRates = await getPmsRates(roomTypes, request.startDate, request.endDate);
    for (const roomType of roomTypes) {
      for (const [date, oldPrice] of pmsRates.get(roomType.id)!) {
        if (!matchesWeekday(date, request.daysOfWeek)) continue;
        const resultingPrice = adjust(oldPrice, request.adjustment);
        cells.push({ connectionId: null, roomTypeId: roomType.id, date, oldPrice, newOverride: resultingPrice, resultingPrice });
      }
    }

    const overrides = await prisma.channelRateOverride.count({
      where: {
        roomTypeId: { in: roomTypes.map((rt) => rt.id) },
        date: { gte: toDbDate(request.startDate), lte: toDbDate(request.endDate) },
        price: { not: null },
      },
    });
    if (overrides > 0) {
      warnings.push(
        `${overrides} channel-specific price(s) exist in this range and will keep overriding the PMS rate on those channels`
      );
    }
  }

  if (cells.length === 0) {
    warnings.push('No dates matched - nothing would change');
  }
  const tooLow = cells.find((cell) => cell.resultingPrice < MIN_PRICE);
  if (tooLow) {
    throw new ChannelApiError(`This would set ${tooLow.date} to $${tooLow.resultingPrice}, below the $${MIN_PRICE} minimum`);
  }
  const tooHigh = cells.find((cell) => cell.resultingPrice > MAX_PRICE);
  if (tooHigh) {
    throw new ChannelApiError(`This would set ${tooHigh.date} to $${tooHigh.resultingPrice}, above the $${MAX_PRICE} maximum`);
  }
  if (cells.some((cell) => cell.resultingPrice > cell.oldPrice * 2 || cell.resultingPrice < cell.oldPrice * 0.5)) {
    warnings.push('Some prices change by more than 50% - double-check before approving');
  }

  const groups = groupCells(cells, targetName, roomNames);
  const summary =
    `${request.scope === 'channel' ? 'Channel price' : 'PMS rate'} change: ${summarizeAdjustment(request.adjustment)}, ` +
    `${request.startDate} to ${request.endDate} (${describeDays(request.daysOfWeek)}), ${cells.length} room-night price(s)`;
  return { cells, plan: { summary, groups, warnings, cellCount: cells.length } };
}

export async function previewRateChange(request: RateChangeRequest): Promise<RateChangePlan> {
  return (await planCells(request)).plan;
}

async function inBatches<T>(items: T[], run: (batch: T[]) => Promise<unknown>): Promise<void> {
  for (let i = 0; i < items.length; i += WRITE_BATCH) {
    await run(items.slice(i, i + WRITE_BATCH));
  }
}

async function pushConnections(
  connectionIds: string[],
  from: string,
  to: string,
  roomTypeIds?: string[]
): Promise<Array<AriPushSummary | { connectionId: string; error: string }>> {
  const results: Array<AriPushSummary | { connectionId: string; error: string }> = [];
  for (const connectionId of connectionIds) {
    try {
      results.push(await pushAri(connectionId, { from, to, roomTypeIds }));
    } catch (error) {
      results.push({ connectionId, error: errorMessage(error) });
    }
  }
  return results;
}

/** Removes override rows that no longer carry a price or restriction */
async function cleanupOverrides(connectionId: string, from: string, to: string) {
  await prisma.channelRateOverride.deleteMany({
    where: {
      connectionId,
      date: { gte: toDbDate(from), lte: toDbDate(to) },
      price: null,
      closed: false,
      minStay: null,
    },
  });
}

export async function applyRateChange(request: RateChangeRequest, actor: string) {
  const { cells, plan } = await planCells(request);

  if (request.scope === 'channel') {
    await inBatches(cells, (batch) =>
      prisma.$transaction(
        batch.map((cell) =>
          prisma.channelRateOverride.upsert({
            where: {
              connectionId_roomTypeId_date: {
                connectionId: cell.connectionId!,
                roomTypeId: cell.roomTypeId,
                date: toDbDate(cell.date),
              },
            },
            create: {
              connectionId: cell.connectionId!,
              roomTypeId: cell.roomTypeId,
              date: toDbDate(cell.date),
              price: cell.newOverride,
              updatedBy: actor,
            },
            update: { price: cell.newOverride, updatedBy: actor },
          })
        )
      )
    );
    const connectionIds = Array.from(new Set(cells.map((cell) => cell.connectionId!)));
    for (const id of connectionIds) await cleanupOverrides(id, request.startDate, request.endDate);
    const roomTypeIds = request.roomTypeIds.length > 0 ? request.roomTypeIds : undefined;
    const sync = await pushConnections(connectionIds, request.startDate, request.endDate, roomTypeIds);
    return { ...plan, applied: true, sync };
  }

  await inBatches(cells, (batch) =>
    prisma.$transaction(
      batch.map((cell) =>
        prisma.roomTypeRate.upsert({
          where: { roomTypeId_date: { roomTypeId: cell.roomTypeId, date: toDbDate(cell.date) } },
          create: { roomTypeId: cell.roomTypeId, date: toDbDate(cell.date), price: cell.resultingPrice },
          update: { price: cell.resultingPrice },
        })
      )
    )
  );
  const sync: AriPushSummary[] = [];
  for (const roomTypeId of Array.from(new Set(cells.map((cell) => cell.roomTypeId)))) {
    sync.push(...(await syncRoomTypeToChannels(roomTypeId, request.startDate, request.endDate)));
  }
  return { ...plan, applied: true, sync };
}

// ---------------------------------------------------------------------------
// Restrictions (stop-sell / min stay)
// ---------------------------------------------------------------------------

export interface RestrictionRequest {
  connectionIds: string[];
  roomTypeIds: string[];
  startDate: string;
  endDate: string;
  daysOfWeek: Weekday[];
  /** true = stop sell, false = open, null = unchanged */
  closed: boolean | null;
  /** 1 clears the restriction, null = unchanged */
  minStay: number | null;
}

async function planRestrictionCells(request: RestrictionRequest) {
  validateDateRange(request.startDate, request.endDate);
  if (request.closed === null && request.minStay === null) {
    throw new ChannelApiError('Set closed and/or minStay');
  }
  if (request.minStay !== null && !(Number.isInteger(request.minStay) && request.minStay >= 1 && request.minStay <= 30)) {
    throw new ChannelApiError('Minimum stay must be between 1 and 30 nights');
  }
  const connections = await loadConnections(request.connectionIds);
  const labels = await connectionLabels(connections);
  const cells: Array<{ connectionId: string; roomTypeId: string; roomTypeName: string; date: string }> = [];
  for (const connection of connections) {
    const mappings = connection.roomMappings.filter(
      (m) => request.roomTypeIds.length === 0 || request.roomTypeIds.includes(m.roomTypeId)
    );
    for (const mapping of mappings) {
      for (const date of eachDate(request.startDate, request.endDate)) {
        if (!matchesWeekday(date, request.daysOfWeek)) continue;
        cells.push({ connectionId: connection.id, roomTypeId: mapping.roomTypeId, roomTypeName: mapping.roomType.name, date });
      }
    }
  }

  const parts = [
    request.closed === true ? 'stop sell (close)' : request.closed === false ? 'open for sale' : null,
    request.minStay !== null ? (request.minStay === 1 ? 'clear minimum stay' : `minimum stay ${request.minStay} nights`) : null,
  ].filter(Boolean);
  const targets = Array.from(new Set(cells.map((c) => `${labels.get(c.connectionId)}: ${c.roomTypeName}`)));
  return {
    cells,
    plan: {
      summary: `${parts.join(' + ')}, ${request.startDate} to ${request.endDate} (${describeDays(request.daysOfWeek)}), ${cells.length} room-night(s)`,
      targets,
      warnings: cells.length === 0 ? ['No mapped room types matched - nothing would change'] : [],
      cellCount: cells.length,
    },
  };
}

export async function previewRestrictions(request: RestrictionRequest) {
  return (await planRestrictionCells(request)).plan;
}

export async function applyRestrictions(request: RestrictionRequest, actor: string) {
  const { cells, plan } = await planRestrictionCells(request);
  const minStay = request.minStay === null ? undefined : request.minStay === 1 ? null : request.minStay;
  const closed = request.closed === null ? undefined : request.closed;

  await inBatches(cells, (batch) =>
    prisma.$transaction(
      batch.map((cell) =>
        prisma.channelRateOverride.upsert({
          where: {
            connectionId_roomTypeId_date: {
              connectionId: cell.connectionId,
              roomTypeId: cell.roomTypeId,
              date: toDbDate(cell.date),
            },
          },
          create: {
            connectionId: cell.connectionId,
            roomTypeId: cell.roomTypeId,
            date: toDbDate(cell.date),
            closed: closed ?? false,
            minStay: minStay ?? null,
            updatedBy: actor,
          },
          update: { closed, minStay, updatedBy: actor },
        })
      )
    )
  );
  const connectionIds = Array.from(new Set(cells.map((cell) => cell.connectionId)));
  for (const id of connectionIds) await cleanupOverrides(id, request.startDate, request.endDate);
  const roomTypeIds = request.roomTypeIds.length > 0 ? request.roomTypeIds : undefined;
  const sync = await pushConnections(connectionIds, request.startDate, request.endDate, roomTypeIds);
  return { ...plan, applied: true, sync };
}

// ---------------------------------------------------------------------------
// Markup
// ---------------------------------------------------------------------------

export interface MarkupRequest {
  connectionId: string;
  /** null = connection default (room types without their own markup) */
  roomTypeId: string | null;
  markupPercent: number;
}

export async function previewMarkup(request: MarkupRequest) {
  if (!Number.isFinite(request.markupPercent) || request.markupPercent < -50 || request.markupPercent > 100) {
    throw new ChannelApiError('Markup must be between -50% and 100%');
  }
  const [connection] = await loadConnections([request.connectionId]);
  const labels = await connectionLabels([connection]);
  const affected = connection.roomMappings.filter((m) =>
    request.roomTypeId ? m.roomTypeId === request.roomTypeId : m.markupPercent === null
  );
  if (request.roomTypeId && affected.length === 0) {
    throw new ChannelApiError('That room type is not mapped on this channel');
  }
  const current = request.roomTypeId
    ? Number(affected[0].markupPercent ?? connection.defaultMarkupPercent)
    : Number(connection.defaultMarkupPercent);
  return {
    summary: `${labels.get(connection.id)}: markup ${current}% -> ${request.markupPercent}% for ${
      request.roomTypeId ? affected[0].roomType.name : 'all room types using the channel default'
    }`,
    affectedRoomTypes: affected.map((m) => m.roomType.name),
    warnings: [] as string[],
  };
}

export async function applyMarkup(request: MarkupRequest) {
  const plan = await previewMarkup(request);
  if (request.roomTypeId) {
    await prisma.channelRoomMapping.update({
      where: { connectionId_roomTypeId: { connectionId: request.connectionId, roomTypeId: request.roomTypeId } },
      data: { markupPercent: request.markupPercent },
    });
  } else {
    await prisma.channelConnection.update({
      where: { id: request.connectionId },
      data: { defaultMarkupPercent: request.markupPercent },
    });
  }
  const { propertyId } = await prisma.channelConnection.findUniqueOrThrow({ where: { id: request.connectionId }, select: { propertyId: true } });
  const today = await todayAt(propertyId);
  const sync = await pushConnections(
    [request.connectionId],
    today,
    addDays(today, 730),
    request.roomTypeId ? [request.roomTypeId] : undefined
  );
  return { ...plan, applied: true, sync };
}

// ---------------------------------------------------------------------------
// Read model
// ---------------------------------------------------------------------------

/** Day-by-day channel prices with active promotions, for the UI and the agent */
export async function getChannelCalendar(connectionId: string, startDate: string, endDate: string, roomTypeId?: string | null) {
  if (!isDateString(startDate) || !isDateString(endDate) || endDate < startDate) {
    throw new ChannelApiError('Provide a valid startDate and endDate (YYYY-MM-DD)');
  }
  if (eachDate(startDate, endDate).length > 93) {
    throw new ChannelApiError('Calendar requests are limited to 93 days');
  }
  const connection = await loadConnection(connectionId);
  if (!connection) throw new ChannelApiError('Channel connection not found');

  const days = await computeChannelDays(connection, startDate, endDate, roomTypeId ? [roomTypeId] : undefined);
  const promotions = await prisma.channelPromotion.findMany({
    where: {
      connectionId,
      status: 'ACTIVE',
      stayStart: { lte: toDbDate(endDate) },
      stayEnd: { gte: toDbDate(startDate) },
    },
  });

  return {
    connectionId,
    channel: CHANNEL_LABELS[connection.channel],
    currency: connection.currency,
    roomTypes: connection.roomMappings
      .filter((m) => !roomTypeId || m.roomTypeId === roomTypeId)
      .map((m) => ({
        roomTypeId: m.roomTypeId,
        name: m.roomType.name,
        markupPercent: Number(m.markupPercent ?? connection.defaultMarkupPercent),
        days: days
          .filter((d) => d.roomTypeId === m.roomTypeId)
          .map((d) => ({
            date: d.date,
            weekday: weekdayOf(d.date),
            pmsRate: d.pmsRate,
            channelRate: d.channelRate,
            channelPriceOverride: d.overridePrice,
            available: d.available,
            booked: d.booked,
            closed: d.closed,
            minStay: d.minStay,
            promotions: promotions
              .filter(
                (p) =>
                  toISODate(p.stayStart) <= d.date &&
                  toISODate(p.stayEnd) >= d.date &&
                  (p.roomTypeIds.length === 0 || p.roomTypeIds.includes(d.roomTypeId))
              )
              .map((p) => `${p.name} (-${Number(p.discountPercent)}%)`),
          })),
      })),
  };
}
