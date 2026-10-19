/**
 * Sandbox adapter - simulates an OTA so properties can be onboarded and the
 * full sync flow exercised without certified partner credentials.
 * Room types mirror the PMS room types with OTA-style IDs.
 */
import crypto from 'crypto';
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
} from '../types';

export interface SandboxRoomType {
  id: string;
  name: string;
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Stable numeric ID derived from the PMS room type, shaped like the OTA's IDs */
export function sandboxOtaRoomId(channel: OtaChannel, otaPropertyId: string, pmsRoomTypeId: string): string {
  const hash = crypto.createHash('sha256').update(`${channel}:${otaPropertyId}:${pmsRoomTypeId}`).digest();
  const n = hash.readUInt32BE(0);
  return channel === 'EXPEDIA' ? String(200000000 + (n % 99999999)) : `${otaPropertyId}${String(n % 100).padStart(2, '0')}`;
}

export class SandboxAdapter implements ChannelAdapter {
  constructor(
    private readonly creds: ChannelCredentials,
    private readonly pmsRoomTypes: SandboxRoomType[]
  ) {}

  async testConnection(): Promise<ConnectionTestResult> {
    if (!this.creds.otaPropertyId) {
      throw new ChannelApiError('Enter the OTA property ID to connect');
    }
    const label = CHANNEL_LABELS[this.creds.channel];
    return {
      ok: true,
      message: `Sandbox connection to ${label} property ${this.creds.otaPropertyId} verified`,
      otaPropertyName: `${label} Sandbox Property ${this.creds.otaPropertyId}`,
    };
  }

  async fetchRoomTypes(): Promise<OtaRoomType[]> {
    return this.pmsRoomTypes.map((roomType) => {
      const id = sandboxOtaRoomId(this.creds.channel, this.creds.otaPropertyId, roomType.id);
      const ratePlans =
        this.creds.channel === 'EXPEDIA'
          ? [
              { id: `${id}01`, name: 'Standard Rate (Refundable)' },
              { id: `${id}02`, name: 'Non-refundable Rate' },
            ]
          : [
              { id: `${id}1`, name: 'Standard Rate' },
              { id: `${id}2`, name: 'Non-refundable' },
            ];
      return { id, name: roomType.name, ratePlans };
    });
  }

  async pushAri(updates: AriUpdate[]): Promise<AriPushResult> {
    for (const update of updates) {
      if (!DATE_PATTERN.test(update.from) || !DATE_PATTERN.test(update.to) || update.from > update.to) {
        throw new ChannelApiError(`Invalid date range ${update.from} - ${update.to}`);
      }
      if (update.price !== null && !(update.price > 0)) {
        throw new ChannelApiError(`Invalid price ${update.price} for ${update.from}`);
      }
      if (update.available !== null && update.available < 0) {
        throw new ChannelApiError(`Invalid availability ${update.available} for ${update.from}`);
      }
    }
    return { requests: Math.ceil(updates.length / 100), updates: updates.length, warnings: [] };
  }

  async pullReservations(): Promise<OtaReservation[]> {
    // Sandbox reservations are injected with "Simulate OTA booking" instead
    return [];
  }

  async confirmReservations(_confirmations: ReservationConfirmation[]): Promise<void> {}

  async upsertPromotion(promotion: OtaPromotionPayload): Promise<{ externalId: string }> {
    if (promotion.discountPercent <= 0 || promotion.discountPercent >= 100) {
      throw new ChannelApiError('Discount must be between 0 and 100%');
    }
    if (promotion.stayStart > promotion.stayEnd) {
      throw new ChannelApiError('Stay start must be before stay end');
    }
    return {
      externalId:
        promotion.externalId ?? `SBX-${this.creds.channel}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
    };
  }
}
