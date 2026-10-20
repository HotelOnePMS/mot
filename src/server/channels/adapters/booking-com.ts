/**
 * Booking.com adapter - Booking.com Connectivity APIs.
 *
 *   B.XML roomrates               - rooms & rates for the hotel (also used to verify credentials)
 *   OTA_HotelAvailNotif           - rooms to sell, open/close, min stay
 *   OTA_HotelRateAmountNotif      - prices
 *   OTA_HotelResNotif             - new reservations (+ acknowledgement)
 *   OTA_HotelResModifyNotif       - modifications & cancellations (+ acknowledgement)
 *   B.XML promotions              - create / update / deactivate promotions
 *
 * Requests authenticate with the provider's machine account (HTTP Basic).
 * Access requires Booking.com connectivity-partner certification.
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

const SUPPLY_URL = process.env.BOOKING_COM_SUPPLY_URL || 'https://supply-xml.booking.com';
const SECURE_URL = process.env.BOOKING_COM_SECURE_URL || 'https://secure-supply-xml.booking.com';
const OTA_NS = 'http://www.opentravel.org/OTA/2003/05';
const MESSAGES_PER_REQUEST = 100;

const PROMOTION_TYPES = {
  BASIC: 'basic',
  EARLY_BOOKER: 'early_booker',
  LAST_MINUTE: 'last_minute',
  MULTI_NIGHT: 'basic', // multi-night = basic promotion with a minimum stay
} as const;

// OTA AgeQualifyingCode values
const AGE_ADULT = '10';
const AGE_CHILD = '8';

function timestamp(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, '+00:00');
}

export class BookingComAdapter implements ChannelAdapter {
  constructor(private readonly creds: ChannelCredentials) {}

  private get auth() {
    return { username: this.creds.username, password: this.creds.password };
  }

  /** B.XML endpoints report problems as <fault>, <error> or <errors> */
  private checkBxmlErrors(response: Record<string, any>): void {
    const messages: string[] = [];
    const collect = (node: unknown) => {
      for (const item of asArray(node as any)) {
        const message = attr(item, 'string') ?? text(item) ?? '';
        const code = attr(item, 'code');
        messages.push([code, message].filter(Boolean).join(' '));
      }
    };
    collect(response.fault);
    collect(response.error);
    collect(response.errors?.error);
    for (const root of Object.values(response)) {
      if (root && typeof root === 'object') {
        collect((root as any).fault);
        collect((root as any).error);
        collect((root as any).errors?.error);
      }
    }
    if (messages.length > 0) {
      throw new ChannelApiError(`Booking.com error: ${messages.join('; ')}`, response);
    }
  }

  /** OTA endpoints report problems in <Errors><Error ShortText="..."/></Errors> */
  private checkOtaErrors(response: Record<string, any>, rootName: string): Record<string, any> {
    const root = response[rootName];
    if (!root) {
      this.checkBxmlErrors(response);
      throw new ChannelApiError(`Unexpected Booking.com response (missing ${rootName})`, response);
    }
    const errors = asArray(root.Errors?.Error);
    if (errors.length > 0) {
      const messages = errors.map((e) => `${attr(e, 'Code') ?? ''} ${attr(e, 'ShortText') ?? text(e)}`.trim());
      throw new ChannelApiError(`Booking.com error: ${messages.join('; ')}`, errors);
    }
    return root;
  }

  private async roomRates(): Promise<Record<string, any>> {
    const body = `<?xml version="1.0" encoding="UTF-8"?>
<request>
  <hotel_id>${esc(this.creds.otaPropertyId)}</hotel_id>
</request>`;
    const xml = await postXml({ url: `${SUPPLY_URL}/hotels/xml/roomrates`, body, basicAuth: this.auth });
    const response = parseXml(xml);
    this.checkBxmlErrors(response);
    return response;
  }

  async testConnection(): Promise<ConnectionTestResult> {
    const response = await this.roomRates();
    const rooms = asArray(response.rooms?.room);
    return {
      ok: true,
      message: `Connected to Booking.com hotel ${this.creds.otaPropertyId} (${rooms.length} rooms)`,
      otaPropertyName: attr(rooms[0], 'hotel_name'),
    };
  }

  async fetchRoomTypes(): Promise<OtaRoomType[]> {
    const response = await this.roomRates();
    return asArray(response.rooms?.room).map((room: any) => ({
      id: attr(room, 'id') ?? '',
      name: attr(room, 'room_name') ?? `Room ${attr(room, 'id')}`,
      ratePlans: asArray(room.rates?.rate)
        .filter((rate: any) => attr(rate, 'readonly') !== '1')
        .map((rate: any) => ({
          id: attr(rate, 'id') ?? '',
          name: attr(rate, 'rate_name') ?? `Rate ${attr(rate, 'id')}`,
        })),
    }));
  }

  private availMessages(update: AriUpdate): string[] {
    const control = (withRatePlan: boolean) =>
      `<StatusApplicationControl Start="${update.from}" End="${update.to}" InvTypeCode="${esc(update.otaRoomTypeId)}"${
        withRatePlan ? ` RatePlanCode="${esc(update.otaRatePlanId)}"` : ''
      }/>`;
    const messages: string[] = [];

    // Rooms to sell is set per room, without a rate plan
    if (update.available !== null) {
      messages.push(`<AvailStatusMessage BookingLimit="${update.available}">${control(false)}</AvailStatusMessage>`);
    }
    if (update.closed !== null || update.minStay !== null) {
      const lengthOfStay =
        update.minStay === null
          ? ''
          : `<LengthsOfStay><LengthOfStay Time="${update.minStay}" TimeUnit="Day" MinMaxMessageType="SetMinLOS"/></LengthsOfStay>`;
      const status = update.closed === null ? '' : `<RestrictionStatus Status="${update.closed ? 'Close' : 'Open'}"/>`;
      messages.push(`<AvailStatusMessage>${control(true)}${lengthOfStay}${status}</AvailStatusMessage>`);
    }
    return messages;
  }

  private rateMessage(update: AriUpdate): string | null {
    if (update.price === null) return null;
    return `<RateAmountMessage>
      <StatusApplicationControl Start="${update.from}" End="${update.to}" InvTypeCode="${esc(update.otaRoomTypeId)}" RatePlanCode="${esc(update.otaRatePlanId)}"/>
      <Rates><Rate><BaseByGuestAmts><BaseByGuestAmt AmountAfterTax="${update.price.toFixed(2)}" DecimalPlaces="2" CurrencyCode="${esc(this.creds.currency)}"/></BaseByGuestAmts></Rate></Rates>
    </RateAmountMessage>`;
  }

  async pushAri(updates: AriUpdate[]): Promise<AriPushResult> {
    const hotelCode = esc(this.creds.otaPropertyId);
    const availMessages = updates.flatMap((update) => this.availMessages(update));
    const rateMessages = updates
      .map((update) => this.rateMessage(update))
      .filter((message): message is string => message !== null);
    const warnings: string[] = [];
    let requests = 0;

    const collectWarnings = (root: Record<string, any>) => {
      for (const warning of asArray(root.Warnings?.Warning)) {
        warnings.push(attr(warning, 'ShortText') ?? text(warning));
      }
    };

    for (const batch of chunk(availMessages, MESSAGES_PER_REQUEST)) {
      const body = `<?xml version="1.0" encoding="UTF-8"?>
<OTA_HotelAvailNotifRQ xmlns="${OTA_NS}" TimeStamp="${timestamp()}" Version="3.000">
  <AvailStatusMessages HotelCode="${hotelCode}">
    ${batch.join('\n    ')}
  </AvailStatusMessages>
</OTA_HotelAvailNotifRQ>`;
      const xml = await postXml({ url: `${SUPPLY_URL}/hotels/ota/OTA_HotelAvailNotif`, body, basicAuth: this.auth });
      collectWarnings(this.checkOtaErrors(parseXml(xml), 'OTA_HotelAvailNotifRS'));
      requests++;
    }

    for (const batch of chunk(rateMessages, MESSAGES_PER_REQUEST)) {
      const body = `<?xml version="1.0" encoding="UTF-8"?>
<OTA_HotelRateAmountNotifRQ xmlns="${OTA_NS}" TimeStamp="${timestamp()}" Version="3.000">
  <RateAmountMessages HotelCode="${hotelCode}">
    ${batch.join('\n    ')}
  </RateAmountMessages>
</OTA_HotelRateAmountNotifRQ>`;
      const xml = await postXml({
        url: `${SUPPLY_URL}/hotels/ota/OTA_HotelRateAmountNotif`,
        body,
        basicAuth: this.auth,
      });
      collectWarnings(this.checkOtaErrors(parseXml(xml), 'OTA_HotelRateAmountNotifRS'));
      requests++;
    }

    return { requests, updates: updates.length, warnings };
  }

  /** Turns one OTA HotelReservation into one normalized reservation per room type */
  private parseHotelReservation(reservation: any, fallbackAction: OtaReservationAction): OtaReservation[] {
    const resStatus = (attr(reservation, 'ResStatus') ?? '').toLowerCase();
    const action: OtaReservationAction =
      resStatus === 'cancel' || resStatus === 'cancelled'
        ? 'CANCEL'
        : resStatus === 'modify'
          ? 'MODIFY'
          : resStatus === 'commit' || resStatus === 'book'
            ? 'BOOK'
            : fallbackAction;

    const globalInfo = reservation.ResGlobalInfo ?? {};
    const reservationIds = asArray(globalInfo.HotelReservationIDs?.HotelReservationID);
    const groupId =
      attr(reservationIds[0], 'ResID_Value') ?? attr(reservation.UniqueID, 'ID') ?? '';
    if (!groupId) return [];

    const customer = asArray(reservation.ResGuests?.ResGuest)[0]?.Profiles?.ProfileInfo?.Profile?.Customer;
    const guest = {
      firstName: text(customer?.PersonName?.GivenName) || 'Booking.com',
      lastName: text(customer?.PersonName?.Surname) || 'Guest',
      email: text(customer?.Email) || null,
      phone: attr(customer?.Telephone, 'PhoneNumber') ?? null,
    };
    const globalTotal = globalInfo.Total;
    const roomStays = asArray(reservation.RoomStays?.RoomStay);

    // Cancellations may arrive without room stays
    if (roomStays.length === 0) {
      return [
        {
          externalId: groupId,
          reservationGroupId: groupId,
          action,
          otaRoomTypeId: null,
          otaRatePlanId: null,
          checkIn: null,
          checkOut: null,
          rooms: 0,
          adults: 0,
          children: 0,
          totalAmount: attr(globalTotal, 'AmountAfterTax') ? Number(attr(globalTotal, 'AmountAfterTax')) : null,
          currency: attr(globalTotal, 'CurrencyCode') ?? null,
          guest,
          specialRequests: null,
          paymentModel: null,
          raw: reservation,
        },
      ];
    }

    const byRoomType = new Map<string, any[]>();
    for (const stay of roomStays) {
      const roomTypeCode = attr(asArray(stay.RoomTypes?.RoomType)[0], 'RoomTypeCode') ?? '';
      byRoomType.set(roomTypeCode, [...(byRoomType.get(roomTypeCode) ?? []), stay]);
    }

    const split = byRoomType.size > 1;
    return Array.from(byRoomType.entries()).map(([roomTypeCode, stays]) => {
      const first = stays[0];
      let adults = 0;
      let children = 0;
      let total = 0;
      let hasTotal = false;
      const requests: string[] = [];
      for (const stay of stays) {
        for (const count of asArray(stay.GuestCounts?.GuestCount)) {
          const value = Number(attr(count, 'Count') ?? 0);
          if (attr(count, 'AgeQualifyingCode') === AGE_CHILD) children += value;
          else if ((attr(count, 'AgeQualifyingCode') ?? AGE_ADULT) === AGE_ADULT) adults += value;
        }
        const amount = attr(stay.Total, 'AmountAfterTax');
        if (amount) {
          total += Number(amount);
          hasTotal = true;
        }
        for (const request of asArray(stay.SpecialRequests?.SpecialRequest)) {
          const value = text(request.Text) || text(request);
          if (value) requests.push(value);
        }
      }
      const globalAmount = attr(globalTotal, 'AmountAfterTax');

      return {
        externalId: split ? `${groupId}-${roomTypeCode}` : groupId,
        reservationGroupId: groupId,
        action,
        otaRoomTypeId: roomTypeCode || null,
        otaRatePlanId: attr(asArray(first.RatePlans?.RatePlan)[0], 'RatePlanCode') ?? null,
        checkIn: attr(first.TimeSpan, 'Start') ?? null,
        checkOut: attr(first.TimeSpan, 'End') ?? null,
        rooms: stays.length,
        adults: Math.max(adults, 1),
        children,
        totalAmount: hasTotal ? total : !split && globalAmount ? Number(globalAmount) : null,
        currency: attr(first.Total, 'CurrencyCode') ?? attr(globalTotal, 'CurrencyCode') ?? null,
        guest,
        specialRequests: requests.join('\n') || null,
        paymentModel: 'Booking.com',
        raw: reservation,
      };
    });
  }

  async pullReservations(): Promise<OtaReservation[]> {
    const query = `?hotel_ids=${encodeURIComponent(this.creds.otaPropertyId)}`;
    const reservations: OtaReservation[] = [];

    const newXml = await postXml({
      url: `${SECURE_URL}/hotels/ota/OTA_HotelResNotif${query}`,
      body: '',
      method: 'GET',
      basicAuth: this.auth,
    });
    const newRoot = this.checkOtaErrors(parseXml(newXml), 'OTA_HotelResNotifRQ');
    for (const reservation of asArray(newRoot.HotelReservations?.HotelReservation)) {
      reservations.push(...this.parseHotelReservation(reservation, 'BOOK'));
    }

    const modifyXml = await postXml({
      url: `${SECURE_URL}/hotels/ota/OTA_HotelResModifyNotif${query}`,
      body: '',
      method: 'GET',
      basicAuth: this.auth,
    });
    const modifyRoot = this.checkOtaErrors(parseXml(modifyXml), 'OTA_HotelResModifyNotifRQ');
    for (const reservation of asArray(modifyRoot.HotelResModifies?.HotelResModify)) {
      reservations.push(...this.parseHotelReservation(reservation, 'MODIFY'));
    }

    return reservations;
  }

  async confirmReservations(confirmations: ReservationConfirmation[]): Promise<void> {
    const acknowledgement = (c: ReservationConfirmation, element: string) =>
      `<${element}>
      <UniqueID Type="14" ID="${esc(c.reservationGroupId)}"/>
      <ResGlobalInfo><HotelReservationIDs><HotelReservationID ResID_Type="14" ResID_Value="${esc(c.pmsConfirmationNumber)}"/></HotelReservationIDs></ResGlobalInfo>
    </${element}>`;

    const newOnes = confirmations.filter((c) => c.action === 'BOOK');
    const modified = confirmations.filter((c) => c.action !== 'BOOK');

    if (newOnes.length > 0) {
      const body = `<?xml version="1.0" encoding="UTF-8"?>
<OTA_HotelResNotifRS xmlns="${OTA_NS}" TimeStamp="${timestamp()}" Version="2.001">
  <Success/>
  <HotelReservations>
    ${newOnes.map((c) => acknowledgement(c, 'HotelReservation')).join('\n    ')}
  </HotelReservations>
</OTA_HotelResNotifRS>`;
      await postXml({ url: `${SECURE_URL}/hotels/ota/OTA_HotelResNotif`, body, basicAuth: this.auth });
    }

    if (modified.length > 0) {
      const body = `<?xml version="1.0" encoding="UTF-8"?>
<OTA_HotelResModifyNotifRS xmlns="${OTA_NS}" TimeStamp="${timestamp()}" Version="2.001">
  <Success/>
  <HotelResModifies>
    ${modified.map((c) => acknowledgement(c, 'HotelResModify')).join('\n    ')}
  </HotelResModifies>
</OTA_HotelResModifyNotifRS>`;
      await postXml({ url: `${SECURE_URL}/hotels/ota/OTA_HotelResModifyNotif`, body, basicAuth: this.auth });
    }
  }

  async upsertPromotion(promotion: OtaPromotionPayload): Promise<{ externalId: string }> {
    const attributes = [
      promotion.externalId ? `id="${esc(promotion.externalId)}"` : '',
      promotion.externalId ? `action="${promotion.active ? 'activate' : 'deactivate'}"` : '',
      `name="${esc(promotion.name)}"`,
      `type="${PROMOTION_TYPES[promotion.type]}"`,
      'target_channel="public"',
      promotion.minStay ? `min_stay_through="${promotion.minStay}"` : '',
      promotion.type === 'EARLY_BOOKER' && promotion.minDaysInAdvance
        ? `early_booker_days="${promotion.minDaysInAdvance}"`
        : '',
      promotion.type === 'LAST_MINUTE' && promotion.maxDaysInAdvance
        ? `last_minute_unit="day" last_minute_value="${promotion.maxDaysInAdvance}"`
        : '',
    ]
      .filter(Boolean)
      .join(' ');

    const bookDate =
      promotion.bookStart || promotion.bookEnd
        ? `<book_date start="${promotion.bookStart ?? ''}" end="${promotion.bookEnd ?? ''}"/>`
        : '';
    const body = `<?xml version="1.0" encoding="UTF-8"?>
<request>
  <hotel_id>${esc(this.creds.otaPropertyId)}</hotel_id>
  <promotion ${attributes}>
    ${bookDate}
    <stay_date start="${promotion.stayStart}" end="${promotion.stayEnd}"/>
    <parent_rates>${promotion.otaRatePlanIds.map((id) => `<parent_rate id="${esc(id)}"/>`).join('')}</parent_rates>
    <rooms>${promotion.otaRoomTypeIds.map((id) => `<room id="${esc(id)}"/>`).join('')}</rooms>
    <discount value="${promotion.discountPercent}"/>
  </promotion>
</request>`;

    const xml = await postXml({ url: `${SUPPLY_URL}/hotels/xml/promotions`, body, basicAuth: this.auth });
    const response = parseXml(xml);
    this.checkBxmlErrors(response);

    const findPromotionId = (node: any): string | undefined => {
      if (!node || typeof node !== 'object') return undefined;
      for (const promo of asArray(node.promotion)) {
        const id = attr(promo, 'id');
        if (id) return id;
      }
      for (const child of Object.values(node)) {
        const id = findPromotionId(child);
        if (id) return id;
      }
      return undefined;
    };
    const externalId = findPromotionId(response) ?? promotion.externalId;
    if (!externalId) {
      throw new ChannelApiError('Booking.com did not return a promotion ID', response);
    }
    return { externalId };
  }
}
