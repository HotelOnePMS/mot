import type { MetadataRoute } from 'next';
import { prisma } from '@/lib/prisma';
import { siteUrl } from '@/components/brand/site-url';
import { DIRECTORY_PROPERTY } from '@/server/concierge/facts';

export const revalidate = 3600;

const STATIC_PAGES: { path: string; priority: number; changeFrequency: MetadataRoute.Sitemap[number]['changeFrequency'] }[] = [
  { path: '/', priority: 1, changeFrequency: 'weekly' },
  { path: '/properties', priority: 0.9, changeFrequency: 'daily' },
  { path: '/assistants', priority: 0.6, changeFrequency: 'monthly' },
  { path: '/about', priority: 0.5, changeFrequency: 'monthly' },
  { path: '/developers/pms', priority: 0.4, changeFrequency: 'monthly' },
  { path: '/contact', priority: 0.5, changeFrequency: 'monthly' },
  { path: '/terms', priority: 0.3, changeFrequency: 'yearly' },
  { path: '/privacy', priority: 0.3, changeFrequency: 'yearly' },
  { path: '/cookies', priority: 0.2, changeFrequency: 'yearly' },
  { path: '/login', priority: 0.3, changeFrequency: 'yearly' },
  { path: '/register', priority: 0.3, changeFrequency: 'yearly' },
];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteUrl();
  const now = new Date();
  const pages: MetadataRoute.Sitemap = STATIC_PAGES.map((p) => ({
    url: `${base}${p.path === '/' ? '' : p.path}`,
    lastModified: now,
    changeFrequency: p.changeFrequency,
    priority: p.priority,
  }));

  try {
    // Same rule as the public directory (/api/properties): listed properties that can take bookings.
    const properties = await prisma.property.findMany({
      where: DIRECTORY_PROPERTY,
      select: { id: true, updatedAt: true },
      orderBy: { createdAt: 'asc' },
      take: 5000,
    });
    return [
      ...pages,
      ...properties.map((p) => ({
        url: `${base}/properties/${p.id}`,
        lastModified: p.updatedAt,
        changeFrequency: 'daily' as const,
        priority: 0.8,
      })),
    ];
  } catch {
    // A database hiccup shouldn't take the sitemap down; serve the static pages.
    return pages;
  }
}
