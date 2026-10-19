import { NextRequest, NextResponse } from 'next/server';
import { requestOrigin } from '@/server/agent-api';
import { SSO_COOKIE, startSso } from '@/server/auth/sso';
import { DomainError } from '@/server/errors';
import { logError } from '@/server/log';

export const dynamic = 'force-dynamic';

/**
 * GET /api/sso/start?email=&callbackUrl= — send the person to their
 * organization's identity provider. Problems go back to the login page.
 */
export async function GET(request: NextRequest) {
  const origin = requestOrigin(request);
  const email = request.nextUrl.searchParams.get('email')?.trim() ?? '';
  const back = (message: string) => NextResponse.redirect(new URL(`/login?error=SSO&message=${encodeURIComponent(message)}`, origin));
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return back('Enter your work email address to use single sign-on.');
  try {
    const { redirect, cookie } = await startSso({ email, callbackUrl: request.nextUrl.searchParams.get('callbackUrl'), origin });
    const res = NextResponse.redirect(redirect);
    res.cookies.set(SSO_COOKIE, cookie, { httpOnly: true, secure: origin.startsWith('https:'), sameSite: 'lax', path: '/api/sso', maxAge: 600 });
    return res;
  } catch (e) {
    if (!(e instanceof DomainError)) logError('sso', 'start failed', e);
    return back(e instanceof DomainError ? e.message : 'Single sign-on isn’t available right now. Please try again.');
  }
}
