import type { ChannelConnection } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { open, seal } from '../../vault';
import { ChannelAdapter, ChannelApiError, ChannelCredentials } from '../types';
import { AirbnbAdapter } from './airbnb';
import { BookingComAdapter } from './booking-com';
import { ChannexAdapter } from './channex';
import { ExpediaAdapter } from './expedia';
import { GoogleHotelsAdapter } from './google-hotels';
import { OTA_PARTNERS, OtaPartnerAdapter } from './ota-partner';
import { SandboxAdapter } from './sandbox';

/** OTA passwords are sealed with the vault, bound to their connection so a sealed value can't be moved to another one. */
const aad = (connectionId: string) => `channel-connection:${connectionId}`;

export function sealPassword(connectionId: string, password: string): string {
  return seal(password, aad(connectionId));
}

function openPassword(connection: ChannelConnection): string {
  if (!connection.passwordCipher) return '';
  try {
    return open<string>(connection.passwordCipher, aad(connection.id));
  } catch {
    throw new ChannelApiError('The saved OTA password can no longer be read. Enter it again in the connection settings.');
  }
}

export function credentialsFor(connection: ChannelConnection): ChannelCredentials {
  return {
    channel: connection.channel,
    mode: connection.mode,
    otaPropertyId: connection.otaPropertyId ?? '',
    username: connection.username ?? '',
    password: connection.mode === 'LIVE' ? openPassword(connection) : '',
    currency: connection.currency,
    connectivityProvider: connection.connectivityProvider ?? null,
  };
}

function pmsRoomTypes(propertyId: string) {
  return prisma.roomType.findMany({
    where: { propertyId, isActive: true },
    select: { id: true, name: true, capacity: true },
    orderBy: { name: 'asc' },
  });
}

export async function getAdapter(connection: ChannelConnection): Promise<ChannelAdapter> {
  const creds = credentialsFor(connection);

  if (connection.mode === 'SANDBOX') {
    return new SandboxAdapter(creds, await pmsRoomTypes(connection.propertyId));
  }
  if (connection.connectivityProvider === 'CHANNEX') {
    return new ChannexAdapter(creds);
  }
  if (connection.connectivityProvider) {
    throw new ChannelApiError(`Unknown connectivity provider ${connection.connectivityProvider}`);
  }

  switch (connection.channel) {
    case 'EXPEDIA':
      return new ExpediaAdapter(creds);
    case 'BOOKING_COM':
      return new BookingComAdapter(creds);
    case 'GOOGLE_HOTELS':
      return new GoogleHotelsAdapter(creds, await pmsRoomTypes(connection.propertyId));
    case 'AIRBNB':
      return new AirbnbAdapter(creds);
    case 'AGODA':
    case 'TRIP_COM':
    case 'HOPPER':
    case 'PRICELINE':
    case 'HOSTELWORLD':
      return new OtaPartnerAdapter(creds, OTA_PARTNERS[connection.channel]!, await pmsRoomTypes(connection.propertyId));
    default: {
      const unknown: never = connection.channel;
      throw new ChannelApiError(`Unsupported channel ${unknown}`);
    }
  }
}
