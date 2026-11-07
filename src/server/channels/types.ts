import type { OtaPaymentCard } from './cards';
import type { ChannelMode, OtaChannel, PromotionType } from '@prisma/client';
import { DomainError } from '../errors';

export const CHANNEL_LABELS: Record<OtaChannel, string> = {
  EXPEDIA: 'Expedia',
  BOOKING_COM: 'Booking.com',
};

/** Everything an adapter needs to talk to one OTA account */
export interface ChannelCredentials {
  channel: OtaChannel;
  mode: ChannelMode;
  otaPropertyId: string;
  username: string;
  password: string;
  currency: string;
}

export interface OtaRatePlan {
  id: string;
  name: string;
}

export interface OtaRoomType {
  id: string;
  name: string;
  ratePlans: OtaRatePlan[];
}

/**
 * One availability/rate/restriction update for a contiguous date range.
 * `from` and `to` are both inclusive (YYYY-MM-DD).
 * A null value means "don't touch this field on the OTA".
 */
export interface AriUpdate {
  otaRoomTypeId: string;
  otaRatePlanId: string;
  from: string;
  to: string;
  price: number | null;
  available: number | null;
  closed: boolean | null;
  minStay: number | null;
}

export type OtaReservationAction = 'BOOK' | 'MODIFY' | 'CANCEL';

/**
 * A reservation as received from an OTA, normalized across channels.
 * One PMS booking holds one room type, so an OTA reservation covering several
 * room types is split: each part gets its own externalId and they share the
 * OTA's reservation number as reservationGroupId.
 */
export interface OtaReservation {
  externalId: string;
  reservationGroupId: string;
  action: OtaReservationAction;
  otaRoomTypeId: string | null;
  otaRatePlanId: string | null;
  checkIn: string | null;
  checkOut: string | null;
  rooms: number;
  adults: number;
  children: number;
  totalAmount: number | null;
  currency: string | null;
  guest: {
    firstName: string;
    lastName: string;
    email: string | null;
    phone: string | null;
  };
  specialRequests: string | null;
  paymentModel: string | null;
  /** The card sent with the booking, without its number; read from `raw` when not set (see cards.ts). */
  paymentCard?: OtaPaymentCard | null;
  /** The OTA's payload. May hold card numbers: store it only through redactCardData. */
  raw: unknown;
}

export interface ReservationConfirmation {
  reservationGroupId: string;
  action: OtaReservationAction;
  pmsConfirmationNumber: string;
}

/** Promotion as sent to an OTA, with PMS room types resolved to OTA IDs */
export interface OtaPromotionPayload {
  externalId: string | null;
  name: string;
  type: PromotionType;
  discountPercent: number;
  stayStart: string;
  stayEnd: string;
  bookStart: string | null;
  bookEnd: string | null;
  minStay: number | null;
  minDaysInAdvance: number | null;
  maxDaysInAdvance: number | null;
  active: boolean;
  otaRoomTypeIds: string[];
  otaRatePlanIds: string[];
}

export interface ConnectionTestResult {
  ok: boolean;
  message: string;
  otaPropertyName?: string;
}

export interface AriPushResult {
  requests: number;
  updates: number;
  warnings: string[];
}

export interface ChannelAdapter {
  testConnection(): Promise<ConnectionTestResult>;
  fetchRoomTypes(): Promise<OtaRoomType[]>;
  pushAri(updates: AriUpdate[]): Promise<AriPushResult>;
  pullReservations(): Promise<OtaReservation[]>;
  confirmReservations(confirmations: ReservationConfirmation[]): Promise<void>;
  /** Creates or updates the promotion and returns the OTA's promotion ID */
  upsertPromotion(promotion: OtaPromotionPayload): Promise<{ externalId: string }>;
}

/**
 * Thrown for channel failures (OTA errors and invalid channel requests). The
 * message is safe to show to staff; raw OTA responses stay in `otaDetails`
 * for the sync log and are never sent to the browser.
 */
export class ChannelApiError extends DomainError {
  constructor(
    message: string,
    public readonly otaDetails?: unknown
  ) {
    super(400, 'CHANNEL', message);
    this.name = 'ChannelApiError';
  }
}
