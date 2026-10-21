import { NextRequest } from 'next/server';
import { requireStaff } from '@/server/authz';
import { handleRoute } from '@/server/http';
import { readIdPhoto } from '@/server/payments/cardAuthorization';

type Params = { params: Promise<{ authorizationId: string }> };

/** GET — the cardholder's ID photo (staff of that property only; every view is logged, nothing is cached). */
export const GET = handleRoute(async (_req: NextRequest, { params }: Params) => {
  const { authorizationId } = await params;
  const actor = await requireStaff('booking.cardAuth');
  const { mime, bytes } = await readIdPhoto({ actor, source: 'classic' }, authorizationId);
  return new Response(new Uint8Array(bytes), {
    headers: {
      'Content-Type': mime,
      'Cache-Control': 'private, no-store',
      'Content-Disposition': 'inline',
      'X-Content-Type-Options': 'nosniff',
    },
  });
});
