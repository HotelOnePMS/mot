import { PRODUCT_URL } from '@/config/product';

/**
 * The canonical public origin for metadata, robots and the sitemap:
 * NEXT_PUBLIC_SITE_URL when it's a valid URL (preview deploys, local),
 * otherwise the product domain. No trailing slash.
 */
export function siteUrl(): string {
  const raw = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (raw) {
    try {
      return new URL(raw).origin;
    } catch {
      // Ignore a malformed value and fall back to the product domain.
    }
  }
  return PRODUCT_URL;
}
