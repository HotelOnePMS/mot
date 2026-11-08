/**
 * Channex adapter - reaches an OTA through Channex (channex.io), a white-label
 * channel manager API sold to PMS companies. Channex holds the certified OTA
 * connections (Booking.com, Expedia, Airbnb, Agoda, Trip.com, Hostelworld and more),
 * so a hotel can go live without HotelOne being certified by each OTA.
 *
 *   GET  /properties/:id                          verify the API key and property
 *   GET  /room_types, /rate_plans                 Channex rooms and rates (mapped to the OTA inside Channex)
 *   POST /availability                            rooms left per room type and date range
 *   POST /restrictions                            rate, min stay, stop sell per rate plan and date range
 *   GET  /booking_revisions/feed                  unacknowledged booking revisions
 *   POST /booking_revisions/:id/ack               acknowledge once saved in HotelOne
 *
 * Auth: `user-api-key` header. One Channex property can serve several OTAs; each
 * HotelOne connection only imports the revisions whose ota_name is its OTA.
 */
import type { OtaChannel } from '@prisma/client';
import {
  AriPushResult,
  AriUpdate,
  CHANNEL_LABELS,
  ChannelAdapter,
  ChannelApiError,
  ChannelCredentials,
  ConnectionTestResult,
  OtaPromotionPayload,
  OtaReservation,
  OtaReservationAction,
  OtaRoomType,
  ReservationConfirmation,
} from '../types';

const API_BASE_URL = (process.env.CHANNEX_API_BASE_URL || 'https://app.channex.io/api/v1').replace(/\/$/, '');

/** ota_name values Channex uses, per HotelOne channel (matched case-insensitively, by prefix) */
const OTA_NAMES: Record<OtaChannel, string[]> = {
  EXPEDIA: ['expedia'],
  BOOKING_COM: ['booking.com', 'bookingcom'],
  GOOGLE_HOTELS: ['google'],
  AIRBNB: ['airbnb'],
  AGODA: ['agoda'],
  TRIP_COM: ['trip.com', 'ctrip', 'tripcom'],
  HOPPER: ['hopper'],
  PRICELINE: ['priceline'],
  HOSTELWORLD: ['hostelworld'],
};

export function matchesChannel(otaName: unknown, channel: OtaChannel): boolean {
  const name = String(otaName ?? '').toLowerCase().replace(/\s+/g, '');
  return OTA_NAMES[channel].some((prefix) => name.startsWith(prefix.replace(/\s+/g, '')));
}

export class ChannexAdapter implements ChannelAdapter {
  /** Revision IDs per reservation group, from the last pull, to acknowledge after import */
  private readonly revisionIds = new Map<string, string[]>();
  private readonly label: string;

  constructor(private readonly creds: ChannelCredentials) {
    this.label = CHANNEL_LABELS[creds.channel];
  }

  private async request<T = any>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    if (!this.creds.password) throw new ChannelApiError('Enter the Channex API key');
    let response: Response;
    try {
      response = await fetch(`${API_BASE_URL}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'user-api-key': this.creds.password },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(30000),
        cache: 'no-store',
      });
    } catch (error) {
      throw new ChannelApiError('Could not reach Channex', { error: error instanceof Error ? error.message : String(error) });
    }
    const data = await response.json().catch(() => ({}));
    if (response.status === 401 || response.status === 403) {
      throw new ChannelApiError(`Channex rejected the API key (HTTP ${response.status})`, data);
    }
    if (!response.ok) {
      const errors = data?.errors ? JSON.stringify(data.errors).slice(0, 300) : '';
      throw new ChannelApiError(`Channex returned HTTP ${response.status}${errors ? `: ${errors}` : ''}`, data);
    }
    return data as T;
  }

  private get propertyFilter(): string {
    return `filter[property_id]=${encodeURIComponent(this.creds.otaPropertyId)}`;
  }

  async testConnection(): Promise<ConnectionTestResult> {
    const data = await this.request('GET', `/properties/${encodeURIComponent(this.creds.otaPropertyId)}`);
    const title = data?.data?.attributes?.title;
    return {
      ok: true,
      message: `Connected to Channex property ${title ?? this.creds.otaPropertyId}. ${this.label} is connected and mapped inside Channex.`,
      otaPropertyName: title ? String(title) : undefined,
    };
  }

  async fetchRoomTypes(): Promise<OtaRoomType[]> {
    const [rooms, plans] = await Promise.all([
      this.request('GET', `/room_types?${this.propertyFilter}&pagination[limit]=100`),
      this.request('GET', `/rate_plans?${this.propertyFilter}&pagination[limit]=100`),
    ]);
    const ratePlans = (Array.isArray(plans?.data) ? plans.data : []).map((plan: any) => ({
      id: String(plan.id),
      name: String(plan.attributes?.title ?? `Rate plan ${plan.id}`),
      roomTypeId: String(plan.relationships?.room_type?.data?.id ?? plan.attributes?.room_type_id ?? ''),
    }));
    return (Array.isArray(rooms?.data) ? rooms.data : []).map((room: any) => ({
      id: String(room.id),
      name: String(room.attributes?.title ?? `Room ${room.id}`),
      ratePlans: ratePlans.filter((plan: any) => plan.roomTypeId === String(room.id)).map(({ id, name }: any) => ({ id, name })),
    }));
  }

  ariBodies(updates: AriUpdate[]) {
    const property_id = this.creds.otaPropertyId;
    const availability = updates
      .filter((u) => u.available !== null)
      .map((u) => ({ property_id, room_type_id: u.otaRoomTypeId, date_from: u.from, date_to: u.to, availability: u.available }));
    const restrictions = updates
      .map((u) => {
        const value: Record<string, unknown> = { property_id, rate_plan_id: u.otaRatePlanId, date_from: u.from, date_to: u.to };
        if (u.price !== null) value.rate = u.price.toFixed(2);
        if (u.minStay !== null) value.min_stay_arrival = u.minStay;
        if (u.closed !== null) value.stop_sell = u.closed;
        return Object.keys(value).length > 4 ? value : null;
      })
      .filter((v): v is Record<string, unknown> => v !== null);
    return { availability, restrictions };
  }

  /** Channex takes any number of changes per call (under 10 MB), so one call each */
  async pushAri(updates: AriUpdate[]): Promise<AriPushResult> {
    const { availability, restrictions } = this.ariBodies(updates);
    const warnings: string[] = [];
    let requests = 0;
    for (const [path, values] of [['/availability', availability], ['/restrictions', restrictions]] as const) {
      if (values.length === 0) continue;
      const data = await this.request('POST', path, { values });
      for (const warning of Array.isArray(data?.meta?.warnings) ? data.meta.warnings : []) warnings.push(JSON.stringify(warning));
      requests++;
    }
    return { requests, updates: updates.length, warnings };
  }

  async pullReservations(): Promise<OtaReservation[]> {
    const data = await this.request('GET', `/booking_revisions/feed?${this.propertyFilter}&order[inserted_at]=asc`);
    const revisions: any[] = Array.isArray(data?.data) ? data.data : [];
    const reservations: OtaReservation[] = [];
    this.revisionIds.clear();
    for (const revision of revisions) {
      const attributes = revision.attributes ?? {};
      if (!matchesChannel(attributes.ota_name, this.creds.channel)) continue;
      const parsed = parseChannexRevision({ id: revision.id, ...attributes }, this.label);
      if (parsed.length === 0) continue;
      const group = parsed[0].reservationGroupId;
      this.revisionIds.set(group, [...(this.revisionIds.get(group) ?? []), String(revision.id)]);
      reservations.push(...parsed);
    }
    return reservations;
  }

  /** Acknowledges the revisions that were saved; the rest come back in the next feed */
  async confirmReservations(confirmations: ReservationConfirmation[]): Promise<void> {
    for (const confirmation of confirmations) {
      for (const id of this.revisionIds.get(confirmation.reservationGroupId) ?? []) {
        await this.request('POST', `/booking_revisions/${encodeURIComponent(id)}/ack`);
      }
      this.revisionIds.delete(confirmation.reservationGroupId);
    }
  }

  async upsertPromotion(_promotion: OtaPromotionPayload): Promise<{ externalId: string }> {
    throw new ChannelApiError(`Promotions for ${this.label} through Channex are set in the ${this.label} extranet.`);
  }
}

/** One Channex booking revision to normalized reservations (one per room type) */
export function parseChannexRevision(revision: any, label: string): OtaReservation[] {
  const groupId = String(revision.ota_reservation_code ?? revision.booking_id ?? revision.id ?? '');
  if (!groupId) return [];
  const status = String(revision.status ?? 'new').toLowerCase();
  const action: OtaReservationAction = status === 'cancelled' ? 'CANCEL' : status === 'modified' ? 'MODIFY' : 'BOOK';
  const customer = revision.customer ?? {};
  const guest = {
    firstName: String(customer.name ?? label),
    lastName: String(customer.surname ?? 'Guest'),
    email: customer.mail ?? null,
    phone: customer.phone ?? null,
  };
  const rooms: any[] = Array.isArray(revision.rooms) ? revision.rooms : [];
  const base = {
    reservationGroupId: groupId,
    action,
    checkIn: revision.arrival_date ?? null,
    checkOut: revision.departure_date ?? null,
    currency: revision.currency ?? null,
    guest,
    specialRequests: revision.notes ? String(revision.notes) : null,
    paymentModel: revision.payment_collect === 'property' ? `Hotel collect (${label} via Channex)` : `${label} via Channex`,
    raw: revision,
  };
  if (rooms.length === 0) {
    const total = Number(revision.amount);
    return [{ ...base, externalId: groupId, otaRoomTypeId: null, otaRatePlanId: null, rooms: 0, adults: 0, children: 0, totalAmount: Number.isFinite(total) ? total : null }];
  }

  const byRoomType = new Map<string, any[]>();
  for (const room of rooms) {
    const key = String(room.room_type_id ?? '');
    byRoomType.set(key, [...(byRoomType.get(key) ?? []), room]);
  }
  const split = byRoomType.size > 1;
  return Array.from(byRoomType.entries()).map(([roomTypeId, list]) => {
    const amounts = list.map((r) => Number(r.amount)).filter((n) => Number.isFinite(n));
    const total = Number(revision.amount);
    return {
      ...base,
      externalId: split ? `${groupId}-${roomTypeId}` : groupId,
      otaRoomTypeId: roomTypeId || null,
      otaRatePlanId: list[0].rate_plan_id ? String(list[0].rate_plan_id) : null,
      rooms: list.length,
      adults: Math.max(1, list.reduce((sum, r) => sum + Number(r.occupancy?.adults ?? 0), 0)),
      children: list.reduce((sum, r) => sum + Number(r.occupancy?.children ?? 0) + Number(r.occupancy?.infants ?? 0), 0),
      totalAmount: !split && Number.isFinite(total) ? total : amounts.length ? amounts.reduce((a, b) => a + b, 0) : null,
    };
  });
}
