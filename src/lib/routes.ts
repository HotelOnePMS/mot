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
  { prefix: '/admin/voice', roles: ['ADMIN', 'OWNER', 'MANAGER', 'FRONT_DESK'] },
  { prefix: '/admin/connect', roles: ['ADMIN', 'OWNER', 'MANAGER', 'FRONT_DESK'] },
  // Same roles as the 'skills.view' permission; changes need 'skills.manage'.
  { prefix: '/admin/skills', roles: ['ADMIN', 'OWNER', 'MANAGER', 'FRONT_DESK'] },
  // Managers can see and share the hotel's assistant link; keys need 'agentkeys.manage'.
  { prefix: '/admin/assistants', roles: ['ADMIN', 'OWNER', 'MANAGER'] },
];

export function canAccessConsolePath(role: string | null | undefined, pathname: string): boolean {
  if (!isStaffRole(role)) return false;
  const rule = CONSOLE_ACCESS.find((r) => pathname === r.prefix || pathname.startsWith(r.prefix + '/'));
  // Unlisted console paths are admin/owner only.
  if (!rule) return role === 'ADMIN' || role === 'OWNER';
  return rule.roles.includes(role);
}
