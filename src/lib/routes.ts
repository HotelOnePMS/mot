/**
 * Route helpers shared by middleware, layouts and client components.
 * Pure functions only — safe to import anywhere (edge, server, client).
 */

export const STAFF_ROLES = ['ADMIN', 'OWNER', 'MANAGER', 'FRONT_DESK', 'HOUSEKEEPER'] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];
export type AppRole = StaffRole | 'CUSTOMER';

export function isStaffRole(role: string | null | undefined): role is StaffRole {
  return !!role && (STAFF_ROLES as readonly string[]).includes(role);
}

/** The staff console lives under /admin (all staff roles, nav filtered by role). */
export function isConsolePath(pathname: string): boolean {
  return pathname === '/admin' || pathname.startsWith('/admin/');
}

/** Console home for a role at a property, following how the hotel uses HotelOne. */
export function homeForProperty(role: string | null | undefined, setupPath: 'FULL' | 'BRIDGE' | 'VOICE' | undefined): string {
  if (!isStaffRole(role)) return '/dashboard';
  if (setupPath === 'VOICE') return '/admin/voice';
  if (setupPath === 'BRIDGE') return role === 'HOUSEKEEPER' ? '/admin/voice' : '/admin/agent';
  return homeForRole(role);
}

/** Where a user should land after signing in, by role. */
export function homeForRole(role: string | null | undefined): string {
  switch (role) {
    case 'ADMIN':
    case 'OWNER':
    case 'MANAGER':
      return '/admin/dashboard';
    case 'FRONT_DESK':
      return '/admin/front-desk';
    case 'HOUSEKEEPER':
      return '/admin/housekeeping';
    default:
      return '/dashboard';
  }
}

/**
 * Console sections and which roles may open them. Single source of truth for
 * both the middleware (page access) and the sidebar (what is shown).
 */
export const CONSOLE_ACCESS: { prefix: string; roles: readonly StaffRole[] }[] = [
  { prefix: '/admin/dashboard', roles: ['ADMIN', 'OWNER', 'MANAGER'] },
  { prefix: '/admin/agent', roles: ['ADMIN', 'OWNER', 'MANAGER', 'FRONT_DESK'] },
  { prefix: '/admin/front-desk', roles: ['ADMIN', 'OWNER', 'MANAGER', 'FRONT_DESK'] },
  { prefix: '/admin/housekeeping', roles: ['ADMIN', 'OWNER', 'MANAGER', 'FRONT_DESK', 'HOUSEKEEPER'] },
  { prefix: '/admin/bookings', roles: ['ADMIN', 'OWNER', 'MANAGER', 'FRONT_DESK'] },
  { prefix: '/admin/rate-calendar', roles: ['ADMIN', 'OWNER', 'MANAGER'] },
  { prefix: '/admin/room-types', roles: ['ADMIN', 'OWNER', 'MANAGER'] },
  { prefix: '/admin/properties', roles: ['ADMIN', 'OWNER'] },
  { prefix: '/admin/users', roles: ['ADMIN', 'OWNER', 'MANAGER'] },
  { prefix: '/admin/activity', roles: ['ADMIN', 'OWNER', 'MANAGER'] },
  { prefix: '/admin/settings', roles: ['ADMIN', 'OWNER', 'MANAGER'] },
  { prefix: '/admin/analytics', roles: ['ADMIN', 'OWNER', 'MANAGER'] },
  // Card disputes: same roles as the 'disputes.view' permission; submitting evidence needs 'disputes.manage'.
  { prefix: '/admin/disputes', roles: ['ADMIN', 'OWNER', 'MANAGER'] },
  { prefix: '/admin/voice', roles: ['ADMIN', 'OWNER', 'MANAGER', 'FRONT_DESK'] },
  // Same roles as the 'bridge.use' permission (free-text PMS driving is manager/owner by default).
  { prefix: '/admin/connect', roles: ['ADMIN', 'OWNER', 'MANAGER'] },
  // Same roles as the 'skills.view' permission; changes need 'skills.manage'.
  { prefix: '/admin/skills', roles: ['ADMIN', 'OWNER', 'MANAGER', 'FRONT_DESK'] },
  // Managers can see and share the hotel's assistant link; keys need 'agentkeys.manage'.
  { prefix: '/admin/assistants', roles: ['ADMIN', 'OWNER', 'MANAGER'] },
  // Hotel groups: owners who administer one (the API checks which), and platform admins.
  { prefix: '/admin/organization', roles: ['ADMIN', 'OWNER'] },
];

export function canAccessConsolePath(role: string | null | undefined, pathname: string): boolean {
  if (!isStaffRole(role)) return false;
  const rule = CONSOLE_ACCESS.find((r) => pathname === r.prefix || pathname.startsWith(r.prefix + '/'));
  // Unlisted console paths are admin/owner only.
  if (!rule) return role === 'ADMIN' || role === 'OWNER';
  return rule.roles.includes(role);
}

/* ------------------------------------------------------------------ */
/* Sign-in and sign-out: one set of rules for every page.              */
/* ------------------------------------------------------------------ */

/** The path without its query or hash. */
const pathOnly = (path: string) => path.split(/[?#]/)[0];

/** Only same-site relative paths are accepted as a post-sign-in destination. */
export function safeCallback(raw: string | null | undefined): string | null {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return null;
  // Browsers drop tabs and newlines and read "\" as "/", so "/\t/evil.com" would leave the site.
  if (/[\x00-\x1f\x7f\\]/.test(raw)) return null;
  if (new URL(raw, 'http://local.invalid').origin !== 'http://local.invalid') return null;
  if (/^\/(login|register|api)(\/|$)/.test(pathOnly(raw))) return null;
  return raw;
}

/** Traveller pages: the booking journey and the guest account. */
export function isTravellerPath(path: string): boolean {
  return /^\/(properties|bookings|dashboard|profile|assistants)(\/|$)/.test(pathOnly(path));
}

/**
 * The sign-in link for a page. Traveller and console pages ask to come back;
 * product pages don't, so everyone lands on their own home instead of the
 * page they happened to click Sign in on.
 */
export function loginUrl(returnTo?: string | null): string {
  const cb = safeCallback(returnTo);
  if (!cb || !(isTravellerPath(cb) || isConsolePath(pathOnly(cb)))) return '/login';
  return `/login?callbackUrl=${encodeURIComponent(cb)}`;
}

/**
 * Where to go after signing in or signing up. Staff go back to a console page
 * they can open or an unfinished traveller task, otherwise to the console;
 * travellers go back to where they were, otherwise to My trips.
 */
export function destinationFor(role: string | null | undefined, callback: string | null | undefined): string {
  const cb = safeCallback(callback);
  if (cb) {
    const path = pathOnly(cb);
    if (isConsolePath(path)) {
      if (isStaffRole(role) && (path === '/admin' || canAccessConsolePath(role, path))) return cb;
    } else if (!isStaffRole(role) || isTravellerPath(path)) {
      return cb;
    }
  }
  return isStaffRole(role) ? '/admin' : '/dashboard';
}

/**
 * Where signing out lands. Console and staff accounts go to the sign-in page;
 * travellers leaving an account page go to `fallback` (the directory, or the
 * hotel they were booking with); everyone else stays on the page they're on.
 * `current` is the path with its query.
 */
export function signOutTarget(current: string, opts: { role?: string | null; fallback?: string } = {}): string {
  const path = pathOnly(current);
  const accountPage = /^\/(dashboard|profile|bookings)(\/|$)/.test(path);
  if (isConsolePath(path) || (accountPage && isStaffRole(opts.role))) return '/login?signedOut=1';
  if (accountPage) return opts.fallback ?? '/properties';
  return safeCallback(current) ?? '/';
}
