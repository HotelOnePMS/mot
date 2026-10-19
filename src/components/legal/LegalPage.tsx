import Link from 'next/link';
import Navigation from '@/components/Navigation';
import { SiteFooter } from '@/components/guest/SiteFooter';
import { PRODUCT_SUPPORT_EMAIL } from '@/config/product';

export type LegalSection = { id: string; title: string; body: React.ReactNode };

/** Last substantive edit of the legal pages (update when the text changes). */
export const LEGAL_UPDATED = 'October 18, 2026';

const OTHER_PAGES = [
  { href: '/terms', label: 'Terms of Service' },
  { href: '/privacy', label: 'Privacy Policy' },
  { href: '/cookies', label: 'Cookie Policy' },
];

/** Shared shell for the Terms, Privacy and Cookie pages: marketing nav and footer, readable prose, contents list. */
export function LegalPage({ title, intro, sections, current }: { title: string; intro: string; sections: LegalSection[]; current: string }) {
  return (
    <div className="relative flex min-h-dvh flex-col overflow-x-clip bg-background">
      <Navigation variant="marketing" />
      <main id="main" className="relative flex-1">
        <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-16">
          <p className="text-2xs font-semibold uppercase tracking-[0.18em] text-primary">Legal</p>
          <h1 className="mt-3 font-display text-4xl font-medium tracking-tight sm:text-5xl">{title}</h1>
          <p className="mt-3 text-sm text-muted-foreground">Last updated {LEGAL_UPDATED}</p>
          <p className="mt-6 text-pretty text-lg leading-relaxed text-muted-foreground">{intro}</p>

          <nav aria-label="Contents" className="mt-8 rounded-2xl border bg-card p-5 shadow-xs">
            <h2 className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">On this page</h2>
            <ol className="mt-3 grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
              {sections.map((s, i) => (
                <li key={s.id}>
                  <a href={`#${s.id}`} className="rounded-sm text-foreground/80 underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    {i + 1}. {s.title}
                  </a>
                </li>
              ))}
            </ol>
          </nav>

          <div className="mt-10 space-y-10">
            {sections.map((s, i) => (
              <section key={s.id} id={s.id} aria-labelledby={`${s.id}-h`} className="scroll-mt-24">
                <h2 id={`${s.id}-h`} className="font-display text-2xl font-medium tracking-tight">
                  {i + 1}. {s.title}
                </h2>
                <div className="mt-3 space-y-3 text-[15px] leading-relaxed text-foreground/85 [&_a]:font-medium [&_a]:text-primary [&_a]:underline-offset-4 hover:[&_a]:underline [&_li]:pl-1 [&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:pl-5">
                  {s.body}
                </div>
              </section>
            ))}
          </div>

          <div className="mt-14 rounded-2xl border bg-surface-sunken p-5 text-sm leading-relaxed text-muted-foreground">
            Questions about this page? Email{' '}
            <a href={`mailto:${PRODUCT_SUPPORT_EMAIL}`} className="font-medium text-primary underline-offset-4 hover:underline">
              {PRODUCT_SUPPORT_EMAIL}
            </a>
            .
            <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
              {OTHER_PAGES.filter((p) => p.href !== current).map((p) => (
                <Link key={p.href} href={p.href} className="font-medium text-foreground/80 underline-offset-4 hover:underline">
                  {p.label}
                </Link>
              ))}
            </p>
          </div>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
