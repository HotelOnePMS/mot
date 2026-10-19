import { NextRequest, NextResponse } from 'next/server';
import { requestOrigin } from '@/server/agent-api';
import { SSO_COOKIE, finishSso } from '@/server/auth/sso';
import { DomainError } from '@/server/errors';
import { logError } from '@/server/log';

export const dynamic = 'force-dynamic';

/**
 * GET /api/sso/callback — the identity provider sends the person back here.
 * The redirect URI to register with the provider is this address.
 */
export async function GET(request: NextRequest) {
  const origin = requestOrigin(request);
  let target: URL;
  try {
    const { ticket, callbackUrl } = await finishSso({ url: new URL(request.nextUrl.toString()), cookie: request.cookies.get(SSO_COOKIE)?.value, origin });
    target = new URL(`/login/sso?ticket=${encodeURIComponent(ticket)}&callbackUrl=${encodeURIComponent(callbackUrl)}`, origin);
  } catch (e) {
    if (!(e instanceof DomainError)) logError('sso', 'callback failed', e);
    const message = e instanceof DomainError ? e.message : 'Single sign-on didn’t work. Please try again.';
    target = new URL(`/login?error=SSO&message=${encodeURIComponent(message)}`, origin);
  }
  const res = NextResponse.redirect(target);
  res.cookies.set(SSO_COOKIE, '', { httpOnly: true, path: '/api/sso', maxAge: 0 });
  return res;
}
