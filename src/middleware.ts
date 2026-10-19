import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { canAccessConsolePath, homeForRole, isStaffRole } from '@/lib/routes';

/**
 * Page-level access control. API routes enforce their own (stricter,
 * per-property) rules in src/server/authz.ts; this keeps people out of
 * screens they can't use and sends each role to its home. It trusts only the signed
 * cookie, which can be stale (role changed, account deactivated); /admin/layout.tsx
 * re-checks against the database on every page load, and API routes always do.
 */
export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  const token = await getToken({
    req: request,
    cookieName: process.env.NODE_ENV === 'production' ? '__Secure-next-auth.session-token' : 'next-auth.session-token',
    secret: process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET,
  });
  const role = token?.role as string | undefined;

  // Pass the path to server layouts, which re-check the account against the database
  // (the role in the cookie can be stale: the middleware has no database access).
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-pathname', pathname);
  const next = () => NextResponse.next({ request: { headers: requestHeaders } });

  const toLogin = () => {
    const url = new URL('/login', request.url);
    url.searchParams.set('callbackUrl', pathname + search);
    return NextResponse.redirect(url);
  };

  if (pathname === '/admin/login') {
    return NextResponse.redirect(new URL(token ? homeForRole(role) : '/login?callbackUrl=/admin', request.url));
  }

  if (pathname === '/admin' || pathname.startsWith('/admin/')) {
    if (!token) return toLogin();
    if (!isStaffRole(role)) return NextResponse.redirect(new URL('/dashboard?notice=staff-only', request.url));
    // The organization requires two-step sign-in and this person hasn't set it up (lib/auth.ts).
    if (token.mfaSetup) return NextResponse.redirect(new URL('/account/security?required=1', request.url));
    if (pathname !== '/admin' && !canAccessConsolePath(role, pathname)) {
      return NextResponse.redirect(new URL(homeForRole(role), request.url));
    }
    return next();
  }

  // Guest account pages, and everyone's account security.
  if (pathname.startsWith('/dashboard') || pathname.startsWith('/profile') || pathname.startsWith('/bookings/') || pathname.startsWith('/account')) {
    if (!token) return toLogin();
  }

  return next();
}

export const config = {
  matcher: ['/admin', '/admin/:path*', '/dashboard/:path*', '/dashboard', '/profile', '/bookings/:path*', '/account/:path*'],
};
