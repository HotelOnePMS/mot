import type { ChannelConnection } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { open, seal } from '../../vault';
import { ChannelAdapter, ChannelApiError, ChannelCredentials } from '../types';
import { BookingComAdapter } from './booking-com';
import { ExpediaAdapter } from './expedia';
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
  };
}

export async function getAdapter(connection: ChannelConnection): Promise<ChannelAdapter> {
  const creds = credentialsFor(connection);

  if (connection.mode === 'SANDBOX') {
    const roomTypes = await prisma.roomType.findMany({
      where: { propertyId: connection.propertyId, isActive: true },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
    return new SandboxAdapter(creds, roomTypes);
  }

  switch (connection.channel) {
    case 'EXPEDIA':
      return new ExpediaAdapter(creds);
    case 'BOOKING_COM':
      return new BookingComAdapter(creds);
  }
}
