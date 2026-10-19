import { NextResponse } from 'next/server';
import { requestOrigin } from '@/server/agent-api';
import { ScimError, scimErrorBody, scimOrganization } from '@/server/auth/scim';
import type { Organization } from '@prisma/client';
import { logError } from '@/server/log';

const HEADERS = { 'Content-Type': 'application/scim+json; charset=utf-8', 'Cache-Control': 'no-store' };

export const scimJson = (body: unknown, status = 200) => new NextResponse(JSON.stringify(body), { status, headers: HEADERS });

/** Runs a SCIM handler with the token's organization and this deployment's SCIM base URL; errors become SCIM errors. */
export async function scim(request: Request, fn: (org: Organization, base: string) => Promise<Response>): Promise<Response> {
  try {
    const org = await scimOrganization(request.headers.get('authorization'));
    return await fn(org, `${requestOrigin(request)}/api/scim/v2`);
  } catch (e) {
    if (e instanceof ScimError) return scimJson(scimErrorBody(e), e.status);
    logError('scim', 'request failed', e);
    return scimJson(scimErrorBody(new ScimError(500, 'Something went wrong on our side.')), 500);
  }
}

export async function scimBody<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new ScimError(400, 'The body must be JSON.', 'invalidSyntax');
  }
}
