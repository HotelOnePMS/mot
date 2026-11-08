/**
 * OpenTravel partner adapter: one class for the OTAs that take standard OTA
 * 2003/05 ARI messages and push reservations to the channel manager.
 *
 *   Agoda        Supply OTA API (2015B). HTTP Basic auth, one endpoint for all messages,
 *                bookings pushed as OTA_HotelResRQ / OTA_CancelRQ (Generic Push Booking API).
 *   Trip.com     OTA messages with the credentials in <POS><Source><RequestorID MessagePassword>,
 *                reservations pushed as OTA_HotelResNotifRQ / OTA_HotelResModifyNotifRQ.
 *   Priceline,   No public spec. Standard OTA messages with HTTP Basic auth until the OTA's
 *   Hopper,      own spec arrives during partner onboarding; endpoints must be configured.
 *   Hostelworld
 *
 * Room and rate codes are HotelOne's own (pms-codes.ts): the hotel enters them in the
 * OTA's extranet mapping screen, which is how these OTAs onboard channel managers.
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
  OtaRoomType,
  ReservationConfirmation,
  WebhookOutcome,
  WebhookReply,
  WebhookRequest,
} from '../types';
import { asArray, attr, chunk, esc, parseXml, postXml, text } from '../xml';
import { buildAvailMessages, buildRateMessage, echoToken, OTA_NS, parsePushedReservations, pushedResponse, pushedRootName, timestamp } from './opentravel';
import { PmsRoomTypeRef, pmsRoomTypesAsOta } from './pms-codes';

export interface OtaPartnerConfig {
  channel: OtaChannel;
  /** Env var holding the endpoint; `defaultUrl` is used when it is unset */
  urlEnv: string;
  defaultUrl: string | null;
  /** Path appended to the endpoint per message ('' when one URL takes every message) */
  paths: { avail: string; rate: string };
  /** 'basic' = HTTP Basic; 'pos' = RequestorID + MessagePassword inside the message */
  auth: 'basic' | 'pos';
  messagesPerRequest: number;
}

export const OTA_PARTNERS: Partial<Record<OtaChannel, OtaPartnerConfig>> = {
  AGODA: {
    channel: 'AGODA',
    urlEnv: 'AGODA_OTA_URL',
    defaultUrl: 'https://supplyota.agoda.com/b2b/ota/2015B/hotels',
    paths: { avail: '', rate: '' },
    auth: 'basic',
    messagesPerRequest: 100,
  },
  TRIP_COM: {
    channel: 'TRIP_COM',
    urlEnv: 'TRIP_COM_OTA_URL',
    defaultUrl: null,
    paths: { avail: '/OTA_HotelAvailNotif', rate: '/OTA_HotelRateAmountNotif' },
    auth: 'pos',
    messagesPerRequest: 100,
  },
  PRICELINE: {
    channel: 'PRICELINE',
    urlEnv: 'PRICELINE_OTA_URL',
    defaultUrl: null,
    paths: { avail: '/OTA_HotelAvailNotif', rate: '/OTA_HotelRateAmountNotif' },
    auth: 'basic',
    messagesPerRequest: 100,
  },
  HOPPER: {
    channel: 'HOPPER',
    urlEnv: 'HOPPER_OTA_URL',
    defaultUrl: null,
    paths: { avail: '/OTA_HotelAvailNotif', rate: '/OTA_HotelRateAmountNotif' },
    auth: 'basic',
    messagesPerRequest: 100,
  },
  HOSTELWORLD: {
    channel: 'HOSTELWORLD',
    urlEnv: 'HOSTELWORLD_OTA_URL',
    defaultUrl: null,
    paths: { avail: '/OTA_HotelAvailNotif', rate: '/OTA_HotelRateAmountNotif' },
    auth: 'basic',
    messagesPerRequest: 100,
  },
};

export class OtaPartnerAdapter implements ChannelAdapter {
  private readonly label: string;

  constructor(
    private readonly creds: ChannelCredentials,
    private readonly config: OtaPartnerConfig,
    private readonly pmsRoomTypes: PmsRoomTypeRef[]
  ) {
    this.label = CHANNEL_LABELS[config.channel];
  }

  private baseUrl(): string {
    const url = (process.env[this.config.urlEnv] || this.config.defaultUrl || '').replace(/\/$/, '');
    if (!url) {
      throw new ChannelApiError(
        `${this.label} live mode needs ${this.config.urlEnv}: set it to the endpoint ${this.label} gives you during partner onboarding.`
      );
    }
    return url;
  }

  private get basicAuth() {
    return this.config.auth === 'basic' ? { username: this.creds.username, password: this.creds.password } : undefined;
  }

  private pos(): string {
    if (this.config.auth !== 'pos') return '';
    return `<POS><Source><RequestorID Type="1" ID="${esc(this.creds.username)}" MessagePassword="${esc(this.creds.password)}"/></Source></POS>`;
  }

  private checkErrors(response: Record<string, any>, rootName: string): Record<string, any> {
    const root = response[rootName];
    if (!root) throw new ChannelApiError(`Unexpected ${this.label} response (missing ${rootName})`, response);
    const errors = asArray(root.Errors?.Error);
    if (errors.length > 0) {
      const messages = errors.map((e) => `${attr(e, 'Code') ?? ''} ${attr(e, 'ShortText') ?? text(e)}`.trim());
      throw new ChannelApiError(`${this.label} error: ${messages.join('; ')}`, errors);
    }
    return root;
  }

  private async send(rootName: string, path: string, inner: string): Promise<Record<string, any>> {
    const body = `<?xml version="1.0" encoding="UTF-8"?>
<${rootName} xmlns="${OTA_NS}" EchoToken="${echoToken()}" TimeStamp="${timestamp()}" Version="1.0">
  ${this.pos()}
  ${inner}
</${rootName}>`;
    const xml = await postXml({ url: `${this.baseUrl()}${path}`, body, basicAuth: this.basicAuth });
    return this.checkErrors(parseXml(xml), rootName.replace(/RQ$/, 'RS'));
  }

  /**
   * There is no read-only call in these APIs, so the test sends an availability
   * message that changes nothing (an empty AvailStatusMessages for the hotel).
   */
  async testConnection(): Promise<ConnectionTestResult> {
    await this.send('OTA_HotelAvailNotifRQ', this.config.paths.avail, `<AvailStatusMessages HotelCode="${esc(this.creds.otaPropertyId)}"/>`);
    return { ok: true, message: `Connected to ${this.label} hotel ${this.creds.otaPropertyId}` };
  }

  async fetchRoomTypes(): Promise<OtaRoomType[]> {
    return pmsRoomTypesAsOta(this.pmsRoomTypes);
  }

  async pushAri(updates: AriUpdate[]): Promise<AriPushResult> {
    const hotelCode = esc(this.creds.otaPropertyId);
    const availMessages = updates.flatMap((update) => buildAvailMessages(update));
    const rateMessages = updates
      .map((update) => buildRateMessage(update, this.creds.currency))
      .filter((message): message is string => message !== null);
    const warnings: string[] = [];
    let requests = 0;
    const collect = (root: Record<string, any>) => {
      for (const warning of asArray(root.Warnings?.Warning)) warnings.push(attr(warning, 'ShortText') ?? text(warning));
    };

    for (const batch of chunk(availMessages, this.config.messagesPerRequest)) {
      collect(
        await this.send(
          'OTA_HotelAvailNotifRQ',
          this.config.paths.avail,
          `<AvailStatusMessages HotelCode="${hotelCode}">\n    ${batch.join('\n    ')}\n  </AvailStatusMessages>`
        )
      );
      requests++;
    }
    for (const batch of chunk(rateMessages, this.config.messagesPerRequest)) {
      collect(
        await this.send(
          'OTA_HotelRateAmountNotifRQ',
          this.config.paths.rate,
          `<RateAmountMessages HotelCode="${hotelCode}">\n    ${batch.join('\n    ')}\n  </RateAmountMessages>`
        )
      );
      requests++;
    }
    return { requests, updates: updates.length, warnings };
  }

  /** Reservations are pushed to the webhook; nothing to poll */
  async pullReservations(): Promise<OtaReservation[]> {
    return [];
  }

  /** Confirmation numbers go back in the webhook reply */
  async confirmReservations(_confirmations: ReservationConfirmation[]): Promise<void> {}

  async upsertPromotion(_promotion: OtaPromotionPayload): Promise<{ externalId: string }> {
    throw new ChannelApiError(`${this.label} promotions are set up in the ${this.label} extranet; HotelOne can't publish them yet.`);
  }

  parseWebhook(request: WebhookRequest): OtaReservation[] {
    const parsed = parseXml(request.body);
    if (!pushedRootName(parsed)) {
      throw new ChannelApiError(`Unrecognised ${this.label} message: expected a reservation message`);
    }
    const hotelCode = this.messageHotelCode(parsed);
    if (hotelCode && hotelCode !== this.creds.otaPropertyId) {
      throw new ChannelApiError(`Reservation is for ${this.label} hotel ${hotelCode}, not ${this.creds.otaPropertyId}`);
    }
    return parsePushedReservations(parsed, this.label);
  }

  webhookResponse(request: WebhookRequest, outcome: WebhookOutcome): WebhookReply {
    let root = 'OTA_HotelResNotifRQ';
    try {
      root = pushedRootName(parseXml(request.body)) ?? root;
    } catch {
      // malformed body: answer as a reservation notification
    }
    return { status: 200, contentType: 'text/xml; charset=utf-8', body: pushedResponse(root, outcome.confirmations, outcome.error) };
  }

  /** HotelCode on the first room stay's BasicPropertyInfo, when the OTA sends one */
  private messageHotelCode(parsed: Record<string, any>): string | null {
    const root = parsed.OTA_HotelResNotifRQ ?? parsed.OTA_HotelResRQ ?? parsed.OTA_HotelResModifyNotifRQ;
    const reservation = asArray(root?.HotelReservations?.HotelReservation ?? root?.HotelResModifies?.HotelResModify)[0];
    const stay = asArray(reservation?.RoomStays?.RoomStay)[0];
    return attr(stay?.BasicPropertyInfo, 'HotelCode') ?? null;
  }
}
