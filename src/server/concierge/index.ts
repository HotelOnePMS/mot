/**
 * The HotelOne concierge: platform-wide search and booking across every
 * listed hotel, with no session. Used by the global voice concierge, the MCP
 * endpoint and the REST API, so every result is compact JSON for models:
 * dates YYYY-MM-DD, money as numbers with `currency` (USD), ids included,
 * absolute URLs.
 *
 * Conventions:
 * - Inputs are validated with `conciergeSchemas` (zod; JSON Schemas in
 *   `conciergeJsonSchemas`). Bad input throws ZodError.
 * - Rule failures throw DomainError (400 rules, 403 refused, 404 hotel not
 *   found/unlisted, 409 sold out, 429 rate limited) with a message written
 *   for people and models. `conciergeError(e)` turns any error into
 *   `{ error, code, status }` for tool results; `handleRoute` already maps
 *   both kinds for REST routes.
 * - Callers that are public should also call `consumeRateLimit` per client.
 * - Authorisation (API keys, scopes) is the caller's job: `createBooking` is
 *   for trusted keys only.
 * - `askHotel` answers guests' questions from the hotel's ANSWER skills, so
 *   whatever a hotel configures is answerable without code changes.
 */
import { ZodError } from 'zod';
import { DomainError } from '../errors';

export { searchHotels, searchTokens, type HotelSearchResult, type SearchHotelsResult } from './search';
export { hotelDetails, checkAvailability, findListedHotel, type HotelDetails, type CheckAvailabilityResult } from './hotel';
export {
  bookingLink,
  requestBooking,
  createBooking,
  findBooking,
  type BookingLinkResult,
  type RequestBookingResult,
  type CreateBookingResult,
  type FindBookingResult,
} from './booking';
export { askHotel, type AskHotelResult, type HotelAnswer } from './answers';
export { consumeRateLimit, RATE_LIMIT_CHANNEL, type RateLimitResult } from './rateLimit';
export {
  conciergeSchemas,
  conciergeJsonSchemas,
  zodToJsonSchema,
  type ConciergeOperation,
  type JsonSchema,
  type SearchHotelsInput,
  type HotelDetailsInput,
  type CheckAvailabilityInput,
  type BookingLinkInput,
  type RequestBookingInput,
  type CreateBookingInput,
  type FindBookingInput,
  type AskHotelInput,
} from './schemas';
export { CURRENCY, HOTEL_POLICY, LISTED_PROPERTY, propertyFacts, type PropertyFacts } from './facts';
export { MAX_NIGHTS, type AvailabilityOption, type AvailabilityResult, type BookingRequestSaved } from './shared';
export { siteUrl, absoluteUrl, checkoutPath, propertyUrl, bookingPageUrl, type CheckoutStay, type CheckoutGuest } from './urls';

/** A concierge failure as a tool result. */
export interface ConciergeError {
  error: string;
  /** DomainError code (BAD_REQUEST, NOT_FOUND, CONFLICT, FORBIDDEN, RATE_LIMITED, …), VALIDATION or INTERNAL. */
  code: string;
  /** The HTTP status a REST route would answer with. */
  status: number;
  details?: Record<string, unknown>;
}

/**
 * Any error from a concierge call as `{ error, code, status }`: validation
 * issues listed so a model can correct itself, domain errors as written,
 * anything else logged and replaced by a generic line.
 */
export function conciergeError(e: unknown): ConciergeError {
  if (e instanceof ZodError) {
    return { error: `Invalid arguments: ${e.issues.map((i) => `${i.path.join('.') || 'input'} ${i.message}`).join('; ')}`, code: 'VALIDATION', status: 400 };
  }
  if (e instanceof DomainError) return { error: e.message, code: e.code, status: e.status, ...(e.details ? { details: e.details } : {}) };
  console.error('[concierge] failed', e);
  return { error: 'That didn’t work just now — please try again shortly.', code: 'INTERNAL', status: 500 };
}
