/**
 * Google Hotels adapter - Hotel Center ARI (availability, rates, inventory) for
 * free booking links. Google never takes the booking: the link opens the hotel's
 * HotelOne booking site (see /api/channels/google/landing), so there are no
 * reservations to import.
 *
 *   Transaction (property data)  /travel/hotels/uploads/property_data
 *                                defines the room types and the rate plan (RoomData, PackageData)
 *   OTA_HotelInvCountNotifRQ     /travel/hotels/uploads/ota/hotel_inv_count_notif   rooms left
 *   OTA_HotelAvailNotifRQ        /travel/hotels/uploads/ota/hotel_avail_notif       open/close, min stay
 *   OTA_HotelRateAmountNotifRQ   /travel/hotels/uploads/ota/hotel_rate_amount_notif prices (before tax)
 *   Promotions                   /travel/hotels/uploads/promotions
 *
 * Google identifies the partner by the RequestorID in POS (the Hotel Center partner key)
 * and accepts messages only from IP addresses allowlisted in Hotel Center.
 */
import crypto from 'crypto';
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
import { buildAvailMessages, buildRateMessage, echoToken, OTA_NS, timestamp } from './opentravel';
import { PMS_RATE_CODE, PmsRoomTypeRef, pmsRoomCode, pmsRoomTypesAsOta } from './pms-codes';

const BASE_URL = (process.env.GOOGLE_HOTELS_ARI_BASE_URL || 'https://www.google.com/travel/hotels/uploads').replace(/\/$/, '');
const MESSAGES_PER_REQUEST = 100;

export class GoogleHotelsAdapter implements ChannelAdapter {
  constructor(
    private readonly creds: ChannelCredentials,
    private readonly pmsRoomTypes: PmsRoomTypeRef[]
  ) {}

  private get partnerKey(): string {
    if (!this.creds.username) throw new ChannelApiError('Enter the Hotel Center partner key');
    return this.creds.username;
  }

  private pos(): string {
    return `<POS><Source><RequestorID ID="${esc(this.partnerKey)}"/></Source></POS>`;
  }

  private check(response: Record<string, any>, rootName: string): Record<string, any> {
    const root = response[rootName];
    if (!root) throw new ChannelApiError(`Unexpected Google response (missing ${rootName})`, response);
    const errors = asArray(root.Errors?.Error);
    if (errors.length > 0) {
      const messages = errors.map((e) => `${attr(e, 'Code') ?? ''} ${attr(e, 'ShortText') ?? text(e)}`.trim());
      throw new ChannelApiError(`Google Hotels error: ${messages.join('; ')}`, errors);
    }
    return root;
  }

  private async sendOta(path: string, rootName: string, inner: string): Promise<Record<string, any>> {
    const body = `<?xml version="1.0" encoding="UTF-8"?>
<${rootName} xmlns="${OTA_NS}" EchoToken="${echoToken()}" TimeStamp="${timestamp()}" Version="3.0">
  ${this.pos()}
  ${inner}
</${rootName}>`;
    const xml = await postXml({ url: `${BASE_URL}${path}`, body });
    return this.check(parseXml(xml), rootName.replace(/RQ$/, 'RS'));
  }

  /** Room types and the single rate plan as a Transaction overlay (safe to resend) */
  propertyDataXml(): string {
    const rooms = this.pmsRoomTypes
      .map(
        (room) => `    <RoomData>
      <RoomID>${esc(pmsRoomCode(room.id))}</RoomID>
      <Name><Text text="${esc(room.name)}" language="en"/></Name>
      ${room.capacity ? `<Capacity>${room.capacity}</Capacity>` : ''}
    </RoomData>`
      )
      .join('\n');
    return `<?xml version="1.0" encoding="UTF-8"?>
<Transaction timestamp="${new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')}" id="${crypto.randomUUID()}" partner="${esc(this.partnerKey)}">
  <PropertyDataSet action="overlay">
    <Property>${esc(this.creds.otaPropertyId)}</Property>
${rooms}
    <PackageData>
      <PackageID>${PMS_RATE_CODE}</PackageID>
      <Name><Text text="Best available rate" language="en"/></Name>
    </PackageData>
  </PropertyDataSet>
</Transaction>`;
  }

  /** Publishes the property's room types to Google, which also proves the partner key and IP allowlist work */
  async testConnection(): Promise<ConnectionTestResult> {
    if (this.pmsRoomTypes.length === 0) throw new ChannelApiError('Add a room type before connecting Google Hotels');
    const xml = await postXml({ url: `${BASE_URL}/property_data`, body: this.propertyDataXml() });
    const response = parseXml(xml);
    const issues = asArray(response.TransactionResponse?.Issues?.Issue ?? response.Issues?.Issue);
    const errors = issues.filter((issue: any) => (attr(issue, 'severity') ?? attr(issue, 'type') ?? '').toLowerCase() === 'error');
    if (errors.length > 0) {
      throw new ChannelApiError(`Google Hotels error: ${errors.map((e: any) => text(e) || attr(e, 'code')).join('; ')}`, response);
    }
    return {
      ok: true,
      message: `Published ${this.pmsRoomTypes.length} room type(s) to Google Hotel Center for hotel ${this.creds.otaPropertyId}`,
    };
  }

  async fetchRoomTypes(): Promise<OtaRoomType[]> {
    return pmsRoomTypesAsOta(this.pmsRoomTypes);
  }

  async pushAri(updates: AriUpdate[]): Promise<AriPushResult> {
    const hotelCode = esc(this.creds.otaPropertyId);
    const inventory = updates
      .filter((u) => u.available !== null)
      .map(
        (u) => `<Inventory>
      <StatusApplicationControl Start="${u.from}" End="${u.to}" InvTypeCode="${esc(u.otaRoomTypeId)}"/>
      <InvCounts><InvCount Count="${u.available}" CountType="2"/></InvCounts>
    </Inventory>`
      );
    // Inventory goes in InvCountNotif; AvailNotif carries restrictions only
    const restrictions = updates.flatMap((u) => buildAvailMessages(u, { includeBookingLimit: false }));
    // Google expects pre-tax prices; taxes and fees are set in Hotel Center or a Taxes message
    const rates = updates
      .map((u) => buildRateMessage(u, this.creds.currency, 'AmountBeforeTax'))
      .filter((m): m is string => m !== null);

    let requests = 0;
    for (const batch of chunk(inventory, MESSAGES_PER_REQUEST)) {
      await this.sendOta('/ota/hotel_inv_count_notif', 'OTA_HotelInvCountNotifRQ', `<Inventories HotelCode="${hotelCode}">\n    ${batch.join('\n    ')}\n  </Inventories>`);
      requests++;
    }
    for (const batch of chunk(restrictions, MESSAGES_PER_REQUEST)) {
      await this.sendOta('/ota/hotel_avail_notif', 'OTA_HotelAvailNotifRQ', `<AvailStatusMessages HotelCode="${hotelCode}">\n    ${batch.join('\n    ')}\n  </AvailStatusMessages>`);
      requests++;
    }
    for (const batch of chunk(rates, MESSAGES_PER_REQUEST)) {
      await this.sendOta('/ota/hotel_rate_amount_notif', 'OTA_HotelRateAmountNotifRQ', `<RateAmountMessages HotelCode="${hotelCode}">\n    ${batch.join('\n    ')}\n  </RateAmountMessages>`);
      requests++;
    }
    return { requests, updates: updates.length, warnings: [] };
  }

  /** Free booking links send guests to the HotelOne booking site; those bookings are direct (source WEB) */
  async pullReservations(): Promise<OtaReservation[]> {
    return [];
  }

  async confirmReservations(_confirmations: ReservationConfirmation[]): Promise<void> {}

  promotionXml(promotion: OtaPromotionPayload, id: string): string {
    const body = promotion.active
      ? `<Promotion id="${esc(id)}">
      ${promotion.bookStart || promotion.bookEnd ? `<BookingDates><DateRange${promotion.bookStart ? ` start="${promotion.bookStart}"` : ''}${promotion.bookEnd ? ` end="${promotion.bookEnd}"` : ''}/></BookingDates>` : ''}
      <CheckinDates><DateRange start="${promotion.stayStart}" end="${promotion.stayEnd}"/></CheckinDates>
      ${promotion.minDaysInAdvance || promotion.maxDaysInAdvance ? `<BookingWindow${promotion.minDaysInAdvance ? ` min="${promotion.minDaysInAdvance}"` : ''}${promotion.maxDaysInAdvance ? ` max="${promotion.maxDaysInAdvance}"` : ''}/>` : ''}
      ${promotion.minStay ? `<LengthOfStay min="${promotion.minStay}"/>` : ''}
      <Discount percentage="${promotion.discountPercent}"/>
      <RoomTypes>${promotion.otaRoomTypeIds.map((r) => `<RoomType id="${esc(r)}"/>`).join('')}</RoomTypes>
      <RatePlans>${promotion.otaRatePlanIds.map((r) => `<RatePlan id="${esc(r)}"/>`).join('')}</RatePlans>
    </Promotion>`
      : `<Promotion id="${esc(id)}" action="delete"/>`;
    return `<?xml version="1.0" encoding="UTF-8"?>
<Promotions partner="${esc(this.partnerKey)}" id="${crypto.randomUUID()}" timestamp="${new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')}">
  <HotelPromotions hotel_id="${esc(this.creds.otaPropertyId)}">
    ${body}
  </HotelPromotions>
</Promotions>`;
  }

  /** Promotion IDs are the partner's own, so HotelOne picks one and Google keys on it */
  async upsertPromotion(promotion: OtaPromotionPayload): Promise<{ externalId: string }> {
    const id = promotion.externalId ?? `HO-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
    const xml = await postXml({ url: `${BASE_URL}/promotions`, body: this.promotionXml(promotion, id) });
    const response = parseXml(xml);
    const root = response.PromotionsResponse ?? response;
    const errors = asArray(root?.Issues?.Issue).filter((i: any) => (attr(i, 'severity') ?? attr(i, 'type') ?? '').toLowerCase() === 'error');
    if (errors.length > 0) throw new ChannelApiError(`Google Hotels rejected the promotion: ${errors.map((e: any) => text(e)).join('; ')}`, response);
    return { externalId: id };
  }
}
