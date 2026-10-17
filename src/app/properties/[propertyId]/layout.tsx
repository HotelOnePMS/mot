import type { Metadata } from 'next';
import { getPropertyMeta } from '../_lib/property-meta';
import { PropertyShellProvider } from '../_components/property-shell';

type Props = { params: Promise<{ propertyId: string }> };

/** One line for search results and link previews (≈155 characters). */
function summary(p: { tagline: string | null; description: string | null; name: string; city: string; state: string }): string {
  const text = [p.tagline, p.description].filter(Boolean).join(' — ').replace(/\s+/g, ' ').trim();
  const fallback = `Book ${p.name} in ${p.city}, ${p.state} direct: live prices, instant confirmation and free changes until the day before.`;
  const out = text || fallback;
  return out.length > 158 ? `${out.slice(0, 155).replace(/\s+\S*$/, '')}…` : out;
}

/**
 * A hotel's booking site is white-labeled: its pages are titled with the
 * hotel's name (no platform suffix) and preview with the hotel's own photo.
 */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { propertyId } = await params;
  const p = await getPropertyMeta(propertyId);
  if (!p) {
    return { title: 'Hotel not found', robots: { index: false } };
  }
  const title = `${p.name} · ${p.city} — Book direct`;
  const description = summary(p);
  const photo = p.photos[0]?.url;
  const images = photo ? [{ url: photo, alt: p.name }] : undefined;
  return {
    title: { absolute: title, template: `%s · ${p.name}` },
    description,
    alternates: { canonical: `/properties/${p.id}` },
    openGraph: {
      type: 'website',
      siteName: p.name,
      title,
      description,
      url: `/properties/${p.id}`,
      ...(images ? { images } : {}),
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      ...(images ? { images } : {}),
    },
  };
}

export default async function PropertyLayout({ children, params }: Props & { children: React.ReactNode }) {
  const { propertyId } = await params;
  const p = await getPropertyMeta(propertyId);
  return (
    <PropertyShellProvider
      value={
        p
          ? { id: p.id, name: p.name, city: p.city, state: p.state, type: p.type, tagline: p.tagline, primaryColor: p.primaryColor, isDemo: p.isDemo }
          : null
      }
    >
      {children}
    </PropertyShellProvider>
  );
}
