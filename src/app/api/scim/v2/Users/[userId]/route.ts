import { NextRequest, NextResponse } from 'next/server';
import { deleteUser, getUser, patchUser, replaceUser } from '@/server/auth/scim';
import { scim, scimBody, scimJson } from '../../_http';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ userId: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  const { userId } = await params;
  return scim(request, async (org, base) => scimJson(await getUser(org, userId, base)));
}

export async function PUT(request: NextRequest, { params }: Params) {
  const { userId } = await params;
  return scim(request, async (org, base) => scimJson(await replaceUser(org, userId, await scimBody(request), base)));
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const { userId } = await params;
  return scim(request, async (org, base) => scimJson(await patchUser(org, userId, await scimBody(request), base)));
}

/** DELETE — turn the account off and remove it from the organization (history is kept). */
export async function DELETE(request: NextRequest, { params }: Params) {
  const { userId } = await params;
  return scim(request, async (org) => {
    await deleteUser(org, userId);
    return new NextResponse(null, { status: 204 });
  });
}
