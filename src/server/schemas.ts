import { z } from 'zod';

export const propertySchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(4000).optional().nullable(),
  address: z.string().trim().min(3).max(200),
  city: z.string().trim().min(1).max(100),
  state: z.string().trim().min(1).max(100),
  zipCode: z.string().trim().min(2).max(20),
  phone: z.string().trim().min(5).max(40),
  email: z.string().trim().email().optional().nullable().or(z.literal('')),
  amenities: z.array(z.string().trim().min(1).max(60)).max(60).optional(),
  tagline: z.string().trim().max(160).optional().nullable(),
  primaryColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'must be a hex color like #0E7490')
    .optional()
    .nullable()
    .or(z.literal('')),
  type: z.enum(['Hotel', 'Motel', 'Inn', 'B&B', 'Boutique', 'Other']).optional().nullable(),
  isActive: z.boolean().optional(),
});


/**
 * True for a public https:// address. The cloud bridge opens PMS sign-in pages
 * in a browser on our infrastructure, so it must never be pointed at files,
 * internal hostnames or IP literals.
 */
export function isPublicHttpsUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || /\.(localhost|local|internal|lan|home|corp)$/.test(host)) return false;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith('[')) return false;
  return host.includes('.');
}

/**
 * A PMS sign-in page (optional), http(s) only. Desktop connectors may open a
 * PMS on the hotel's own network; the cloud browser needs a public https://
 * address — see cloudLoginUrlIssue.
 */
export const pmsLoginUrlSchema = z
  .string()
  .trim()
  .max(500)
  .refine((v) => /^https?:\/\//i.test(v) && URL.canParse(v), 'must be a full https:// address')
  .nullable()
  .optional()
  .or(z.literal(''));

export function cloudLoginUrlIssue(mode: string, loginUrl: string | null | undefined): string | null {
  if (mode !== 'CLOUD' || !loginUrl) return null;
  return isPublicHttpsUrl(loginUrl) ? null : 'The cloud browser can only open public https:// sign-in pages.';
}
