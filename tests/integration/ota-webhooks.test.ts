import { describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { addDaysISO } from '@/server/dates';
import { makeHotel } from './fixtures';

// No background OTA pushes during the test
vi.mock('next/server', async (original) => ({ ...(await original<typeof import('next/server')>()), after: () => undefined }));

async function tripComConnection() {
  const { pmsRoomCode } = await import('@/server/channels/adapters/pms-codes');
  const h = await makeHotel({ rooms: 3 });
  const code = pmsRoomCode(h.roomType.id);
  const connection = await prisma.channelConnection.create({
    data: {
      propertyId: h.property.id,
      channel: 'TRIP_COM',
      mode: 'LIVE',
      status: 'ACTIVE',
      otaPropertyId: `T${h.property.id.slice(-6)}`,
      username: 'req',
      roomMappings: { create: { roomTypeId: h.roomType.id, otaRoomTypeId: code, otaRatePlanId: 'BAR' } },
    },
  });
  return { h, code, connection };
}

const resNotif = (hotelCode: string, roomCode: string, id: string, checkIn: string, checkOut: string, status = 'Commit') => `<?xml version="1.0"?>
<OTA_HotelResNotifRQ xmlns="http://www.opentravel.org/OTA/2003/05">
  <HotelReservations><HotelReservation ResStatus="${status}">
    <UniqueID Type="14" ID="${id}"/>
    <RoomStays><RoomStay>
      <RoomTypes><RoomType RoomTypeCode="${roomCode}"/></RoomTypes>
      <RatePlans><RatePlan RatePlanCode="BAR"/></RatePlans>
      <GuestCounts><GuestCount AgeQualifyingCode="10" Count="2"/></GuestCounts>
      <TimeSpan Start="${checkIn}" End="${checkOut}"/>
      <Total AmountAfterTax="280.00" CurrencyCode="USD"/>
      <BasicPropertyInfo HotelCode="${hotelCode}"/>
    </RoomStay></RoomStays>
    <ResGuests><ResGuest><Profiles><ProfileInfo><Profile><Customer>
      <PersonName><GivenName>Mei</GivenName><Surname>Chen</Surname></PersonName>
    </Customer></Profile></ProfileInfo></Profiles></ResGuest></ResGuests>
    <ResGlobalInfo><HotelReservationIDs><HotelReservationID ResID_Type="14" ResID_Value="${id}"/></HotelReservationIDs></ResGlobalInfo>
  </HotelReservation></HotelReservations>
</OTA_HotelResNotifRQ>`;

describe('OTA reservation webhooks', () => {
  it('turns a pushed Trip.com reservation into a PMS booking and answers with its code', async () => {
    const { handleReservationWebhook, webhookToken } = await import('@/server/channels/webhooks');
    const { h, code, connection } = await tripComConnection();
    const checkIn = addDaysISO(h.today, 5);
    const id = `TC-${connection.id.slice(-8)}`;
    const body = resNotif(connection.otaPropertyId!, code, id, checkIn, addDaysISO(checkIn, 2));

    const reply = await handleReservationWebhook(connection.id, webhookToken(connection.id), body, 'text/xml');
    expect(reply.status).toBe(200);
    const booking = await prisma.booking.findFirstOrThrow({ where: { propertyId: h.property.id, source: 'TRIP_COM' } });
    expect(booking).toMatchObject({ status: 'CONFIRMED', rooms: 1, guests: 2 });
    expect(Number(booking.totalPrice)).toBe(280);
    expect(reply.body).toContain(`ResID_Value="${booking.code}"`);
    expect(reply.body).toContain('<Success/>');

    // The same message again updates rather than duplicates
    await handleReservationWebhook(connection.id, webhookToken(connection.id), body, 'text/xml');
    expect(await prisma.booking.count({ where: { propertyId: h.property.id, source: 'TRIP_COM' } })).toBe(1);

    // Cancellation releases it
    await handleReservationWebhook(connection.id, webhookToken(connection.id), `<OTA_CancelRQ><UniqueID Type="14" ID="${id}"/></OTA_CancelRQ>`, 'text/xml');
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).status).toBe('CANCELLED');
    const log = await prisma.channelSyncLog.findFirstOrThrow({ where: { connectionId: connection.id, action: 'RESERVATION_PUSH' }, orderBy: { createdAt: 'desc' } });
    expect(log.status).toBe('SUCCESS');
  });

  it('rejects a wrong token and reports unmapped rooms back to the OTA', async () => {
    const { handleReservationWebhook, webhookToken } = await import('@/server/channels/webhooks');
    const { h, connection } = await tripComConnection();
    const checkIn = addDaysISO(h.today, 5);
    const body = resNotif(connection.otaPropertyId!, 'NOPE', 'TC-x', checkIn, addDaysISO(checkIn, 1));

    expect((await handleReservationWebhook(connection.id, 'wrong', body, 'text/xml')).status).toBe(401);
    const reply = await handleReservationWebhook(connection.id, webhookToken(connection.id), body, 'text/xml');
    expect(reply.body).toContain('<Errors>');
    expect(reply.body).toContain('is not mapped');
    expect(await prisma.booking.count({ where: { propertyId: h.property.id } })).toBe(0);
  });

  it('serializes the webhook URL only for live webhook channels', async () => {
    const { serializeConnection } = await import('@/server/channels/connections');
    const { connection } = await tripComConnection();
    expect(serializeConnection(connection).webhookUrl).toMatch(new RegExp(`/api/channels/webhooks/${connection.id}\\?token=`));
    expect(serializeConnection({ ...connection, mode: 'SANDBOX' }).webhookUrl).toBeNull();
    expect(serializeConnection({ ...connection, channel: 'EXPEDIA' }).webhookUrl).toBeNull();
    expect(serializeConnection({ ...connection, connectivityProvider: 'CHANNEX' }).webhookUrl).toBeNull();
  });
});
