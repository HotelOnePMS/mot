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
  OtaRoomType,
  ReservationConfirmation,
} from '../types';
import { asArray, attr, chunk, esc, parseXml, postXml, text } from '../xml';
import { buildAvailMessages, buildRateMessage, OTA_NS, parseHotelReservation, timestamp } from './opentravel';

const SUPPLY_URL = process.env.BOOKING_COM_SUPPLY_URL || 'https://supply-xml.booking.com';
const SECURE_URL = process.env.BOOKING_COM_SECURE_URL || 'https://secure-supply-xml.booking.com';
const MESSAGES_PER_REQUEST = 100;

const PROMOTION_TYPES = {
  BASIC: 'basic',
  EARLY_BOOKER: 'early_booker',
  LAST_MINUTE: 'last_minute',
  MULTI_NIGHT: 'basic', // multi-night = basic promotion with a minimum stay
} as const;

const LABEL = 'Booking.com';

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

  async pushAri(updates: AriUpdate[]): Promise<AriPushResult> {
    const hotelCode = esc(this.creds.otaPropertyId);
    const availMessages = updates.flatMap((update) => buildAvailMessages(update));
    const rateMessages = updates
      .map((update) => buildRateMessage(update, this.creds.currency))
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
      reservations.push(...parseHotelReservation(reservation, 'BOOK', LABEL));
    }

    const modifyXml = await postXml({
      url: `${SECURE_URL}/hotels/ota/OTA_HotelResModifyNotif${query}`,
      body: '',
      method: 'GET',
      basicAuth: this.auth,
    });
    const modifyRoot = this.checkOtaErrors(parseXml(modifyXml), 'OTA_HotelResModifyNotifRQ');
    for (const reservation of asArray(modifyRoot.HotelResModifies?.HotelResModify)) {
      reservations.push(...parseHotelReservation(reservation, 'MODIFY', LABEL));
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
