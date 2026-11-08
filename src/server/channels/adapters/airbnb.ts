/**
 * Airbnb adapter - Airbnb API for software connections (JSON over HTTPS).
 *
 *   GET  /listings?user_id=:host            listings (one per room type; hotels use multi-unit listings)
 *   POST /calendar_operations               price, availability, units left and min nights per date range
 *   Webhook notifications                   reservation acceptance, alteration and cancellation
 *
 * The API is only open to approved software partners and the reference is not public,
 * so field names follow the partner documentation as known to us and must be
 * confirmed during Airbnb's certification. Requests carry the partner API key
 * (AIRBNB_API_KEY) and the host's OAuth token (the connection's password).
 */
import {
  AriPushResult,
  AriUpdate,
  ChannelAdapter,
  ChannelApiError,
  ChannelCredentials,
  ConnectionTestResult,
  OtaPromotionPayload,
  OtaReservation,
  OtaReservationAction,
  OtaRoomType,
  ReservationConfirmation,
  WebhookOutcome,
  WebhookReply,
  WebhookRequest,
} from '../types';

const API_BASE_URL = (process.env.AIRBNB_API_BASE_URL || 'https://api.airbnb.com/v2').replace(/\/$/, '');

export class AirbnbAdapter implements ChannelAdapter {
  constructor(private readonly creds: ChannelCredentials) {}

  private headers(): Record<string, string> {
    const apiKey = process.env.AIRBNB_API_KEY;
    if (!apiKey) throw new ChannelApiError('Airbnb live mode needs AIRBNB_API_KEY (issued to approved software partners)');
    if (!this.creds.password) throw new ChannelApiError('Enter the host OAuth access token');
    return {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-Airbnb-API-Key': apiKey,
      'X-Airbnb-OAuth-Token': this.creds.password,
    };
  }

  private async request<T = any>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${API_BASE_URL}${path}`, {
        method,
        headers: this.headers(),
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(30000),
        cache: 'no-store',
      });
    } catch (error) {
      if (error instanceof ChannelApiError) throw error;
      throw new ChannelApiError('Could not reach the Airbnb API', { error: error instanceof Error ? error.message : String(error) });
    }
    const data = await response.json().catch(() => ({}));
    if (response.status === 401 || response.status === 403) {
      throw new ChannelApiError(`Airbnb rejected the credentials (HTTP ${response.status}). The host may need to reconnect.`, data);
    }
    if (!response.ok) {
      const message = data?.error_message ?? data?.error ?? data?.message;
      throw new ChannelApiError(`Airbnb API returned HTTP ${response.status}${message ? `: ${message}` : ''}`, data);
    }
    return data as T;
  }

  private async listings(): Promise<any[]> {
    const data = await this.request('GET', `/listings?user_id=${encodeURIComponent(this.creds.otaPropertyId)}&_limit=50`);
    return Array.isArray(data?.listings) ? data.listings : [];
  }

  async testConnection(): Promise<ConnectionTestResult> {
    const listings = await this.listings();
    return {
      ok: true,
      message: `Connected to Airbnb host ${this.creds.otaPropertyId} (${listings.length} listings)`,
      otaPropertyName: listings[0]?.name ? String(listings[0].name) : undefined,
    };
  }

  /** Each listing is a room type; Airbnb has one nightly price per listing, so one "Standard" rate plan */
  async fetchRoomTypes(): Promise<OtaRoomType[]> {
    return (await this.listings())
      .filter((listing) => listing?.id !== undefined && listing?.has_availability !== false)
      .map((listing) => ({
        id: String(listing.id),
        name: String(listing.name ?? `Listing ${listing.id}`),
        ratePlans: [{ id: 'standard', name: 'Nightly price' }],
      }));
  }

  /** One calendar operation per update; operations are grouped per listing */
  calendarOperations(updates: AriUpdate[]): Array<{ listing_id: string; operations: Record<string, unknown>[] }> {
    const byListing = new Map<string, Record<string, unknown>[]>();
    for (const update of updates) {
      const operation: Record<string, unknown> = { dates: [`${update.from}:${update.to}`] };
      if (update.price !== null) operation.daily_price = Math.round(update.price);
      if (update.available !== null) operation.available_count = update.available;
      if (update.closed !== null || update.available !== null) {
        operation.availability = update.closed || update.available === 0 ? 'unavailable' : 'available';
      }
      if (update.minStay !== null) operation.min_nights = update.minStay;
      if (Object.keys(operation).length === 1) continue;
      byListing.set(update.otaRoomTypeId, [...(byListing.get(update.otaRoomTypeId) ?? []), operation]);
    }
    return Array.from(byListing.entries()).map(([listing_id, operations]) => ({ listing_id, operations }));
  }

  async pushAri(updates: AriUpdate[]): Promise<AriPushResult> {
    const batches = this.calendarOperations(updates);
    const warnings: string[] = [];
    for (const batch of batches) {
      const data = await this.request('POST', '/calendar_operations?_allow_dates_overlap=true', batch);
      for (const failure of Array.isArray(data?.calendar_operations_failures) ? data.calendar_operations_failures : []) {
        warnings.push(String(failure?.error_message ?? JSON.stringify(failure)));
      }
    }
    return { requests: batches.length, updates: updates.length, warnings };
  }

  /** Airbnb sends reservations to the webhook */
  async pullReservations(): Promise<OtaReservation[]> {
    return [];
  }

  async confirmReservations(_confirmations: ReservationConfirmation[]): Promise<void> {}

  async upsertPromotion(_promotion: OtaPromotionPayload): Promise<{ externalId: string }> {
    throw new ChannelApiError('Airbnb discounts are set on the listing in Airbnb; HotelOne can\'t publish promotions there yet.');
  }

  parseWebhook(request: WebhookRequest): OtaReservation[] {
    let payload: any;
    try {
      payload = JSON.parse(request.body);
    } catch {
      throw new ChannelApiError('Airbnb webhook body is not JSON');
    }
    const reservation = payload?.reservation ?? payload?.data?.reservation;
    if (!reservation?.confirmation_code) return [];
    return [parseAirbnbReservation(reservation, String(payload.action ?? payload.event ?? ''))];
  }

  webhookResponse(_request: WebhookRequest, outcome: WebhookOutcome): WebhookReply {
    return {
      status: outcome.error ? 422 : 200,
      contentType: 'application/json',
      body: JSON.stringify(outcome.error ? { succeed: false, error: outcome.error } : { succeed: true }),
    };
  }
}

export function parseAirbnbReservation(reservation: any, event: string): OtaReservation {
  const status = String(reservation.status_type ?? reservation.status ?? '').toLowerCase();
  const action: OtaReservationAction =
    /cancel/.test(event) || /cancel|denied/.test(status) ? 'CANCEL' : /alteration|modif/.test(event) ? 'MODIFY' : 'BOOK';
  const details = reservation.guest_details ?? {};
  const amount = reservation.expected_payout_amount_accurate ?? reservation.total_paid_amount_accurate ?? reservation.expected_payout_amount;
  const phones: unknown[] = Array.isArray(reservation.guest_phone_numbers) ? reservation.guest_phone_numbers : [];
  const code = String(reservation.confirmation_code);
  return {
    externalId: code,
    reservationGroupId: code,
    action,
    otaRoomTypeId: reservation.listing_id !== undefined ? String(reservation.listing_id) : null,
    otaRatePlanId: 'standard',
    checkIn: reservation.start_date ?? null,
    checkOut: reservation.end_date ?? null,
    rooms: Number(reservation.number_of_units ?? 1) || 1,
    adults: Number(details.number_of_adults ?? reservation.number_of_guests ?? 1) || 1,
    children: Number(details.number_of_children ?? 0) || 0,
    totalAmount: amount !== undefined && amount !== null && !Number.isNaN(Number(amount)) ? Number(amount) : null,
    currency: reservation.currency ?? null,
    guest: {
      firstName: String(reservation.guest_first_name ?? 'Airbnb'),
      lastName: String(reservation.guest_last_name ?? 'Guest'),
      email: reservation.guest_email ?? null,
      phone: phones.length > 0 ? String(phones[0]) : null,
    },
    specialRequests: null,
    paymentModel: 'Airbnb collects payment (payout to host)',
    raw: reservation,
  };
}
