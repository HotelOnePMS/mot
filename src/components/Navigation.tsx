'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { signOut, useSession } from 'next-auth/react';
import { ArrowRight, BedDouble, CalendarCheck2, LayoutDashboard, LogIn, LogOut, Menu, Search, UserRound, X, type LucideIcon } from 'lucide-react';
import { isStaffRole, loginUrl, signOutTarget } from '@/lib/routes';
import { cn } from '@/lib/utils';
import { PRODUCT_NAME } from '@/config/product';
import { LABELS, TERMS } from '@/config/copy';
import { Button } from '@/components/ui/button';
import { Avatar } from '@/components/ui/primitives';
import { Logo } from '@/components/brand/Logo';
import { brandScope } from '@/components/guest/brand';
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

type NavLink = { href: string; label: string; icon?: LucideIcon; auth?: boolean };

const CONSOLE: NavLink = { href: '/admin', label: LABELS.console, icon: LayoutDashboard };
const MY_TRIPS: NavLink = { href: '/dashboard', label: LABELS.myTrips, icon: CalendarCheck2, auth: true };
const PROFILE: NavLink = { href: '/profile', label: LABELS.profile, icon: UserRound };

const MARKETING_LINKS: NavLink[] = [
  { href: '/#features', label: 'Features' },
  { href: '/#agent', label: TERMS.agent },
  { href: '/#pricing', label: 'Pricing' },
  { href: '/demo', label: LABELS.demo },
  { href: '/contact', label: LABELS.contact },
];
const GUEST_LINKS: NavLink[] = [{ href: '/properties', label: LABELS.findStay, icon: Search }, MY_TRIPS];

/** In-page anchors are never "current"; routes match themselves and their children. */
function isActive(pathname: string, href: string) {
  if (href.includes('#')) return false;
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Clicks the browser should handle itself (new tab, new window, download). */
function isModifiedClick(e: React.MouseEvent) {
  return e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey;
}

/** Sign-up carries the same return path as sign-in. */
const registerUrl = (returnTo: string) => loginUrl(returnTo).replace(/^\/login/, '/register');

const drawerLink =
  'flex min-h-11 items-center gap-3 rounded-lg px-3 text-base font-medium transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

const brandName = 'min-w-0 shrink truncate font-display text-xl tracking-tight text-brand';

/**
 * Site navigation. `marketing` is the product site (for hotels); `guest`
 * is the booking experience (for travellers). With `brand`, the guest header
 * belongs to one hotel and never links to other hotels.
 */
export default function Navigation({
  variant = 'guest',
  className,
  brand,
  brandColor,
}: {
  variant?: 'marketing' | 'guest';
  className?: string;
  /** White-label: show the hotel's name instead of the platform logo. */
  brand?: { name: string; href: string };
  /** The hotel's colour, for the drawer (it renders outside the page's brand scope). */
  brandColor?: string | null;
}) {
  const { data: session, status } = useSession();
  const pathname = usePathname() ?? '/';
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [scrolled, setScrolled] = React.useState(false);
  const user = session?.user;
  const staff = isStaffRole(user?.role);
  const marketing = variant === 'marketing';
  // Signed-out buttons hold their place while the session loads, so nothing jumps.
  const pending = status === 'loading';

  React.useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Close the drawer when the route changes (e.g. back/forward).
  React.useEffect(() => setOpen(false), [pathname]);

  // A hotel's own pages link to its rooms, never to the directory of other hotels.
  const variantLinks: NavLink[] = marketing
    ? MARKETING_LINKS
    : brand
      ? [{ href: `${brand.href}#rooms`, label: 'Rooms', icon: BedDouble }, MY_TRIPS]
      : GUEST_LINKS;
  const links = variantLinks.filter((l) => !l.auth || user);
  // Staff see their work first and their own trips apart; the drawer shows the same groups.
  const accountGroups = staff ? [[CONSOLE, PROFILE], [MY_TRIPS]] : [[MY_TRIPS, PROFILE]];
  const drawerGroups = accountGroups.map((g) => g.filter((item) => !links.some((l) => l.href === item.href))).filter((g) => g.length);
  // The five marketing links need more room than the guest pair before they fit inline.
  const desktop = marketing ? 'lg' : 'md';

  // Product pages sign in to each person's own home; guest pages come back here.
  const loginHref = marketing ? '/login' : loginUrl(pathname);

  /**
   * Guest sign-in and sign-up return to the page with its query (a hotel
   * page's dates change without a route change), so the URL is read at click
   * time. The href stays for new tabs and no-JS.
   */
  const withReturn = (build: (here: string) => string) => (e: React.MouseEvent<HTMLAnchorElement>) => {
    setOpen(false);
    if (isModifiedClick(e)) return;
    e.preventDefault();
    router.push(build(window.location.pathname + window.location.search));
  };
  const onSignIn = marketing ? () => setOpen(false) : withReturn(loginUrl);

  /** An anchor on the current page keeps the page's query instead of dropping it. */
  const onLinkClick = (href: string) => (e: React.MouseEvent<HTMLAnchorElement>) => {
    setOpen(false);
    const [path, hash] = href.split('#');
    if (hash === undefined || path !== window.location.pathname || isModifiedClick(e)) return;
    e.preventDefault();
    router.push(`${path}${window.location.search}#${hash}`);
  };

  const signOutHere = () =>
    signOut({ callbackUrl: signOutTarget(window.location.pathname + window.location.search, { role: user?.role, fallback: brand?.href }) });

  const drawerItem = (l: NavLink) => {
    const active = isActive(pathname, l.href);
    const Icon = l.icon;
    return (
      <Link
        key={l.href}
        href={l.href}
        onClick={onLinkClick(l.href)}
        aria-current={active ? 'page' : undefined}
        className={cn(drawerLink, active && 'bg-primary-soft text-primary-soft-foreground hover:bg-primary-soft')}
      >
        {Icon && <Icon className={cn('h-[18px] w-[18px]', active ? 'text-current' : 'text-muted-foreground')} aria-hidden />}
        {l.label}
      </Link>
    );
  };

  const drawerScope = brandScope(brand ? brandColor : null);

  return (
    <header
      className={cn(
        'sticky top-0 z-50 transition-[background-color,border-color,box-shadow] duration-300',
        scrolled ? 'glass border-b shadow-xs' : 'border-b border-transparent',
        className
      )}
    >
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-4 sm:px-6">
        {brand ? (
          <Link
            href={brand.href}
            className={cn(
              brandName,
              'rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background'
            )}
          >
            {brand.name}
          </Link>
        ) : (
          <Link
            href={marketing ? '/' : '/properties'}
            className="shrink-0 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            aria-label={marketing ? `${PRODUCT_NAME} home` : `${LABELS.findStay} — ${PRODUCT_NAME}`}
          >
            <Logo />
          </Link>
        )}

        <nav className={cn('ml-4 hidden items-center gap-1', desktop === 'lg' ? 'lg:flex' : 'md:flex')} aria-label="Main">
          {links.map((l) => {
            const active = isActive(pathname, l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                onClick={onLinkClick(l.href)}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'relative flex h-10 items-center rounded-lg px-3 text-sm font-medium transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  active
                    ? 'text-foreground after:absolute after:inset-x-3 after:-bottom-3 after:h-0.5 after:rounded-full after:bg-primary'
                    : 'text-muted-foreground'
                )}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          {user ? (
            <>
              {staff && (
                <Button asChild variant="outline" className="w-10 px-0 sm:w-auto sm:px-4">
                  <Link href={CONSOLE.href} aria-label={LABELS.console}>
                    <LayoutDashboard aria-hidden /> <span className="hidden sm:inline">{LABELS.console}</span>
                  </Link>
                </Button>
              )}
              {marketing && !staff && (
                <Button asChild variant="outline" className="hidden sm:inline-flex">
                  <Link href={MY_TRIPS.href}>
                    <CalendarCheck2 aria-hidden /> {LABELS.myTrips}
                  </Link>
                </Button>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    className="flex h-10 w-10 items-center justify-center rounded-full transition-shadow hover:ring-2 hover:ring-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                    aria-label={`Account menu for ${user.name ?? user.email ?? 'you'}`}
                  >
                    <Avatar name={user.name ?? user.email ?? 'You'} />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-60">
                  <DropdownMenuLabel className="font-normal">
                    <p className="truncate text-sm font-medium text-foreground">{user.name}</p>
                    <p className="truncate text-xs text-muted-foreground">{user.email}</p>
                  </DropdownMenuLabel>
                  {accountGroups.map((group, i) => (
                    <React.Fragment key={i}>
                      <DropdownMenuSeparator />
                      {group.map((item) => {
                        const Icon = item.icon;
                        return (
                          <DropdownMenuItem key={item.href} asChild>
                            <Link href={item.href}>
                              {Icon && <Icon className="h-4 w-4" aria-hidden />} {item.label}
                            </Link>
                          </DropdownMenuItem>
                        );
                      })}
                    </React.Fragment>
                  ))}
                  {/* Staff: My trips and Sign out share the last group. */}
                  {accountGroups.length === 1 && <DropdownMenuSeparator />}
                  <DropdownMenuItem onSelect={signOutHere}>
                    <LogOut className="h-4 w-4" aria-hidden /> {LABELS.signOut}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          ) : (
            <>
              <Button
                asChild
                variant={marketing ? 'ghost' : 'outline'}
                size="sm"
                className={cn('sm:h-10 sm:rounded-lg sm:px-4 sm:text-sm', pending && 'invisible')}
              >
                <Link href={loginHref} onClick={onSignIn}>
                  {LABELS.signIn}
                </Link>
              </Button>
              {marketing && (
                <Button asChild className={cn('hidden sm:inline-flex', pending && 'invisible')}>
                  <Link href="/onboarding">{LABELS.hotelSignup}</Link>
                </Button>
              )}
            </>
          )}

          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className={cn('-mr-2', desktop === 'lg' ? 'lg:hidden' : 'md:hidden')} aria-label="Open menu">
                <Menu className="h-5 w-5" aria-hidden />
              </Button>
            </SheetTrigger>
            <SheetContent
              side="right"
              hideClose
              style={drawerScope.style}
              className={cn('w-80 max-w-[88vw] gap-0 p-0', drawerScope.className)}
            >
              <div className="flex h-16 shrink-0 items-center justify-between gap-3 border-b pl-5 pr-3">
                {brand ? <span className={brandName}>{brand.name}</span> : <Logo />}
                <SheetClose asChild>
                  <Button variant="ghost" size="icon" className="shrink-0" aria-label="Close menu">
                    <X className="h-5 w-5" aria-hidden />
                  </Button>
                </SheetClose>
              </div>
              <SheetTitle className="sr-only">Menu</SheetTitle>
              <SheetDescription className="sr-only">Site navigation and account links</SheetDescription>

              <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
                {user && (
                  <div className="flex items-center gap-3 border-b px-5 py-4">
                    <Avatar name={user.name ?? user.email ?? 'You'} />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{user.name}</p>
                      <p className="truncate text-xs text-muted-foreground">{user.email}</p>
                    </div>
                  </div>
                )}

                <nav className="flex flex-col gap-0.5 p-3" aria-label="Mobile">
                  {links.map(drawerItem)}
                  {user && (
                    <>
                      {drawerGroups.map((group, i) => (
                        <React.Fragment key={i}>
                          <div className="mx-3 my-2 h-px bg-border" role="separator" />
                          {group.map(drawerItem)}
                        </React.Fragment>
                      ))}
                      <button type="button" onClick={signOutHere} className={cn(drawerLink, 'text-left')}>
                        <LogOut className="h-[18px] w-[18px] text-muted-foreground" aria-hidden /> {LABELS.signOut}
                      </button>
                    </>
                  )}
                </nav>
              </div>

              {!user && !pending && (
                <div className="grid gap-2 border-t p-4">
                  {marketing ? (
                    <>
                      <Button asChild size="lg" className="w-full">
                        <Link href="/onboarding" onClick={() => setOpen(false)}>
                          {LABELS.hotelSignup} <ArrowRight aria-hidden />
                        </Link>
                      </Button>
                      <Button asChild size="lg" variant="outline" className="w-full">
                        <Link href={loginHref} onClick={onSignIn}>
                          <LogIn aria-hidden /> {LABELS.signIn}
                        </Link>
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button asChild size="lg" variant="brand" className="w-full">
                        <Link href={loginHref} onClick={onSignIn}>
                          <LogIn aria-hidden /> {LABELS.signIn}
                        </Link>
                      </Button>
                      <p className="pt-1 text-center text-sm text-muted-foreground">
                        New here?{' '}
                        <Link
                          href={registerUrl(pathname)}
                          onClick={withReturn(registerUrl)}
                          className="inline-flex min-h-10 items-center rounded-sm font-medium text-brand underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          {LABELS.travellerSignup}
                        </Link>
                      </p>
                    </>
                  )}
                </div>
              )}
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}
