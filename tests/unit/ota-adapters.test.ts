import { afterEach, describe, expect, it, vi } from 'vitest';
import { CHANNEL_CATALOG, CHANNEL_IDS, reservationDelivery, roomCodeSource } from '@/lib/channels/catalog';
import { AirbnbAdapter, parseAirbnbReservation } from '@/server/channels/adapters/airbnb';
import { BookingComAdapter } from '@/server/channels/adapters/booking-com';
import { ChannexAdapter, matchesChannel, parseChannexRevision } from '@/server/channels/adapters/channex';
import { GoogleHotelsAdapter } from '@/server/channels/adapters/google-hotels';
import { OTA_PARTNERS, OtaPartnerAdapter } from '@/server/channels/adapters/ota-partner';
import { parsePushedReservations, pushedResponse, pushedRootName } from '@/server/channels/adapters/opentravel';
import { PMS_RATE_CODE, pmsRoomCode } from '@/server/channels/adapters/pms-codes';
import type { AriUpdate, ChannelCredentials } from '@/server/channels/types';
import { parseXml } from '@/server/channels/xml';

const creds = (channel: ChannelCredentials['channel'], extra: Partial<ChannelCredentials> = {}): ChannelCredentials => ({
  channel,
  mode: 'LIVE',
  otaPropertyId: '777',
  username: 'user',
  password: 'secret',
  currency: 'USD',
  connectivityProvider: null,
  ...extra,
});

const update = (extra: Partial<AriUpdate> = {}): AriUpdate => ({
  otaRoomTypeId: 'R1',
  otaRatePlanId: 'P1',
  from: '2026-12-01',
  to: '2026-12-05',
  price: 129.5,
  available: 3,
  closed: false,
  minStay: 2,
  ...extra,
});

/** Records each fetch and answers with the given bodies in turn */
function mockFetch(...bodies: string[]) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fn = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const body = bodies[Math.min(calls.length - 1, bodies.length - 1)] ?? '';
    return new Response(body, { status: 200 });
  });
  vi.stubGlobal('fetch', fn);
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const RES_NOTIF = `<?xml version="1.0"?>
<OTA_HotelResNotifRQ xmlns="http://www.opentravel.org/OTA/2003/05">
  <HotelReservations>
    <HotelReservation ResStatus="Commit">
      <UniqueID Type="14" ID="TC-5501"/>
      <RoomStays>
        <RoomStay>
          <RoomTypes><RoomType RoomTypeCode="HOABC"/></RoomTypes>
          <RatePlans><RatePlan RatePlanCode="BAR"/></RatePlans>
          <GuestCounts><GuestCount AgeQualifyingCode="10" Count="2"/><GuestCount AgeQualifyingCode="8" Count="1"/></GuestCounts>
          <TimeSpan Start="2026-12-10" End="2026-12-12"/>
          <Total AmountAfterTax="310.00" CurrencyCode="USD"/>
          <BasicPropertyInfo HotelCode="777"/>
        </RoomStay>
      </RoomStays>
      <ResGuests><ResGuest><Profiles><ProfileInfo><Profile><Customer>
        <PersonName><GivenName>Li</GivenName><Surname>Wei</Surname></PersonName>
        <Telephone PhoneNumber="+86 10 5555"/>
        <Email>li@example.com</Email>
      </Customer></Profile></ProfileInfo></Profiles></ResGuest></ResGuests>
      <ResGlobalInfo><HotelReservationIDs><HotelReservationID ResID_Type="14" ResID_Value="TC-5501"/></HotelReservationIDs></ResGlobalInfo>
    </HotelReservation>
  </HotelReservations>
</OTA_HotelResNotifRQ>`;

describe('channel catalog', () => {
  it('lists every OTA the user asked for, plus the existing two', () => {
    expect(CHANNEL_IDS).toEqual(['EXPEDIA', 'BOOKING_COM', 'GOOGLE_HOTELS', 'AIRBNB', 'AGODA', 'TRIP_COM', 'HOPPER', 'PRICELINE', 'HOSTELWORLD']);
  });

  it('pulls through Channex whatever the OTA delivers directly', () => {
    expect(reservationDelivery('AIRBNB', null)).toBe('webhook');
    expect(reservationDelivery('AIRBNB', 'CHANNEX')).toBe('pull');
    expect(reservationDelivery('GOOGLE_HOTELS', null)).toBe('none');
    expect(roomCodeSource('AGODA', null, 'LIVE')).toBe('pms');
    expect(roomCodeSource('AGODA', 'CHANNEX', 'LIVE')).toBe('ota');
    expect(roomCodeSource('AGODA', null, 'SANDBOX')).toBe('ota');
  });

  it('flags the OTAs whose spec is unconfirmed', () => {
    const unconfirmed = CHANNEL_IDS.filter((id) => !CHANNEL_CATALOG[id].specConfirmed);
    expect(unconfirmed).toEqual(['AIRBNB', 'TRIP_COM', 'HOPPER', 'PRICELINE', 'HOSTELWORLD']);
  });
});

describe('OpenTravel push messages', () => {
  it('parses a pushed reservation and answers with the PMS confirmation code', () => {
    const parsed = parseXml(RES_NOTIF);
    expect(pushedRootName(parsed)).toBe('OTA_HotelResNotifRQ');
    const [reservation] = parsePushedReservations(parsed, 'Trip.com');
    expect(reservation).toMatchObject({
      externalId: 'TC-5501',
      action: 'BOOK',
      otaRoomTypeId: 'HOABC',
      otaRatePlanId: 'BAR',
      checkIn: '2026-12-10',
      checkOut: '2026-12-12',
      adults: 2,
      children: 1,
      totalAmount: 310,
      guest: { firstName: 'Li', lastName: 'Wei', email: 'li@example.com', phone: '+86 10 5555' },
      paymentModel: 'Trip.com',
    });

    const reply = parseXml(pushedResponse('OTA_HotelResNotifRQ', [{ reservationGroupId: 'TC-5501', action: 'BOOK', pmsConfirmationNumber: 'HX7K2' }], null));
    const ids = reply.OTA_HotelResNotifRS.HotelReservations.HotelReservation.ResGlobalInfo.HotelReservationIDs.HotelReservationID;
    expect(ids['@_ResID_Value']).toBe('HX7K2');
    expect(reply.OTA_HotelResNotifRS.Success).toBeDefined();
  });

  it('reads an OTA_CancelRQ as a cancellation and reports errors', () => {
    const parsed = parseXml('<OTA_CancelRQ CancelType="Commit"><UniqueID Type="14" ID="AG-1"/></OTA_CancelRQ>');
    expect(parsePushedReservations(parsed, 'Agoda')).toMatchObject([{ externalId: 'AG-1', action: 'CANCEL' }]);
    const error = parseXml(pushedResponse('OTA_CancelRQ', [], 'Unknown room "X"'));
    expect(error.OTA_CancelRS.Errors.Error['@_ShortText']).toBe('Unknown room "X"');
  });
});

describe('OpenTravel partner adapter (Agoda, Trip.com, Priceline, Hopper, Hostelworld)', () => {
  const rooms = [{ id: 'rt_1', name: 'Deluxe King', capacity: 2 }];

  it('publishes HotelOne room codes for extranet mapping', async () => {
    const adapter = new OtaPartnerAdapter(creds('AGODA'), OTA_PARTNERS.AGODA!, rooms);
    expect(await adapter.fetchRoomTypes()).toEqual([
      { id: pmsRoomCode('rt_1'), name: 'Deluxe King', ratePlans: [{ id: PMS_RATE_CODE, name: 'Best available rate (HotelOne)' }] },
    ]);
    expect(pmsRoomCode('rt_1')).toMatch(/^HO[0-9A-F]{8}$/);
  });

  it('sends Agoda availability and rates with Basic auth to one endpoint', async () => {
    const calls = mockFetch('<OTA_HotelAvailNotifRS><Success/></OTA_HotelAvailNotifRS>', '<OTA_HotelRateAmountNotifRS><Success/></OTA_HotelRateAmountNotifRS>');
    const adapter = new OtaPartnerAdapter(creds('AGODA'), OTA_PARTNERS.AGODA!, rooms);
    const result = await adapter.pushAri([update()]);
    expect(result.requests).toBe(2);
    expect(calls.map((c) => c.url)).toEqual(['https://supplyota.agoda.com/b2b/ota/2015B/hotels', 'https://supplyota.agoda.com/b2b/ota/2015B/hotels']);
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe(`Basic ${Buffer.from('user:secret').toString('base64')}`);
    const avail = String(calls[0].init.body);
    expect(avail).toContain('<AvailStatusMessages HotelCode="777">');
    expect(avail).toContain('BookingLimit="3"');
    expect(avail).toContain('MinMaxMessageType="SetMinLOS"');
    expect(String(calls[1].init.body)).toContain('AmountAfterTax="129.50"');
  });

  it('puts Trip.com credentials in POS and needs its endpoint configured', async () => {
    const adapter = new OtaPartnerAdapter(creds('TRIP_COM'), OTA_PARTNERS.TRIP_COM!, rooms);
    await expect(adapter.testConnection()).rejects.toThrow(/TRIP_COM_OTA_URL/);

    vi.stubEnv('TRIP_COM_OTA_URL', 'https://example.test/ota/');
    const calls = mockFetch('<OTA_HotelAvailNotifRS><Success/></OTA_HotelAvailNotifRS>');
    await adapter.testConnection();
    expect(calls[0].url).toBe('https://example.test/ota/OTA_HotelAvailNotif');
    expect(String(calls[0].init.body)).toContain('<RequestorID Type="1" ID="user" MessagePassword="secret"/>');
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it('surfaces OTA errors', async () => {
    mockFetch('<OTA_HotelAvailNotifRS><Errors><Error Code="392" ShortText="Invalid hotel code"/></Errors></OTA_HotelAvailNotifRS>');
    const adapter = new OtaPartnerAdapter(creds('AGODA'), OTA_PARTNERS.AGODA!, rooms);
    await expect(adapter.testConnection()).rejects.toThrow('Agoda error: 392 Invalid hotel code');
  });

  it('rejects a webhook reservation for another hotel, accepts its own', () => {
    const adapter = new OtaPartnerAdapter(creds('TRIP_COM', { otaPropertyId: '999' }), OTA_PARTNERS.TRIP_COM!, rooms);
    expect(() => adapter.parseWebhook({ body: RES_NOTIF, contentType: 'text/xml' })).toThrow(/hotel 777, not 999/);
    const own = new OtaPartnerAdapter(creds('TRIP_COM'), OTA_PARTNERS.TRIP_COM!, rooms);
    expect(own.parseWebhook({ body: RES_NOTIF, contentType: 'text/xml' })).toHaveLength(1);
    const reply = own.webhookResponse({ body: RES_NOTIF, contentType: 'text/xml' }, { confirmations: [], error: null });
    expect(reply.body).toContain('<OTA_HotelResNotifRS');
  });
});

describe('Google Hotels adapter', () => {
  const rooms = [{ id: 'rt_1', name: 'Deluxe King', capacity: 2 }];

  it('publishes room data, then sends inventory, restrictions and pre-tax rates to the Hotel Center endpoints', async () => {
    const calls = mockFetch(
      '<TransactionResponse><Success/></TransactionResponse>',
      '<OTA_HotelInvCountNotifRS><Success/></OTA_HotelInvCountNotifRS>',
      '<OTA_HotelAvailNotifRS><Success/></OTA_HotelAvailNotifRS>',
      '<OTA_HotelRateAmountNotifRS><Success/></OTA_HotelRateAmountNotifRS>'
    );
    const adapter = new GoogleHotelsAdapter(creds('GOOGLE_HOTELS', { username: 'hotelone_partner', password: '' }), rooms);
    await adapter.testConnection();
    expect(calls[0].url).toBe('https://www.google.com/travel/hotels/uploads/property_data');
    expect(String(calls[0].init.body)).toContain(`<RoomID>${pmsRoomCode('rt_1')}</RoomID>`);

    await adapter.pushAri([update()]);
    expect(calls.slice(1).map((c) => c.url.replace('https://www.google.com/travel/hotels/uploads', ''))).toEqual([
      '/ota/hotel_inv_count_notif',
      '/ota/hotel_avail_notif',
      '/ota/hotel_rate_amount_notif',
    ]);
    expect(String(calls[1].init.body)).toContain('<InvCount Count="3" CountType="2"/>');
    expect(String(calls[2].init.body)).not.toContain('BookingLimit');
    expect(String(calls[3].init.body)).toContain('AmountBeforeTax="129.50"');
    expect(String(calls[3].init.body)).toContain('<RequestorID ID="hotelone_partner"/>');
  });

  it('builds promotions and has no bookings to import', async () => {
    const adapter = new GoogleHotelsAdapter(creds('GOOGLE_HOTELS'), rooms);
    const xml = adapter.promotionXml(
      {
        externalId: null,
        name: 'Winter',
        type: 'EARLY_BOOKER',
        discountPercent: 15,
        stayStart: '2027-01-05',
        stayEnd: '2027-02-28',
        bookStart: null,
        bookEnd: null,
        minStay: null,
        minDaysInAdvance: 30,
        maxDaysInAdvance: null,
        active: true,
        otaRoomTypeIds: ['HOX'],
        otaRatePlanIds: ['BAR'],
      },
      'HO-1'
    );
    expect(xml).toContain('<Discount percentage="15"/>');
    expect(xml).toContain('<BookingWindow min="30"/>');
    expect(await adapter.pullReservations()).toEqual([]);
  });
});

describe('Airbnb adapter', () => {
  it('groups calendar operations per listing', () => {
    const adapter = new AirbnbAdapter(creds('AIRBNB'));
    expect(adapter.calendarOperations([update({ otaRoomTypeId: '555' }), update({ otaRoomTypeId: '555', from: '2026-12-06', to: '2026-12-06', closed: true, price: null, available: null, minStay: null })])).toEqual([
      {
        listing_id: '555',
        operations: [
          { dates: ['2026-12-01:2026-12-05'], daily_price: 130, available_count: 3, availability: 'available', min_nights: 2 },
          { dates: ['2026-12-06:2026-12-06'], availability: 'unavailable' },
        ],
      },
    ]);
  });

  it('needs the partner API key and reads webhook reservations', async () => {
    const adapter = new AirbnbAdapter(creds('AIRBNB'));
    await expect(adapter.testConnection()).rejects.toThrow(/AIRBNB_API_KEY/);

    const body = JSON.stringify({
      action: 'reservation_acceptance_confirmation',
      reservation: {
        confirmation_code: 'HMABC123',
        listing_id: 555,
        start_date: '2026-12-10',
        end_date: '2026-12-13',
        guest_first_name: 'Sam',
        guest_last_name: 'Rivera',
        guest_details: { number_of_adults: 2, number_of_children: 0 },
        expected_payout_amount_accurate: '402.10',
        currency: 'USD',
      },
    });
    expect(adapter.parseWebhook({ body, contentType: 'application/json' })).toMatchObject([
      { externalId: 'HMABC123', action: 'BOOK', otaRoomTypeId: '555', checkIn: '2026-12-10', checkOut: '2026-12-13', adults: 2, totalAmount: 402.1 },
    ]);
    expect(parseAirbnbReservation({ confirmation_code: 'X', status_type: 'cancelled_by_guest' }, '').action).toBe('CANCEL');
  });
});

describe('Channex adapter', () => {
  it('matches revisions to the connection\'s OTA', () => {
    expect(matchesChannel('Booking.com', 'BOOKING_COM')).toBe(true);
    expect(matchesChannel('Trip.com', 'TRIP_COM')).toBe(true);
    expect(matchesChannel('Ctrip', 'TRIP_COM')).toBe(true);
    expect(matchesChannel('Airbnb', 'BOOKING_COM')).toBe(false);
  });

  it('builds availability and restriction bodies', () => {
    const adapter = new ChannexAdapter(creds('AGODA', { connectivityProvider: 'CHANNEX', otaPropertyId: 'prop-uuid' }));
    expect(adapter.ariBodies([update()])).toEqual({
      availability: [{ property_id: 'prop-uuid', room_type_id: 'R1', date_from: '2026-12-01', date_to: '2026-12-05', availability: 3 }],
      restrictions: [{ property_id: 'prop-uuid', rate_plan_id: 'P1', date_from: '2026-12-01', date_to: '2026-12-05', rate: '129.50', min_stay_arrival: 2, stop_sell: false }],
    });
  });

  it('pulls only its OTA\'s revisions and acknowledges the ones saved', async () => {
    const feed = {
      data: [
        { id: 'rev-1', attributes: { ota_name: 'Agoda', status: 'new', ota_reservation_code: 'AG-77', arrival_date: '2026-12-01', departure_date: '2026-12-03', amount: '200.00', currency: 'USD', customer: { name: 'Ana', surname: 'Ruiz' }, rooms: [{ room_type_id: 'rt-a', rate_plan_id: 'rp-a', occupancy: { adults: 2, children: 0 }, amount: '200.00' }] } },
        { id: 'rev-2', attributes: { ota_name: 'Booking.com', status: 'new', ota_reservation_code: 'BK-1', rooms: [] } },
      ],
    };
    const calls = mockFetch(JSON.stringify(feed), '{}');
    const adapter = new ChannexAdapter(creds('AGODA', { connectivityProvider: 'CHANNEX', otaPropertyId: 'prop-uuid' }));
    const reservations = await adapter.pullReservations();
    expect(reservations).toMatchObject([{ externalId: 'AG-77', otaRoomTypeId: 'rt-a', otaRatePlanId: 'rp-a', adults: 2, totalAmount: 200, guest: { firstName: 'Ana' } }]);
    expect((calls[0].init.headers as Record<string, string>)['user-api-key']).toBe('secret');

    await adapter.confirmReservations([{ reservationGroupId: 'AG-77', action: 'BOOK', pmsConfirmationNumber: 'HX1' }]);
    expect(calls[1].url).toBe('https://app.channex.io/api/v1/booking_revisions/rev-1/ack');
    expect(calls).toHaveLength(2);
  });

  it('splits a revision with two room types', () => {
    const parts = parseChannexRevision(
      { ota_reservation_code: 'G1', status: 'modified', rooms: [{ room_type_id: 'a', amount: '100' }, { room_type_id: 'b', amount: '150' }], amount: '250' },
      'Agoda'
    );
    expect(parts.map((p) => [p.externalId, p.action, p.totalAmount])).toEqual([
      ['G1-a', 'MODIFY', 100],
      ['G1-b', 'MODIFY', 150],
    ]);
  });
});

describe('Booking.com adapter after the OpenTravel refactor', () => {
  it('still sends the same availability and rate messages', async () => {
    const calls = mockFetch('<OTA_HotelAvailNotifRS><Success/></OTA_HotelAvailNotifRS>', '<OTA_HotelRateAmountNotifRS><Success/></OTA_HotelRateAmountNotifRS>');
    await new BookingComAdapter(creds('BOOKING_COM')).pushAri([update()]);
    expect(calls[0].url).toBe('https://supply-xml.booking.com/hotels/ota/OTA_HotelAvailNotif');
    expect(String(calls[0].init.body)).toContain('<AvailStatusMessage BookingLimit="3"><StatusApplicationControl Start="2026-12-01" End="2026-12-05" InvTypeCode="R1"/></AvailStatusMessage>');
    expect(String(calls[1].init.body)).toContain('AmountAfterTax="129.50" DecimalPlaces="2" CurrencyCode="USD"');
  });

  it('still parses pulled reservations with Booking.com fallbacks', async () => {
    mockFetch(RES_NOTIF.replace(/<PersonName>[\s\S]*<\/PersonName>/, ''), '<OTA_HotelResModifyNotifRQ><Success/></OTA_HotelResModifyNotifRQ>');
    const reservations = await new BookingComAdapter(creds('BOOKING_COM')).pullReservations();
    expect(reservations).toMatchObject([{ externalId: 'TC-5501', guest: { firstName: 'Booking.com', lastName: 'Guest' }, paymentModel: 'Booking.com' }]);
  });
});
