'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { signOut } from 'next-auth/react';
import { useTheme } from 'next-themes';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  Check,
  ChevronRight,
  ChevronsUpDown,
  ExternalLink,
  LogOut,
  Menu,
  Monitor,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Sparkles,
  Sun,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { roleLabel } from '@/lib/status';
import { Logo, LogoMark } from '@/components/brand/Logo';
import { Badge } from '@/components/ui/badge';
import { Button, IconButton } from '@/components/ui/button';
import { Avatar, Kbd, Skeleton } from '@/components/ui/primitives';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useConsole } from './ConsoleProvider';
import { ModeSwitch } from './ModeSwitch';
import { navFor, titleFor, type NavGroup } from './nav';
import { CommandSheet } from './CommandSheet';
import { ApiError } from '@/lib/fetcher';

// Per-viewer convenience only: whether the Classic sidebar is narrowed to icons.
const SIDEBAR_KEY = 'stayos:sidebar-collapsed';

/** "⌘" on Apple devices, "Ctrl" elsewhere (null until mounted, to keep SSR stable). */
function useModKey(): string | null {
  const [key, setKey] = React.useState<string | null>(null);
  React.useEffect(() => {
    const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
    const platform = nav.userAgentData?.platform ?? nav.platform ?? nav.userAgent;
    setKey(/mac|iphone|ipad|ipod/i.test(platform) ? '⌘' : 'Ctrl');
  }, []);
  return key;
}

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(href + '/');
}

function NavList({
  groups,
  collapsed,
  onNavigate,
  touch,
}: {
  groups: NavGroup[];
  collapsed?: boolean;
  onNavigate?: () => void;
  /** Taller rows for the phone drawer. */
  touch?: boolean;
}) {
  const pathname = usePathname();
  const reduce = useReducedMotion();
  const uid = React.useId();
  return (
    <nav className={cn('flex flex-col', collapsed ? 'gap-0' : 'gap-5')} aria-label="Console">
      {groups.map((g, gi) => {
        const labelId = `${uid}-${gi}`;
        return (
          <div key={g.label}>
            {collapsed ? (
              gi > 0 && <div className="mx-auto my-2.5 h-px w-8 bg-border" aria-hidden />
            ) : (
              <p id={labelId} className="mb-1 px-3 text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
                {g.label}
              </p>
            )}
            <ul className="flex flex-col gap-0.5" aria-labelledby={collapsed ? undefined : labelId} aria-label={collapsed ? g.label : undefined}>
              {g.items.map((item) => {
                const active = isActive(pathname, item.href);
                const Icon = item.icon;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'group relative flex items-center gap-3 rounded-lg px-3 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface',
                        touch ? 'h-11' : 'h-10',
                        collapsed && 'mx-auto w-11 justify-center px-0',
                        active ? 'bg-primary-soft text-primary-soft-foreground' : 'text-foreground hover:bg-accent'
                      )}
                    >
                      {active && (
                        <motion.span
                          layoutId={`nav-active${touch ? '-drawer' : ''}`}
                          transition={reduce ? { duration: 0 } : { type: 'spring', bounce: 0.15, duration: 0.4 }}
                          className="absolute inset-y-2 left-0 w-[3px] rounded-full bg-primary"
                          aria-hidden
                        />
                      )}
                      <Icon
                        aria-hidden
                        className={cn(
                          'size-[18px] shrink-0',
                          active ? 'text-primary-soft-foreground' : item.agent ? 'text-agent' : 'text-muted-foreground group-hover:text-foreground'
                        )}
                      />
                      {collapsed ? (
                        <>
                          <span className="sr-only">{item.label}</span>
                          {/* Visible tooltip for the icon rail (the link itself carries the name). */}
                          <span
                            aria-hidden
                            className="pointer-events-none absolute left-full top-1/2 z-50 ml-3 -translate-y-1/2 whitespace-nowrap rounded-md bg-foreground px-2.5 py-1.5 text-xs font-medium text-background opacity-0 shadow-lifted transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100"
                          >
                            {item.label}
                          </span>
                        </>
                      ) : (
                        <span className="truncate">{item.label}</span>
                      )}
                      {!collapsed && item.agent && (
                        <Badge variant="agent" size="sm" className="ml-auto">
                          AI
                        </Badge>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}

function Swatch({ color }: { color: string | null }) {
  return (
    <span
      className="size-2.5 shrink-0 rounded-full ring-2 ring-background"
      style={{ backgroundColor: color ?? 'hsl(var(--primary))' }}
      aria-hidden
    />
  );
}

function PropertySwitcher({ className }: { className?: string }) {
  const { ctx, property, setPropertyId, can } = useConsole();
  const router = useRouter();
  if (!ctx || !property) return <Skeleton className={cn('h-10 w-44 rounded-lg', className)} />;
  const single = ctx.properties.length === 1;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`${property.name}${property.isDemo ? ' (demo)' : ''}: ${single ? 'property menu' : 'switch property'}`}
          className={cn(
            'flex h-10 min-w-0 max-w-[240px] items-center lg:max-w-[320px] gap-2 rounded-lg border border-border bg-surface px-3 text-sm font-medium shadow-xs transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
            className
          )}
        >
          <Swatch color={property.primaryColor} />
          <span className="truncate">{property.name}</span>
          {property.isDemo && (
            <Badge variant="neutral" size="sm" className="hidden sm:inline-flex">
              Demo
            </Badge>
          )}
          <ChevronsUpDown className="ml-auto size-4 shrink-0 text-muted-foreground" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>{single ? 'Your property' : 'Switch property'}</DropdownMenuLabel>
        {ctx.properties.map((p) => (
          <DropdownMenuItem key={p.id} onSelect={() => setPropertyId(p.id)}>
            <Swatch color={p.primaryColor} />
            <span className="flex-1 truncate">
              {p.name}
              <span className="block text-xs text-muted-foreground">
                {p.city}, {p.state}
              </span>
            </span>
            {p.id === property.id && (
              <>
                <Check className="!text-primary" aria-hidden />
                <span className="sr-only">(current)</span>
              </>
            )}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => window.open(`/properties/${property.id}`, '_blank', 'noopener')}>
          <ExternalLink aria-hidden /> View booking site
        </DropdownMenuItem>
        {can('property.create') && (
          <DropdownMenuItem onSelect={() => router.push('/admin/properties/add')}>
            <Plus aria-hidden /> Add a property
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function UserMenu() {
  const { ctx } = useConsole();
  const { theme, setTheme } = useTheme();
  if (!ctx) return <Skeleton className="size-10 rounded-full" />;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex size-10 items-center justify-center rounded-full transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          aria-label={`Account menu for ${ctx.user.name}`}
        >
          <Avatar name={ctx.user.name} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <div className="px-2.5 py-2">
          <p className="truncate text-sm font-medium">{ctx.user.name}</p>
          <p className="truncate text-xs text-muted-foreground">
            {roleLabel(ctx.user.role)} · {ctx.user.email}
          </p>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Theme</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={theme ?? 'system'} onValueChange={setTheme}>
          <DropdownMenuRadioItem value="light">
            <Sun className="text-muted-foreground" aria-hidden /> Light
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark">
            <Moon className="text-muted-foreground" aria-hidden /> Dark
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="system">
            <Monitor className="text-muted-foreground" aria-hidden /> Match my device
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem destructive onSelect={() => signOut({ callbackUrl: '/login' })}>
          <LogOut aria-hidden /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Same frame as PageShell, so the first paint doesn't shift when the page arrives. */
function ConsoleSkeleton() {
  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 px-4 pb-12 pt-5 sm:px-6 sm:pt-6 lg:px-8 lg:pt-8" role="status">
      <span className="sr-only">Loading the console…</span>
      <div className="space-y-2">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-9 w-64" />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-[94px] rounded-2xl" />
        ))}
      </div>
      <Skeleton className="h-80 rounded-2xl" />
    </div>
  );
}

function ShellGate({ children }: { children: React.ReactNode }) {
  const { ctx, error, property } = useConsole();
  const router = useRouter();
  React.useEffect(() => {
    if (error instanceof ApiError && error.status === 401) router.replace(`/login?callbackUrl=${encodeURIComponent(window.location.pathname)}`);
  }, [error, router]);
  if (error instanceof ApiError && error.status === 403) {
    return (
      <div className="mx-auto max-w-md px-6 py-24 text-center">
        <LogoMark className="mx-auto size-12" />
        <h1 className="mt-6 text-xl font-semibold tracking-tight">This area is for hotel staff</h1>
        <p className="mt-2 text-sm text-muted-foreground">You’re signed in with a guest account. Your trips are on your guest dashboard.</p>
        <Button asChild className="mt-6">
          <Link href="/dashboard">Go to my trips</Link>
        </Button>
      </div>
    );
  }
  if (ctx && ctx.properties.length === 0) {
    const canCreate = ctx.user.role === 'OWNER' || ctx.user.role === 'ADMIN';
    return (
      <div className="mx-auto max-w-md px-6 py-24 text-center">
        <LogoMark className="mx-auto size-12" />
        <h1 className="mt-6 text-xl font-semibold tracking-tight">No property yet</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {canCreate ? 'Set up your first property to open the console. It takes about five minutes.' : 'Ask your manager to add you to a property, then sign in again.'}
        </p>
        {canCreate && (
          <Button asChild className="mt-6">
            <Link href="/admin/properties/add">Add your property</Link>
          </Button>
        )}
      </div>
    );
  }
  if (!ctx || !property) return <ConsoleSkeleton />;
  return <>{children}</>;
}

export function ConsoleShell({ children }: { children: React.ReactNode }) {
  const { ctx, mode, role, setCommandOpen, can, property } = useConsole();
  const pathname = usePathname();
  const reduce = useReducedMotion();
  const modKey = useModKey();
  const [mobileOpen, setMobileOpen] = React.useState(false);
  // Close the phone menu whenever the page changes (a link, or the mode switch).
  React.useEffect(() => setMobileOpen(false), [pathname]);
  const agentic = mode === 'AGENTIC';
  const groups = navFor(role, { agentEnabled: can('agent.use'), setupPath: property?.setupPath });
  const showModeSwitch = (property?.setupPath ?? 'FULL') === 'FULL' && can('agent.use');
  const showAsk = !agentic && can('agent.use') && property?.setupPath !== 'VOICE';

  // The Classic sidebar can be narrowed by the person (remembered); in Agentic
  // mode it narrows to icons to give the conversation room, unless they widen it.
  const [classicCollapsed, setClassicCollapsed] = React.useState(false);
  const [agenticExpanded, setAgenticExpanded] = React.useState(false);
  React.useEffect(() => {
    try {
      setClassicCollapsed(window.localStorage.getItem(SIDEBAR_KEY) === '1');
    } catch {
      /* storage unavailable: start expanded */
    }
  }, []);
  React.useEffect(() => {
    if (!agentic) setAgenticExpanded(false);
  }, [agentic]);
  const collapsed = agentic ? !agenticExpanded : classicCollapsed;
  const toggleSidebar = () => {
    if (agentic) {
      setAgenticExpanded((v) => !v);
      return;
    }
    const next = !classicCollapsed;
    setClassicCollapsed(next);
    try {
      window.localStorage.setItem(SIDEBAR_KEY, next ? '1' : '0');
    } catch {
      /* preference just won't persist */
    }
  };

  const section = titleFor(pathname);
  const sectionHref = groups.flatMap((g) => g.items).find((i) => isActive(pathname, i.href))?.href;

  return (
    <div className="flex min-h-dvh bg-background">
      {/* Desktop sidebar */}
      <aside
        aria-label="Sidebar"
        id="console-sidebar"
        className={cn(
          'sticky top-0 z-30 hidden h-dvh shrink-0 flex-col border-r bg-surface lg:flex',
          !reduce && 'transition-[width] duration-300 ease-out',
          collapsed ? 'w-[72px]' : 'w-[248px]'
        )}
      >
        <div className={cn('flex h-14 shrink-0 items-center border-b', collapsed ? 'justify-center' : 'px-4')}>
          <Link
            href="/admin"
            className="rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
          >
            <Logo compact={collapsed} />
            <span className="sr-only"> console home</span>
          </Link>
        </div>
        <div className={cn('flex-1 py-4', collapsed ? 'overflow-visible px-2' : 'overflow-y-auto px-3 scrollbar-thin')}>
          <NavList groups={groups} collapsed={collapsed} />
        </div>
        <div className={cn('shrink-0 border-t p-3', collapsed && 'flex justify-center')}>
          <Button
            variant="ghost"
            size={collapsed ? 'icon' : 'sm'}
            onClick={toggleSidebar}
            aria-expanded={!collapsed}
            aria-controls="console-sidebar"
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={collapsed ? 'Expand sidebar' : undefined}
            className={cn('text-muted-foreground hover:text-foreground', !collapsed && 'w-full justify-start')}
          >
            {collapsed ? <PanelLeftOpen aria-hidden /> : <PanelLeftClose aria-hidden />}
            {!collapsed && <span>Collapse</span>}
          </Button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="glass sticky top-0 z-40 border-b">
          <AnimatePresence>
            {agentic && (
              <motion.div
                initial={reduce ? false : { scaleX: 0, opacity: 0 }}
                animate={{ scaleX: 1, opacity: 1 }}
                exit={{ scaleX: 0, opacity: 0 }}
                transition={{ duration: reduce ? 0 : 0.5, ease: [0.22, 1, 0.36, 1] }}
                className="bg-aurora absolute inset-x-0 top-0 h-[2px] origin-left motion-safe:animate-aurora"
                aria-hidden
              />
            )}
          </AnimatePresence>
          <div className="flex h-14 items-center gap-2 px-3 sm:gap-3 sm:px-5">
            <IconButton
              label="Open menu"
              className="lg:hidden"
              onClick={() => setMobileOpen(true)}
              aria-expanded={mobileOpen}
              aria-controls="console-mobile-nav"
              aria-haspopup="dialog"
            >
              <Menu />
            </IconButton>
            <div className="flex min-w-0 items-center gap-2">
              <PropertySwitcher />
              {section !== 'Console' && (
                <div className="hidden min-w-0 items-center gap-1.5 text-sm xl:flex">
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  {sectionHref && pathname !== sectionHref ? (
                    <Link href={sectionHref} className="truncate rounded-sm font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
                      {section}
                    </Link>
                  ) : (
                    <span className="truncate font-medium text-foreground">{section}</span>
                  )}
                </div>
              )}
            </div>
            <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
              {showModeSwitch && <ModeSwitch size="sm" className="hidden sm:inline-flex" />}
              {showAsk && (
                <>
                  <Button variant="outline" size="sm" className="hidden md:inline-flex" onClick={() => setCommandOpen(true)}>
                    <Sparkles className="text-agent" aria-hidden />
                    <span>Ask the agent</span>
                    {modKey && (
                      <span className="ml-0.5 flex gap-0.5" aria-hidden>
                        <Kbd>{modKey}</Kbd>
                        <Kbd>K</Kbd>
                      </span>
                    )}
                  </Button>
                  <IconButton label="Ask the agent" className="md:hidden" onClick={() => setCommandOpen(true)}>
                    <Sparkles className="text-agent" />
                  </IconButton>
                </>
              )}
              <UserMenu />
            </div>
          </div>
        </header>

        <main id="main" tabIndex={-1} className="relative min-w-0 flex-1 focus:outline-none">
          <ShellGate>
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={mode + (pathname.startsWith('/admin/agent') ? ':agent' : '')}
                initial={reduce ? false : { opacity: 0, y: 8, filter: 'blur(2px)' }}
                // Clear filter/transform once settled: either one would make this
                // wrapper the containing block for position:fixed children.
                animate={{ opacity: 1, y: 0, filter: 'blur(0px)', transitionEnd: { filter: 'none', transform: 'none' } }}
                exit={reduce ? { opacity: 0 } : { opacity: 0, y: -6, filter: 'blur(2px)' }}
                transition={{ duration: reduce ? 0 : 0.25, ease: [0.22, 1, 0.36, 1] }}
                className="h-full"
              >
                {children}
              </motion.div>
            </AnimatePresence>
          </ShellGate>
        </main>
      </div>

      {/* Phone and tablet navigation (Radix keeps focus inside while open and returns it to the menu button). */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent id="console-mobile-nav" side="left" className="w-[300px] max-w-[85vw] p-0" closeLabel="Close menu">
          <SheetTitle className="sr-only">Menu</SheetTitle>
          <div className="flex h-14 shrink-0 items-center border-b px-4">
            <Logo />
          </div>
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-3">
            <div className="space-y-3">
              <PropertySwitcher className="w-full max-w-none" />
              {showModeSwitch && (
                <div>
                  <p className="mb-1.5 px-1 text-2xs font-semibold uppercase tracking-wider text-muted-foreground">How you work</p>
                  <ModeSwitch className="flex w-full [&>button]:flex-1" />
                </div>
              )}
            </div>
            <NavList groups={groups} touch onNavigate={() => setMobileOpen(false)} />
          </div>
          {ctx && (
            <div className="shrink-0 border-t px-4 py-3 text-xs text-muted-foreground">
              Signed in as <span className="font-medium text-foreground">{ctx.user.name}</span> · {roleLabel(ctx.user.role)}
            </div>
          )}
        </SheetContent>
      </Sheet>

      <CommandSheet />
    </div>
  );
}
