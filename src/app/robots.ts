import type { MetadataRoute } from 'next';
import { siteUrl } from '@/components/brand/site-url';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/', '/assistants'],
        disallow: ['/admin', '/api', '/dashboard', '/profile', '/bookings', '/onboarding'],
      },
    ],
    sitemap: `${siteUrl()}/sitemap.xml`,
  };
}
