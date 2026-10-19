import Link from 'next/link';
import { Mail } from 'lucide-react';
import { cn } from '@/lib/utils';
import { telHref } from '@/lib/format';
import { Logo, LogoMark } from '@/components/brand/Logo';
import { PRODUCT_NAME, PRODUCT_SUPPORT_EMAIL } from '@/config/product';
import { LABELS, TERMS } from '@/config/copy';

type FooterLink = { href: string; label: string };

// Sign-in and sign-up live in the header: one place per action.
const COLUMNS: { title: string; links: FooterLink[] }[] = [
  {
    title: 'For hotels',
    links: [
      { href: '/#features', label: 'Features' },
      { href: '/#agent', label: TERMS.agent },
      { href: '/#pricing', label: 'Pricing' },
      { href: '/demo', label: LABELS.demo },
      { href: '/onboarding', label: LABELS.hotelSignup },
    ],
  },
  {
    title: 'For travellers',
    links: [
      { href: '/properties', label: LABELS.findStay },
      { href: '/assistants', label: `Book with ${TERMS.assistants}` },
      { href: '/dashboard', label: LABELS.myTrips },
    ],
  },
  {
    title: 'Company',
    links: [
      { href: '/about', label: 'About' },
      { href: '/developers/pms', label: 'For PMS partners' },
      { href: '/contact', label: LABELS.contact },
    ],
  },
];

const GUEST_LINKS: FooterLink[] = [
  { href: '/properties', label: LABELS.findStay },
  { href: '/dashboard', label: LABELS.myTrips },
  { href: '/profile', label: LABELS.profile },
  { href: '/contact', label: 'Help' },
];

/** On a hotel's own pages: the guest's trips and the hotel itself, never other hotels or platform help. */
function hotelLinks(hotel: FooterHotel): FooterLink[] {
  return [
    { href: '/dashboard', label: LABELS.myTrips },
    ...(hotel.phone ? [{ href: telHref(hotel.phone), label: `Call ${hotel.name}` }] : []),
    ...(hotel.email ? [{ href: `mailto:${hotel.email}`, label: `Email ${hotel.name}` }] : []),
  ];
}

const linkClass =
  'inline-flex min-h-10 items-center rounded-sm text-sm text-muted-foreground md:min-h-0 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface-sunken';

/** A hotel's contact details, for the footer of its own booking pages. */
export type FooterHotel = { name: string; phone?: string | null; email?: string | null };

/**
 * Site footer. `platform` (default) is the full product footer; `guest` is a
 * slim traveller footer for booking pages, with a small "Powered by" line.
 * With `hotel` (white-label pages) the guest footer offers the hotel's own
 * phone and email instead of platform links.
 */
export function SiteFooter({ variant = 'platform', className, hotel }: { variant?: 'platform' | 'guest'; className?: string; hotel?: FooterHotel }) {
  const year = new Date().getFullYear();

  if (variant === 'guest') {
    const links = hotel ? hotelLinks(hotel) : GUEST_LINKS;
    return (
      <footer className={cn('border-t bg-surface-sunken', className)}>
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-8 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <nav aria-label="Footer">
            <ul className="flex flex-wrap gap-x-6 gap-y-2">
              {links.map((l) => (
                <li key={l.href}>
                  {l.href.startsWith('/') ? (
                    <Link href={l.href} className={linkClass}>
                      {l.label}
                    </Link>
                  ) : (
                    <a href={l.href} className={linkClass}>
                      {l.label}
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </nav>
          <Link href="/" className={cn(linkClass, 'inline-flex items-center gap-2 text-xs')}>
            <LogoMark className="h-5 w-5" />
            Powered by {PRODUCT_NAME}
          </Link>
        </div>
      </footer>
    );
  }

  return (
    <footer className={cn('border-t bg-surface-sunken', className)}>
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-12 sm:px-6 md:py-16 lg:grid-cols-[1.5fr_2fr]">
        <div className="max-w-sm">
          <Link
            href="/"
            aria-label={`${PRODUCT_NAME} home`}
            className="inline-flex rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface-sunken"
          >
            <Logo />
          </Link>
          <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
            A booking site in your hotel’s name, an {TERMS.agent} and {TERMS.voice.toLowerCase()} that answer every call and chat, and one{' '}
            {LABELS.console.toLowerCase()} for all your channels.
          </p>
          <a
            href={`mailto:${PRODUCT_SUPPORT_EMAIL}`}
            className="mt-5 inline-flex min-h-10 items-center gap-2 rounded-lg border border-border-strong/40 bg-surface px-3 text-sm font-medium text-foreground shadow-xs transition-colors hover:border-border-strong hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface-sunken"
          >
            <Mail className="h-4 w-4 text-primary" aria-hidden />
            {PRODUCT_SUPPORT_EMAIL}
          </a>
        </div>

        <nav aria-label="Footer" className="grid grid-cols-2 gap-x-6 gap-y-10 sm:grid-cols-3">
          {COLUMNS.map((c) => (
            <div key={c.title}>
              <h2 className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">{c.title}</h2>
              <ul className="mt-4 space-y-3">
                {c.links.map((l) => (
                  <li key={l.href}>
                    <Link href={l.href} className={cn(linkClass, 'text-foreground/80')}>
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </div>

      <div className="border-t">
        <div className="mx-auto flex max-w-7xl flex-col gap-2 px-4 py-6 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p>
            © {year} {PRODUCT_NAME}. All rights reserved.
          </p>
          <p>Built for independent hotels, inns and motels.</p>
        </div>
      </div>
    </footer>
  );
}
