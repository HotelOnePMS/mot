import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireStaff, resolvePropertyId } from '@/server/authz';
import { isISODate } from '@/server/dates';
import { handleRoute, json, parseJson, parseQuery } from '@/server/http';
import { createDeskReservation, reservationOptions } from '@/server/services/reservations';

const day = z.string().refine(isISODate, 'must be YYYY-MM-DD');

/** GET ?propertyId&checkIn&checkOut&guests&rooms — room types, availability and prices for a new reservation. */
export const GET = handleRoute(async (request: NextRequest) => {
  const actor = await requireStaff('booking.create');
  const q = parseQuery(
    request,
    z.object({
      propertyId: z.string().optional(),
      checkIn: day,
      checkOut: day,
      guests: z.coerce.number().int().min(1).max(40).default(2),
      rooms: z.coerce.number().int().min(1).max(9).default(1),
    })
  );
  const propertyId = await resolvePropertyId(actor, q.propertyId);
  return json(await reservationOptions(actor, propertyId, q));
});

const schema = z.object({
  propertyId: z.string().min(1),
  roomTypeId: z.string().min(1),
  checkIn: day,
  checkOut: day,
  guests: z.coerce.number().int().min(1).max(40),
  rooms: z.coerce.number().int().min(1).max(9).default(1),
  guest: z.object({
    firstName: z.string().trim().min(1, 'is required').max(60),
    lastName: z.string().trim().min(1, 'is required').max(60),
    email: z.string().trim().email('must be a valid email').max(200).nullable().optional().or(z.literal('')),
    phone: z.string().trim().max(40).nullable().optional(),
  }),
  notes: z.string().trim().max(1000).nullable().optional(),
  paid: z.boolean().default(false),
  roomId: z.string().nullable().optional(),
  checkInNow: z.boolean().default(false),
  sendConfirmation: z.boolean().default(true),
});

/** POST — take a reservation at the desk (walk-in or phone). Confirmed at once; optionally checked in. */
export const POST = handleRoute(async (request: NextRequest) => {
  const actor = await requireStaff('booking.create');
  const body = await parseJson(request, schema);
  const booking = await createDeskReservation({ actor, source: 'classic' }, { ...body, guest: { ...body.guest, email: body.guest.email || null } });
  return json(booking, { status: 201 });
});
