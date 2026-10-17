import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { canAccessConsolePath, homeForRole, isStaffRole } from '@/lib/routes';

/**
 * Page-level access control. API routes enforce their own (stricter,
 * per-property) rules in src/server/authz.ts; this keeps people out of
 * screens they can't use and sends each role to its home.
 */
export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

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

  if (pathname === '/admin' || pathname.startsWith('/admin/')) {
    if (!token) return toLogin();
    if (!isStaffRole(role)) return NextResponse.redirect(new URL('/dashboard', request.url));
    if (pathname !== '/admin' && !canAccessConsolePath(role, pathname)) {
      return NextResponse.redirect(new URL(homeForRole(role), request.url));
    }
    return NextResponse.next();
  }

  // Guest account pages.
  if (pathname.startsWith('/dashboard') || pathname.startsWith('/profile') || pathname.startsWith('/bookings/')) {
    if (!token) return toLogin();
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/admin', '/admin/:path*', '/dashboard/:path*', '/dashboard', '/profile', '/bookings/:path*'],
};
