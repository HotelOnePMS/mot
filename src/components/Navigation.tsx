'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOut, useSession } from 'next-auth/react';
import { ArrowRight, CalendarCheck2, LayoutDashboard, LogIn, LogOut, Menu, Search, UserRound, X, type LucideIcon } from 'lucide-react';
import { isStaffRole } from '@/lib/routes';
import { cn } from '@/lib/utils';
import { PRODUCT_NAME } from '@/config/product';
import { Button } from '@/components/ui/button';
import { Avatar } from '@/components/ui/primitives';
import { Logo } from '@/components/brand/Logo';
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

type NavLink = { href: string; label: string; icon?: LucideIcon; auth?: boolean };

const MARKETING_LINKS: NavLink[] = [
  { href: '/#agent', label: 'The agent' },
  { href: '/#features', label: 'Features' },
  { href: '/#how-it-works', label: 'How it works' },
  { href: '/#pricing', label: 'Pricing' },
  { href: '/properties', label: 'Guest demo' },
];
const GUEST_LINKS: NavLink[] = [
  { href: '/properties', label: 'Find a stay', icon: Search },
  { href: '/dashboard', label: 'My trips', icon: CalendarCheck2, auth: true },
];

/** In-page anchors are never "current"; routes match themselves and their children. */
function isActive(pathname: string, href: string) {
  if (href.includes('#')) return false;
  return pathname === href || pathname.startsWith(`${href}/`);
}

const drawerLink =
  'flex min-h-11 items-center gap-3 rounded-lg px-3 text-base font-medium transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

/**
 * Site navigation. `marketing` is the product site (for hotels); `guest`
 * is the booking experience (for travellers).
 */
export default function Navigation({
  variant = 'guest',
  className,
  brand,
}: {
  variant?: 'marketing' | 'guest';
  className?: string;
  /** White-label: show the hotel's name instead of the platform logo. */
  brand?: { name: string; href: string };
}) {
  const { data: session, status } = useSession();
  const pathname = usePathname() ?? '/';
  const [open, setOpen] = React.useState(false);
  const [scrolled, setScrolled] = React.useState(false);
  const user = session?.user;
  const staff = isStaffRole(user?.role);
  const marketing = variant === 'marketing';

  React.useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Close the drawer when the route changes (e.g. back/forward).
  React.useEffect(() => setOpen(false), [pathname]);

  const links = (marketing ? MARKETING_LINKS : GUEST_LINKS).filter((l) => !l.auth || user);
  const loginHref = `/login${pathname && pathname !== '/' && !pathname.startsWith('/login') ? `?callbackUrl=${encodeURIComponent(pathname)}` : ''}`;
  const signupHref = marketing ? '/onboarding' : '/register';
  const signupLabel = marketing ? 'Start free' : 'Create account';
  // The five marketing links need more room than the guest pair before they fit inline.
  const desktop = marketing ? 'lg' : 'md';

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
            className="min-w-0 shrink truncate rounded-md font-display text-xl tracking-tight text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            {brand.name}
          </Link>
        ) : (
          <Link
            href="/"
            className="shrink-0 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            aria-label={`${PRODUCT_NAME} home`}
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
          {status === 'loading' ? (
            <div className={cn('h-10 animate-pulse rounded-lg bg-muted', marketing ? 'w-24 sm:w-44' : 'hidden w-48 sm:block')} aria-hidden />
          ) : user ? (
            <>
              {staff && (
                <Button asChild variant="outline" className="hidden sm:inline-flex">
                  <Link href="/admin">
                    <LayoutDashboard aria-hidden /> Hotel console
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
                  <DropdownMenuSeparator />
                  {staff && (
                    <DropdownMenuItem asChild>
                      <Link href="/admin">
                        <LayoutDashboard className="h-4 w-4" aria-hidden /> Hotel console
                      </Link>
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem asChild>
                    <Link href="/dashboard">
                      <CalendarCheck2 className="h-4 w-4" aria-hidden /> My trips
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href="/profile">
                      <UserRound className="h-4 w-4" aria-hidden /> Profile
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => signOut({ callbackUrl: '/' })}>
                    <LogOut className="h-4 w-4" aria-hidden /> Sign out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          ) : (
            <>
              <Button asChild variant="ghost" className="hidden sm:inline-flex">
                <Link href={loginHref}>Sign in</Link>
              </Button>
              <Button asChild variant={marketing ? 'default' : 'outline'} className={cn(!marketing && 'hidden sm:inline-flex')}>
                <Link href={signupHref}>{signupLabel}</Link>
              </Button>
            </>
          )}

          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className={cn('-mr-2', desktop === 'lg' ? 'lg:hidden' : 'md:hidden')} aria-label="Open menu">
                <Menu className="h-5 w-5" aria-hidden />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" hideClose className="w-80 max-w-[88vw] gap-0 p-0">
              <div className="flex h-16 shrink-0 items-center justify-between border-b pl-5 pr-3">
                <Logo />
                <SheetClose asChild>
                  <Button variant="ghost" size="icon" aria-label="Close menu">
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
                  {links.map((l) => {
                    const active = isActive(pathname, l.href);
                    const Icon = l.icon;
                    return (
                      <Link
                        key={l.href}
                        href={l.href}
                        onClick={() => setOpen(false)}
                        aria-current={active ? 'page' : undefined}
                        className={cn(drawerLink, active && 'bg-primary-soft text-primary-soft-foreground hover:bg-primary-soft')}
                      >
                        {Icon && <Icon className={cn('h-[18px] w-[18px]', active ? 'text-current' : 'text-muted-foreground')} aria-hidden />}
                        {l.label}
                      </Link>
                    );
                  })}
                  {user && (
                    <>
                      <div className="mx-3 my-2 h-px bg-border" role="separator" />
                      {staff && (
                        <Link href="/admin" onClick={() => setOpen(false)} className={drawerLink}>
                          <LayoutDashboard className="h-[18px] w-[18px] text-muted-foreground" aria-hidden /> Hotel console
                        </Link>
                      )}
                      {!links.some((l) => l.href === '/dashboard') && (
                        <Link href="/dashboard" onClick={() => setOpen(false)} aria-current={isActive(pathname, '/dashboard') ? 'page' : undefined} className={drawerLink}>
                          <CalendarCheck2 className="h-[18px] w-[18px] text-muted-foreground" aria-hidden /> My trips
                        </Link>
                      )}
                      <Link href="/profile" onClick={() => setOpen(false)} aria-current={isActive(pathname, '/profile') ? 'page' : undefined} className={drawerLink}>
                        <UserRound className="h-[18px] w-[18px] text-muted-foreground" aria-hidden /> Profile
                      </Link>
                      <button type="button" onClick={() => signOut({ callbackUrl: '/' })} className={cn(drawerLink, 'text-left')}>
                        <LogOut className="h-[18px] w-[18px] text-muted-foreground" aria-hidden /> Sign out
                      </button>
                    </>
                  )}
                </nav>
              </div>

              {!user && status !== 'loading' && (
                <div className="grid gap-2 border-t p-4">
                  <Button asChild size="lg" className="w-full">
                    <Link href={signupHref} onClick={() => setOpen(false)}>
                      {marketing ? 'Set up your hotel' : 'Create account'} <ArrowRight aria-hidden />
                    </Link>
                  </Button>
                  <Button asChild size="lg" variant="outline" className="w-full">
                    <Link href={loginHref} onClick={() => setOpen(false)}>
                      <LogIn aria-hidden /> Sign in
                    </Link>
                  </Button>
                </div>
              )}
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}
