/**
 * Links the concierge hands out. External assistants need absolute URLs, so
 * these fall back to the product domain when no public URL is configured.
 */
import { PRODUCT_URL } from '@/config/product';
import { publicSiteUrl } from '../public-url';

/** Absolute URL for a path on this deployment (publicSiteUrl(), else the product domain). */
export function siteUrl(path: string): string {
  return `${publicSiteUrl() ?? PRODUCT_URL}${path.startsWith('/') ? path : `/${path}`}`;
}

/** Makes a stored image URL absolute (uploaded photos are absolute already; seeded ones may be paths). */
export function absoluteUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  return /^https?:\/\//i.test(url) ? url : siteUrl(url);
}

/** The stay a checkout link is for. */
export interface CheckoutStay {
  roomTypeId: string;
  checkIn: string;
  checkOut: string;
  guests: number;
  rooms: number;
}

/** Optional guest details the checkout page pre-fills (guestName, guestEmail, guestPhone). */
export interface CheckoutGuest {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
}

/**
 * Relative path of the pre-filled checkout, `/properties/{id}/book?roomTypeId=…&checkIn=…&checkOut=…&guests=…&rooms=…`
 * (exactly what the guest voice tool `start_booking` opens), plus optional
 * guest prefill parameters.
 */
export function checkoutPath(propertyId: string, stay: CheckoutStay, guest?: CheckoutGuest): string {
  const q = new URLSearchParams({ roomTypeId: stay.roomTypeId, checkIn: stay.checkIn, checkOut: stay.checkOut, guests: String(stay.guests), rooms: String(stay.rooms) });
  if (guest?.name) q.set('guestName', guest.name);
  if (guest?.email) q.set('guestEmail', guest.email);
  if (guest?.phone) q.set('guestPhone', guest.phone);
  return `/properties/${propertyId}/book?${q}`;
}

/** Absolute URL of a hotel's booking page, with the stay pre-filled when dates are given. */
export function propertyUrl(propertyId: string, stay?: { checkIn?: string; checkOut?: string; guests?: number; rooms?: number }): string {
  const q = new URLSearchParams();
  if (stay?.checkIn && stay.checkOut) {
    q.set('checkIn', stay.checkIn);
    q.set('checkOut', stay.checkOut);
    if (stay.guests) q.set('guests', String(stay.guests));
    if (stay.rooms) q.set('rooms', String(stay.rooms));
  }
  const qs = q.toString();
  return siteUrl(`/properties/${propertyId}${qs ? `?${qs}` : ''}`);
}

/** Absolute URL of the guest's own booking page (they sign in to see it). */
export function bookingPageUrl(bookingId: string): string {
  return siteUrl(`/bookings/${bookingId}`);
}
