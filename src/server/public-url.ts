/**
 * The public address set explicitly for this deployment: HOTELONE_PUBLIC_URL,
 * or STAYOS_PUBLIC_URL (the name from before the rename, still accepted).
 */
export function configuredPublicUrl(): string | null {
  return process.env.HOTELONE_PUBLIC_URL || process.env.STAYOS_PUBLIC_URL || null;
}

/**
 * This deployment's public origin, for links we hand out (booking links in
 * staff messages) and for callbacks (phone webhooks): HOTELONE_PUBLIC_URL
 * (or STAYOS_PUBLIC_URL), else NEXT_PUBLIC_SITE_URL, else the Vercel
 * production domain (or this preview's URL), else NEXTAUTH_URL. Null when
 * none is known.
 */
export function publicSiteUrl(): string | null {
  const vercel = process.env.VERCEL_ENV === 'production' ? process.env.VERCEL_PROJECT_PRODUCTION_URL : process.env.VERCEL_URL;
  const base = configuredPublicUrl() || process.env.NEXT_PUBLIC_SITE_URL || (vercel ? `https://${vercel}` : process.env.NEXTAUTH_URL) || '';
  return base ? base.replace(/\/$/, '') : null;
}
