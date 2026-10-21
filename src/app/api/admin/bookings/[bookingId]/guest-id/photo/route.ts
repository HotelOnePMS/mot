import { NextRequest } from 'next/server';
import { requireStaff } from '@/server/authz';
import { handleRoute } from '@/server/http';
import { readGuestIdPhoto } from '@/server/services/checkin';

type Params = { params: Promise<{ bookingId: string }> };

/** GET — the front photo of the guest's ID (staff of that property only; every view is logged, nothing is cached). */
export const GET = handleRoute(async (_req: NextRequest, { params }: Params) => {
  const { bookingId } = await params;
  const actor = await requireStaff('guestId.view');
  const { mime, bytes } = await readGuestIdPhoto({ actor, source: 'classic' }, bookingId);
  return new Response(new Uint8Array(bytes), {
    headers: { 'Content-Type': mime, 'Cache-Control': 'private, no-store', 'Content-Disposition': 'inline', 'X-Content-Type-Options': 'nosniff' },
  });
});
