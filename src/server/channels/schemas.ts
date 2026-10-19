/** Request validation shared by the admin API routes and the channel agent's tools */
import { z } from 'zod';
import { WEEKDAYS } from './dates';
import { ADJUSTMENT_TYPES } from './rates';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const id = z.string().min(1);

export const rateChangeSchema = z.object({
  scope: z.enum(['channel', 'all_channels_and_direct']),
  connectionIds: z.array(id).default([]),
  propertyId: id.nullable().default(null),
  roomTypeIds: z.array(id).default([]),
  startDate: date,
  endDate: date,
  daysOfWeek: z.array(z.enum(WEEKDAYS)).default([]),
  adjustment: z.object({
    type: z.enum(ADJUSTMENT_TYPES),
    value: z.number().nullable().default(null),
  }),
});

export const restrictionSchema = z.object({
  connectionIds: z.array(id).min(1),
  roomTypeIds: z.array(id).default([]),
  startDate: date,
  endDate: date,
  daysOfWeek: z.array(z.enum(WEEKDAYS)).default([]),
  closed: z.boolean().nullable().default(null),
  minStay: z.number().int().nullable().default(null),
});

export const markupSchema = z.object({
  connectionId: id,
  roomTypeId: id.nullable().default(null),
  markupPercent: z.number(),
});

export const promotionFieldsSchema = z.object({
  name: z.string().min(1).max(100),
  type: z.enum(['BASIC', 'EARLY_BOOKER', 'LAST_MINUTE', 'MULTI_NIGHT']),
  discountPercent: z.number(),
  stayStart: date,
  stayEnd: date,
  bookStart: date.nullable().default(null),
  bookEnd: date.nullable().default(null),
  minStay: z.number().int().nullable().default(null),
  minDaysInAdvance: z.number().int().nullable().default(null),
  maxDaysInAdvance: z.number().int().nullable().default(null),
  roomTypeIds: z.array(id).default([]),
});

export const createPromotionSchema = promotionFieldsSchema.extend({
  connectionIds: z.array(id).min(1),
});

export const updatePromotionSchema = z.object({
  promotionId: id,
  name: z.string().min(1).max(100).nullable().default(null),
  discountPercent: z.number().nullable().default(null),
  stayStart: date.nullable().default(null),
  stayEnd: date.nullable().default(null),
  bookStart: date.nullable().default(null),
  bookEnd: date.nullable().default(null),
  minStay: z.number().int().nullable().default(null),
  active: z.boolean().nullable().default(null),
});

export const mappingsSchema = z.object({
  mappings: z.array(
    z.object({
      roomTypeId: id,
      otaRoomTypeId: id,
      otaRoomTypeName: z.string().nullable().optional(),
      otaRatePlanId: id,
      otaRatePlanName: z.string().nullable().optional(),
      markupPercent: z.number().nullable().default(null),
      inventoryAllocation: z.number().int().nullable().default(null),
      isActive: z.boolean().default(true),
    })
  ),
});

export const connectionSettingsSchema = z.object({
  mode: z.enum(['SANDBOX', 'LIVE']).optional(),
  otaPropertyId: z.string().max(50).optional(),
  username: z.string().max(200).optional(),
  password: z.string().max(500).optional(),
  currency: z.string().length(3).optional(),
  defaultMarkupPercent: z.number().optional(),
  syncRates: z.boolean().optional(),
  syncAvailability: z.boolean().optional(),
  importReservations: z.boolean().optional(),
  syncWindowDays: z.number().int().optional(),
});

/** Formats the first zod issue as a readable message */
export function zodMessage(error: z.ZodError): string {
  const issue = error.issues[0];
  return issue ? `${issue.path.join('.') || 'request'}: ${issue.message}` : 'Invalid request';
}
