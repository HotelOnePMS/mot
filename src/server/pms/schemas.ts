/** Request schemas for the PMS console routes. */
import { z } from 'zod';

export const mcpAuthSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('none') }),
  z.object({ type: z.literal('bearer'), token: z.string().trim().max(4096).optional() }),
  z.object({ type: z.literal('header'), headerName: z.string().trim().min(1).max(64), token: z.string().trim().max(4096).optional() }),
]);

export const mcpUrlSchema = z
  .string()
  .trim()
  .min(8)
  .max(2000)
  .refine((v) => /^https?:\/\//i.test(v) && URL.canParse(v), 'must be a full https:// address');

export const connectSchema = z.object({
  propertyId: z.string().min(1),
  system: z.string().trim().min(2).max(60),
  url: mcpUrlSchema,
  auth: mcpAuthSchema,
});

export const testSchema = z.object({
  propertyId: z.string().min(1),
  url: mcpUrlSchema.optional(),
  auth: mcpAuthSchema.optional(),
});

export const propertyOnlySchema = z.object({ propertyId: z.string().min(1) });
