/**
 * Expedia adapter - Expedia QuickConnect (EQC) XML APIs.
 *
 *   PARR  ProductAvailRateRetrieval - room types & rate plans (also used to verify credentials)
 *   AR    AvailRateUpdate           - push availability, rates and restrictions
 *   BR    BookingRetrieval          - pull new / modified / cancelled bookings
 *   BC    BookingConfirm            - send PMS confirmation numbers back
 *
 * Promotions go through the Expedia Partner Central promotions REST API.
 * Access to all of these requires Expedia connectivity-partner certification;
 * endpoints are configurable so the certification simulator can be targeted.
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
} from '../types';
import { asArray, attr, chunk, esc, parseXml, postXml, text } from '../xml';

const EQC_BASE_URL = process.env.EXPEDIA_EQC_BASE_URL || 'https://services.expediapartnercentral.com';
const API_BASE_URL = process.env.EXPEDIA_API_BASE_URL || 'https://services.expediapartnercentral.com';

const NS_AR = 'http://www.expediaconnect.com/EQC/AR/2011/06';
const NS_PAR = 'http://www.expediaconnect.com/EQC/PAR/2013/07';
const NS_BR = 'http://www.expediaconnect.com/EQC/BR/2014/01';
const NS_BC = 'http://www.expediaconnect.com/EQC/BC/2007/09';

// EQC accepts many AvailRateUpdate elements per message; keep requests small
const AR_UPDATES_PER_REQUEST = 100;

const PROMOTION_CATEGORIES = {
  BASIC: 'BASIC_PROMOTION',
  EARLY_BOOKER: 'EARLY_BOOKING_PROMOTION',
  LAST_MINUTE: 'BASIC_PROMOTION', // last-minute = basic promotion with a max advance-booking window
  MULTI_NIGHT: 'MULTI_NIGHT_PROMOTION',
} as const;

export class ExpediaAdapter implements ChannelAdapter {
  constructor(private readonly creds: ChannelCredentials) {}

  private authXml(): string {
    return `<Authentication username="${esc(this.creds.username)}" password="${esc(this.creds.password)}"/>
  <Hotel id="${esc(this.creds.otaPropertyId)}"/>`;
  }

  /** Throws if an EQC response contains <Error> elements */
  private checkErrors(response: Record<string, any>, rootName: string): Record<string, any> {
    const root = response[rootName];
    if (!root) {
      throw new ChannelApiError(`Unexpected Expedia response (missing ${rootName})`, response);
    }
    const errors = asArray(root.Error);
    if (errors.length > 0) {
      const messages = errors.map((e) => `${attr(e, 'code') ?? ''} ${text(e)}`.trim());
      throw new ChannelApiError(`Expedia error: ${messages.join('; ')}`, errors);
    }
    return root;
  }

  private async productRetrieval(): Promise<Record<string, any>> {
    const body = `<?xml version="1.0" encoding="UTF-8"?>
<ProductAvailRateRetrievalRQ xmlns="${NS_PAR}">
  ${this.authXml()}
  <ParamSet>
    <ProductRetrieval/>
  </ParamSet>
</ProductAvailRateRetrievalRQ>`;
    const xml = await postXml({ url: `${EQC_BASE_URL}/eqc/parr`, body });
    return this.checkErrors(parseXml(xml), 'ProductAvailRateRetrievalRS');
  }

  async testConnection(): Promise<ConnectionTestResult> {
    const root = await this.productRetrieval();
    const hotel = root.ProductList?.Hotel;
    const roomCount = asArray(root.ProductList?.RoomType).length;
    return {
      ok: true,
      message: `Connected to Expedia property ${this.creds.otaPropertyId} (${roomCount} room types)`,
      otaPropertyName: attr(hotel, 'name'),
    };
  }

  async fetchRoomTypes(): Promise<OtaRoomType[]> {
    const root = await this.productRetrieval();
    return asArray(root.ProductList?.RoomType)
      .filter((room) => (attr(room, 'status') ?? 'Active').toLowerCase() === 'active')
      .map((room) => ({
        id: attr(room, 'id') ?? '',
        name: attr(room, 'name') ?? attr(room, 'code') ?? `Room ${attr(room, 'id')}`,
        ratePlans: asArray(room.RatePlan)
          .filter((plan: any) => (attr(plan, 'status') ?? 'Active').toLowerCase() === 'active')
          .map((plan: any) => ({
            id: attr(plan, 'id') ?? '',
            name: attr(plan, 'name') ?? attr(plan, 'code') ?? `Rate plan ${attr(plan, 'id')}`,
          })),
      }));
  }

  private availRateUpdateXml(update: AriUpdate): string | null {
    const closedAttr = update.closed === null ? '' : ` closed="${update.closed}"`;
    const rateXml =
      update.price === null
        ? ''
        : `<Rate currency="${esc(this.creds.currency)}"><PerDay rate="${update.price.toFixed(2)}"/></Rate>`;
    const restrictionsXml = update.minStay === null ? '' : `<Restrictions minLOS="${update.minStay}"/>`;
    const ratePlanXml =
      rateXml || restrictionsXml || closedAttr
        ? `<RatePlan id="${esc(update.otaRatePlanId)}"${closedAttr}>${rateXml}${restrictionsXml}</RatePlan>`
        : '';
    const inventoryXml =
      update.available === null ? '' : `<Inventory totalInventoryAvailable="${update.available}"/>`;

    if (!ratePlanXml && !inventoryXml) return null;
    return `<AvailRateUpdate>
    <DateRange from="${update.from}" to="${update.to}"/>
    <RoomType id="${esc(update.otaRoomTypeId)}">${inventoryXml}${ratePlanXml}</RoomType>
  </AvailRateUpdate>`;
  }

  async pushAri(updates: AriUpdate[]): Promise<AriPushResult> {
    const blocks = updates
      .map((update) => this.availRateUpdateXml(update))
      .filter((block): block is string => block !== null);
    const warnings: string[] = [];
    let requests = 0;

    for (const batch of chunk(blocks, AR_UPDATES_PER_REQUEST)) {
      const body = `<?xml version="1.0" encoding="UTF-8"?>
<AvailRateUpdateRQ xmlns="${NS_AR}">
  ${this.authXml()}
  ${batch.join('\n  ')}
</AvailRateUpdateRQ>`;
      const xml = await postXml({ url: `${EQC_BASE_URL}/eqc/ar`, body });
      const root = this.checkErrors(parseXml(xml), 'AvailRateUpdateRS');
      for (const warning of asArray(root.Success?.Warning)) {
        warnings.push(`${attr(warning, 'code') ?? ''} ${text(warning)}`.trim());
      }
      requests++;
    }

    return { requests, updates: blocks.length, warnings };
  }

  async pullReservations(): Promise<OtaReservation[]> {
    const body = `<?xml version="1.0" encoding="UTF-8"?>
<BookingRetrievalRQ xmlns="${NS_BR}">
  ${this.authXml()}
  <ParamSet>
    <Status value="pending"/>
  </ParamSet>
</BookingRetrievalRQ>`;
    const xml = await postXml({ url: `${EQC_BASE_URL}/eqc/br`, body });
    const root = this.checkErrors(parseXml(xml), 'BookingRetrievalRS');

    return asArray(root.Bookings?.Booking).map((booking: any) => {
      const type = (attr(booking, 'type') ?? 'Book').toLowerCase();
      const action: OtaReservationAction =
        type === 'cancel' ? 'CANCEL' : type === 'modify' ? 'MODIFY' : 'BOOK';
      const roomStay = booking.RoomStay ?? {};
      const total = roomStay.Total;
      const guestName = booking.PrimaryGuest?.Name;
      const phone = booking.PrimaryGuest?.Phone;
      const phoneNumber = phone
        ? [attr(phone, 'countryCode'), attr(phone, 'cityAreaCode'), attr(phone, 'number')]
            .filter(Boolean)
            .join(' ')
        : null;
      const specialRequests = asArray(booking.SpecialRequest)
        .map((request) => text(request))
        .filter(Boolean)
        .join('\n');
      const id = attr(booking, 'id') ?? '';
      const amount = attr(total, 'amountAfterTaxes');

      return {
        externalId: id,
        reservationGroupId: id,
        action,
        otaRoomTypeId: attr(roomStay, 'roomTypeID') ?? null,
        otaRatePlanId: attr(roomStay, 'ratePlanID') ?? null,
        checkIn: attr(roomStay.StayDate, 'arrival') ?? null,
        checkOut: attr(roomStay.StayDate, 'departure') ?? null,
        rooms: 1, // EQC sends one booking per room
        adults: Number(attr(roomStay.GuestCount, 'adult') ?? 1),
        children: Number(attr(roomStay.GuestCount, 'child') ?? 0),
        totalAmount: amount ? Number(amount) : null,
        currency: attr(total, 'currency') ?? null,
        guest: {
          firstName: attr(guestName, 'givenName') ?? 'Expedia',
          lastName: attr(guestName, 'surname') ?? 'Guest',
          email: text(booking.PrimaryGuest?.Email) || null,
          phone: phoneNumber,
        },
        specialRequests: specialRequests || null,
        paymentModel: roomStay.PaymentCard ? 'Hotel Collect' : 'Expedia Collect',
        raw: booking,
      };
    });
  }

  async confirmReservations(confirmations: ReservationConfirmation[]): Promise<void> {
    if (confirmations.length === 0) return;
    const confirmTime = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
    const typeNames: Record<OtaReservationAction, string> = { BOOK: 'Book', MODIFY: 'Modify', CANCEL: 'Cancel' };
    const numbers = confirmations
      .map(
        (c) =>
          `<BookingConfirmNumber bookingID="${esc(c.reservationGroupId)}" bookingType="${typeNames[c.action]}" confirmNumber="${esc(c.pmsConfirmationNumber)}" confirmTime="${confirmTime}"/>`
      )
      .join('\n    ');
    const body = `<?xml version="1.0" encoding="UTF-8"?>
<BookingConfirmRQ xmlns="${NS_BC}">
  ${this.authXml()}
  <BookingConfirmNumbers>
    ${numbers}
  </BookingConfirmNumbers>
</BookingConfirmRQ>`;
    const xml = await postXml({ url: `${EQC_BASE_URL}/eqc/bc`, body });
    this.checkErrors(parseXml(xml), 'BookingConfirmRS');
  }

  async upsertPromotion(promotion: OtaPromotionPayload): Promise<{ externalId: string }> {
    const payload = {
      name: promotion.name,
      category: PROMOTION_CATEGORIES[promotion.type],
      status: promotion.active ? 'ACTIVE' : 'INACTIVE',
      discount: { type: 'PERCENT', value: promotion.discountPercent },
      restrictions: {
        travelDateFrom: promotion.stayStart,
        travelDateTo: promotion.stayEnd,
        bookingLocalDateTimeFrom: promotion.bookStart ? `${promotion.bookStart}T00:00:00` : undefined,
        bookingLocalDateTimeTo: promotion.bookEnd ? `${promotion.bookEnd}T23:59:59` : undefined,
        minLengthOfStay: promotion.minStay ?? undefined,
        minAdvanceBookingDays: promotion.minDaysInAdvance ?? undefined,
        maxAdvanceBookingDays: promotion.maxDaysInAdvance ?? undefined,
        isMemberOnly: false,
        isMobileUserOnly: false,
      },
      eligibleRatePlans: promotion.otaRatePlanIds.map((id) => ({ id })),
    };

    const base = `${API_BASE_URL}/properties/${encodeURIComponent(this.creds.otaPropertyId)}/promotions`;
    const url = promotion.externalId ? `${base}/${encodeURIComponent(promotion.externalId)}` : base;

    let response: Response;
    try {
      response = await fetch(url, {
        method: promotion.externalId ? 'PUT' : 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization:
            'Basic ' + Buffer.from(`${this.creds.username}:${this.creds.password}`).toString('base64'),
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(30000),
        cache: 'no-store',
      });
    } catch (error) {
      throw new ChannelApiError('Could not reach the Expedia promotions API', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const errors = asArray(data?.errors).map((e: any) => e?.message ?? JSON.stringify(e));
      throw new ChannelApiError(
        `Expedia promotions API returned HTTP ${response.status}${errors.length ? `: ${errors.join('; ')}` : ''}`,
        data
      );
    }

    const externalId = String(data?.entity?.id ?? data?.id ?? promotion.externalId ?? '');
    if (!externalId) {
      throw new ChannelApiError('Expedia did not return a promotion ID', data);
    }
    return { externalId };
  }
}
