import { NextRequest } from 'next/server';
import { requireStaff } from '@/server/authz';
import { handleRoute, json } from '@/server/http';
import { deleteGuestId, readGuestIdImage } from '@/server/services/guestIds';

type Params = { params: Promise<{ docId: string }> };

/** GET — the ID photo itself, decrypted for staff of that hotel. Logged; never cached. */
export const GET = handleRoute(async (_req: NextRequest, { params }: Params) => {
  const { docId } = await params;
  const actor = await requireStaff('guestid.view');
  const { mimeType, bytes } = await readGuestIdImage({ actor, source: 'classic' }, docId);
  return new Response(new Uint8Array(bytes), {
    headers: {
      'Content-Type': mimeType,
      'Content-Length': String(bytes.length),
      'Cache-Control': 'private, no-store, max-age=0',
      'Content-Disposition': 'inline',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    },
  });
});

/** DELETE — remove an ID photo now (a retake, or the guest asked). */
export const DELETE = handleRoute(async (_req: NextRequest, { params }: Params) => {
  const { docId } = await params;
  const actor = await requireStaff('guestid.delete');
  return json(await deleteGuestId({ actor, source: 'classic' }, docId));
});
