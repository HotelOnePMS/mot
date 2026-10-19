import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { canAccessConsolePath, homeForRole, isStaffRole } from '@/lib/routes';
import { getAppOrigin, getPropertyDomainBase, getPropertySubdomain, isAppHost, normalizeDomain } from '@/lib/domain-utils';

// Property domains (default subdomain or the property's own): hostname -> property it serves
type PropertySite = { propertyId: string; customDomain: string | null };

const DOMAIN_CACHE_TTL_MS = 60 * 1000;
const DOMAIN_CACHE_MAX_ENTRIES = 1000;
const domainCache = new Map<string, { site: PropertySite | null; expiresAt: number }>();

// null: no property uses this host; undefined: the lookup failed
async function resolvePropertySite(request: NextRequest, hostname: string): Promise<PropertySite | null | undefined> {
  const cached = domainCache.get(hostname);
  if (cached && cached.expiresAt > Date.now()) return cached.site;

  // Middleware can't use Prisma, so ask this site's own API (on the same host, which
  // stays public even where Deployment Protection covers per-deployment URLs)
  const origin = process.env.INTERNAL_APP_URL || request.nextUrl.origin;
  try {
    const response = await fetch(`${origin}/api/domains/resolve?host=${encodeURIComponent(hostname)}`, { cache: 'no-store' });
    if (!response.ok && response.status !== 404) return undefined;

    const { propertyId, customDomain } = await response.json();
    const site = propertyId ? { propertyId, customDomain } : null;
    if (domainCache.size >= DOMAIN_CACHE_MAX_ENTRIES) domainCache.clear();
    domainCache.set(hostname, { site, expiresAt: Date.now() + DOMAIN_CACHE_TTL_MS });
    return site;
  } catch (error) {
    console.error('Property domain lookup failed:', error);
    return undefined;
  }
}

/**
 * On a property's domain, guests see that property's booking page and their
 * booking. Sign-in, accounts and staff pages redirect to the main site.
 */
function propertySite(request: NextRequest, propertyId: string): NextResponse | null {
  const { pathname, search } = request.nextUrl;
  const bookingPage = `/properties/${propertyId}`;

  if (pathname === '/') {
    const url = request.nextUrl.clone();
    url.pathname = bookingPage;
    return NextResponse.rewrite(url);
  }
  if (pathname === bookingPage || pathname.startsWith(`${bookingPage}/`)) return NextResponse.next();
  // The booking page signs guests in here and then shows their booking; normal rules apply
  if (pathname.startsWith('/bookings/')) return null;
  // Other properties' listings
  if (pathname === '/properties' || pathname.startsWith('/properties/')) {
    return NextResponse.redirect(new URL('/', request.url));
  }

  const appOrigin = getAppOrigin();
  if (!appOrigin) return null;
  const mainSiteUrl = new URL(`${pathname}${search}`, appOrigin);
  if (pathname === '/login' && !mainSiteUrl.searchParams.has('callbackUrl')) {
    mainSiteUrl.searchParams.set('callbackUrl', bookingPage);
  }
  return NextResponse.redirect(mainSiteUrl);
}

const isGuestAccountPath = (pathname: string) =>
  pathname.startsWith('/dashboard') || pathname.startsWith('/profile') || pathname.startsWith('/bookings/');

/**
 * Page-level access control. API routes enforce their own (stricter,
 * per-property) rules in src/server/authz.ts; this keeps people out of
 * screens they can't use and sends each role to its home. It also serves
 * hotels' booking pages on their own domains (see DEPLOYMENT.md).
 */
export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  const hostname = normalizeDomain(request.headers.get('host') || '');
  if (hostname && !isAppHost(hostname)) {
    const isDefaultSubdomain = getPropertySubdomain(hostname) !== null;
    const site = await resolvePropertySite(request, hostname);

    if (site) {
      // Once a property's own domain is live, its default subdomain points guests there.
      // Temporary, so browsers don't keep redirecting if the owner disconnects their domain.
      if (isDefaultSubdomain && site.customDomain) {
        return NextResponse.redirect(`https://${site.customDomain}${pathname}${search}`);
      }
      const response = propertySite(request, site.propertyId);
      if (response) return response;
    } else if (isDefaultSubdomain && site === null) {
      // A subdomain no property uses (any more)
      return NextResponse.redirect(`https://${getPropertyDomainBase()}`);
    }
  }

  const isConsolePath = pathname === '/admin' || pathname.startsWith('/admin/');
  if (!isConsolePath && !isGuestAccountPath(pathname)) return NextResponse.next();

  const token = await getToken({
    req: request,
    cookieName: process.env.NODE_ENV === 'production' ? '__Secure-next-auth.session-token' : 'next-auth.session-token',
    secret: process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET,
  });
  const role = token?.role as string | undefined;

  const toLogin = () => {
    const url = new URL('/login', request.url);
    url.searchParams.set('callbackUrl', pathname + search);
    return NextResponse.redirect(url);
  };

  if (pathname === '/admin/login') {
    return NextResponse.redirect(new URL(token ? homeForRole(role) : '/login?callbackUrl=/admin', request.url));
  }

  if (isConsolePath) {
    if (!token) return toLogin();
    if (!isStaffRole(role)) return NextResponse.redirect(new URL('/dashboard', request.url));
    if (pathname !== '/admin' && !canAccessConsolePath(role, pathname)) {
      return NextResponse.redirect(new URL(homeForRole(role), request.url));
    }
    return NextResponse.next();
  }

  // Guest account pages.
  if (!token) return toLogin();
  return NextResponse.next();
}

// Every page (not API routes, Next.js internals or files), so hotels' domains work on all of them
export const config = {
  matcher: ['/((?!api/|_next/|.*\\..*).*)'],
};
