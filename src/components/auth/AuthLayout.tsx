import Link from 'next/link';
import { Logo, LogoMark } from '@/components/brand/Logo';
import { PRODUCT_NAME, PRODUCT_SUPPORT_EMAIL } from '@/config/product';

const footLink =
  'rounded-sm py-1 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background';

/**
 * Split auth layout: the form on the left (the page's <main>), a brand panel
 * on the right from lg up. `aside` is the panel's story; its text inherits
 * the inverse foreground colour.
 */
export function AuthLayout({ children, aside }: { children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh bg-background lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <div className="flex min-w-0 flex-col px-4 py-6 sm:px-10 sm:py-8">
        <header>
          <Link
            href="/"
            className="inline-flex rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            aria-label={`${PRODUCT_NAME} home`}
          >
            <Logo />
          </Link>
        </header>

        <main id="main" className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-10 sm:py-12">
          {children}
        </main>

        <footer className="flex flex-col gap-1.5 text-xs text-muted-foreground sm:flex-row sm:items-center sm:gap-3">
          <span>
            © {new Date().getFullYear()} {PRODUCT_NAME}
          </span>
          <span aria-hidden className="hidden sm:inline">
            ·
          </span>
          <nav aria-label="Footer" className="flex flex-wrap items-center gap-x-3">
            <Link href="/about" className={footLink}>
              About
            </Link>
            <span aria-hidden>·</span>
            <Link href="/contact" className={footLink}>
              Contact
            </Link>
            <span aria-hidden>·</span>
            <a href={`mailto:${PRODUCT_SUPPORT_EMAIL}`} className={footLink}>
              {PRODUCT_SUPPORT_EMAIL}
            </a>
          </nav>
        </footer>
      </div>

      <aside className="relative hidden overflow-hidden bg-inverse text-inverse-foreground lg:block" aria-label={`About ${PRODUCT_NAME}`}>
        {/* Lagoon glow and a large crop of the keyhole mark. Decorative. */}
        <div
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_85%_10%,hsl(var(--primary)/0.55),transparent_55%),radial-gradient(circle_at_0%_100%,hsl(var(--highlight)/0.14),transparent_45%)]"
          aria-hidden
        />
        <LogoMark className="pointer-events-none absolute -right-20 -top-20 h-[26rem] w-[26rem] drop-shadow-2xl xl:h-[30rem] xl:w-[30rem]" />
        <div className="relative flex h-full flex-col justify-end p-12 xl:p-16">
          <div className="mb-8 h-1 w-14 rounded-full bg-highlight" aria-hidden />
          {aside}
        </div>
      </aside>
    </div>
  );
}
