/**
 * Public demo guard (NEXT_PUBLIC_DEMO_MODE=true). The demo hotels are shared
 * by every visitor, so what strangers see — a hotel's name and description,
 * whether it's listed, the voice agent's words — stays as seeded. Everything
 * operational (bookings, rooms, rates, housekeeping) stays hands-on.
 */
import { isDemoEmail } from '@/config/product';
import type { Actor } from './authz';
import { forbidden } from './errors';

const norm = (v: unknown) => (v === '' || v === undefined ? null : typeof v === 'string' ? v.trim() : JSON.stringify(v));

/**
 * Things the public demo can't have at all (e.g. a real phone line): not on a
 * demo hotel, and not with the shared demo logins (which can also create
 * hotels of their own). Visitors set up their own hotel for that.
 */
export function demoHotelLocked(actor: Pick<Actor, 'role' | 'email'>, isDemo: boolean): boolean {
  if (process.env.NEXT_PUBLIC_DEMO_MODE !== 'true' || actor.role === 'ADMIN') return false;
  return isDemo || isDemoEmail(actor.email);
}

export function assertNotDemoHotel(actor: Actor, isDemo: boolean, message: string) {
  if (demoHotelLocked(actor, isDemo)) throw forbidden(message);
}

export function assertDemoHotelUnchanged(
  actor: Actor,
  current: { isDemo: boolean } & Record<string, unknown>,
  changes: Record<string, unknown>,
  fields: string[],
) {
  if (process.env.NEXT_PUBLIC_DEMO_MODE !== 'true' || !current.isDemo || actor.role === 'ADMIN') return;
  const changed = fields.filter((f) => changes[f] !== undefined && norm(changes[f]) !== norm(current[f]));
  if (changed.length) {
    throw forbidden(`Demo hotels keep their public details (${changed.join(', ')}) for every visitor. Set up your own hotel to change them — everything else here is yours to try.`);
  }
}
