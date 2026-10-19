import type { ChannelPromotion, PromotionType } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getAdapter } from './adapters';
import { loadConnection } from './ari';
import { addDays, hotelToday, isDateString, toDbDate, toISODate } from './dates';
import { errorMessage, logSync } from './sync';
import { CHANNEL_LABELS, ChannelApiError, OtaPromotionPayload } from './types';

export const PROMOTION_TYPES: PromotionType[] = ['BASIC', 'EARLY_BOOKER', 'LAST_MINUTE', 'MULTI_NIGHT'];

export interface PromotionInput {
  name: string;
  type: PromotionType;
  discountPercent: number;
  stayStart: string;
  stayEnd: string;
  bookStart: string | null;
  bookEnd: string | null;
  minStay: number | null;
  minDaysInAdvance: number | null;
  maxDaysInAdvance: number | null;
  /** PMS room type IDs; empty = every mapped room type */
  roomTypeIds: string[];
}

export interface PromotionChanges extends Partial<PromotionInput> {
  active?: boolean;
}

/** Throws a ChannelApiError describing the first problem found */
export function validatePromotion(input: PromotionInput): void {
  const today = hotelToday();
  if (!input.name.trim()) throw new ChannelApiError('Promotion name is required');
  if (!PROMOTION_TYPES.includes(input.type)) throw new ChannelApiError(`Unknown promotion type ${input.type}`);
  if (!(input.discountPercent >= 1 && input.discountPercent <= 80)) {
    throw new ChannelApiError('Discount must be between 1% and 80%');
  }
  for (const [label, value] of [
    ['Stay start', input.stayStart],
    ['Stay end', input.stayEnd],
  ] as const) {
    if (!isDateString(value)) throw new ChannelApiError(`${label} must be a YYYY-MM-DD date`);
  }
  if (input.stayEnd < input.stayStart) throw new ChannelApiError('Stay end must be on or after stay start');
  if (input.stayEnd < today) throw new ChannelApiError('Stay dates are in the past');
  if (input.stayEnd > addDays(today, 730)) throw new ChannelApiError('Stay dates can be at most 2 years ahead');
  if (input.bookStart !== null && !isDateString(input.bookStart)) throw new ChannelApiError('Book start must be a date');
  if (input.bookEnd !== null && !isDateString(input.bookEnd)) throw new ChannelApiError('Book end must be a date');
  if (input.bookStart && input.bookEnd && input.bookEnd < input.bookStart) {
    throw new ChannelApiError('Booking window end must be on or after its start');
  }
  if (input.minStay !== null && !(Number.isInteger(input.minStay) && input.minStay >= 1 && input.minStay <= 30)) {
    throw new ChannelApiError('Minimum stay must be between 1 and 30 nights');
  }
  if (input.type === 'MULTI_NIGHT' && !(input.minStay && input.minStay >= 2)) {
    throw new ChannelApiError('Multi-night promotions need a minimum stay of at least 2 nights');
  }
  if (input.type === 'EARLY_BOOKER') {
    if (!(input.minDaysInAdvance && Number.isInteger(input.minDaysInAdvance) && input.minDaysInAdvance >= 1 && input.minDaysInAdvance <= 365)) {
      throw new ChannelApiError('Early-booker promotions need minDaysInAdvance between 1 and 365');
    }
  }
  if (input.type === 'LAST_MINUTE') {
    if (!(input.maxDaysInAdvance && Number.isInteger(input.maxDaysInAdvance) && input.maxDaysInAdvance >= 1 && input.maxDaysInAdvance <= 30)) {
      throw new ChannelApiError('Last-minute promotions need maxDaysInAdvance between 1 and 30');
    }
  }
}

function toInput(promotion: ChannelPromotion): PromotionInput {
  return {
    name: promotion.name,
    type: promotion.type,
    discountPercent: Number(promotion.discountPercent),
    stayStart: toISODate(promotion.stayStart),
    stayEnd: toISODate(promotion.stayEnd),
    bookStart: promotion.bookStart ? toISODate(promotion.bookStart) : null,
    bookEnd: promotion.bookEnd ? toISODate(promotion.bookEnd) : null,
    minStay: promotion.minStay,
    minDaysInAdvance: promotion.minDaysInAdvance,
    maxDaysInAdvance: promotion.maxDaysInAdvance,
    roomTypeIds: promotion.roomTypeIds,
  };
}

function dataFor(input: PromotionInput) {
  return {
    name: input.name.trim(),
    type: input.type,
    discountPercent: input.discountPercent,
    stayStart: toDbDate(input.stayStart),
    stayEnd: toDbDate(input.stayEnd),
    bookStart: input.bookStart ? toDbDate(input.bookStart) : null,
    bookEnd: input.bookEnd ? toDbDate(input.bookEnd) : null,
    minStay: input.minStay,
    minDaysInAdvance: input.type === 'EARLY_BOOKER' ? input.minDaysInAdvance : null,
    maxDaysInAdvance: input.type === 'LAST_MINUTE' ? input.maxDaysInAdvance : null,
    roomTypeIds: input.roomTypeIds,
  };
}

/** Sends the promotion to the OTA and records the outcome on the row */
async function pushPromotion(promotion: ChannelPromotion, active: boolean): Promise<ChannelPromotion> {
  const connection = await loadConnection(promotion.connectionId);
  if (!connection) throw new ChannelApiError('Channel connection not found');

  const mappings = connection.roomMappings.filter(
    (m) => promotion.roomTypeIds.length === 0 || promotion.roomTypeIds.includes(m.roomTypeId)
  );
  const input = toInput(promotion);
  const payload: OtaPromotionPayload = {
    externalId: promotion.externalId,
    ...input,
    active,
    otaRoomTypeIds: Array.from(new Set(mappings.map((m) => m.otaRoomTypeId))),
    otaRatePlanIds: Array.from(new Set(mappings.map((m) => m.otaRatePlanId))),
  };
  const label = `${CHANNEL_LABELS[connection.channel]} promotion "${promotion.name}"`;

  // Never reached the OTA, so there is nothing to deactivate there
  if (!active && !promotion.externalId) {
    return prisma.channelPromotion.update({
      where: { id: promotion.id },
      data: { status: 'INACTIVE', lastError: null },
    });
  }

  try {
    if (connection.status !== 'ACTIVE' && connection.status !== 'ERROR') {
      throw new ChannelApiError('Activate the channel connection before pushing promotions');
    }
    if (mappings.length === 0) {
      throw new ChannelApiError('None of the selected room types are mapped on this channel');
    }
    const adapter = await getAdapter(connection);
    const { externalId } = await adapter.upsertPromotion(payload);
    const updated = await prisma.channelPromotion.update({
      where: { id: promotion.id },
      data: { externalId, status: active ? 'ACTIVE' : 'INACTIVE', lastError: null },
    });
    await logSync(connection.id, 'PROMOTION', 'SUCCESS', `${label} ${active ? 'published' : 'deactivated'}`, {
      promotionId: promotion.id,
      externalId,
    });
    return updated;
  } catch (error) {
    const message = errorMessage(error);
    const updated = await prisma.channelPromotion.update({
      where: { id: promotion.id },
      data: { status: 'FAILED', lastError: message },
    });
    await logSync(connection.id, 'PROMOTION', 'FAILED', `${label}: ${message}`, { promotionId: promotion.id });
    return updated;
  }
}

export async function createPromotion(
  connectionId: string,
  input: PromotionInput,
  createdBy: string
): Promise<ChannelPromotion> {
  validatePromotion(input);
  const connection = await prisma.channelConnection.findUnique({ where: { id: connectionId }, select: { id: true } });
  if (!connection) throw new ChannelApiError('Channel connection not found');

  const promotion = await prisma.channelPromotion.create({
    data: { connectionId, ...dataFor(input), status: 'ACTIVE', createdBy },
  });
  return pushPromotion(promotion, true);
}

export async function updatePromotion(promotionId: string, changes: PromotionChanges): Promise<ChannelPromotion> {
  const promotion = await prisma.channelPromotion.findUnique({ where: { id: promotionId } });
  if (!promotion) throw new ChannelApiError('Promotion not found');

  const { active, ...fields } = changes;
  const input: PromotionInput = { ...toInput(promotion), ...fields };
  const isActive = active ?? promotion.status !== 'INACTIVE';
  // Deactivating only needs to reach the OTA; full validation is for live promotions
  if (isActive) validatePromotion(input);

  const updated = await prisma.channelPromotion.update({
    where: { id: promotionId },
    data: dataFor(input),
  });
  return pushPromotion(updated, isActive);
}

export function serializePromotion(promotion: ChannelPromotion) {
  return {
    id: promotion.id,
    connectionId: promotion.connectionId,
    externalId: promotion.externalId,
    status: promotion.status,
    lastError: promotion.lastError,
    createdBy: promotion.createdBy,
    createdAt: promotion.createdAt,
    ...toInput(promotion),
  };
}
