/**
 * Room and rate codes HotelOne publishes itself, for OTAs where the hotel maps
 * codes in the OTA's extranet (Agoda, Trip.com, Priceline, Hopper, Hostelworld)
 * or where the partner defines the room IDs (Google Hotels).
 * Codes are derived from the PMS room type so they never change.
 */
import crypto from 'crypto';
import type { OtaRoomType } from '../types';

export interface PmsRoomTypeRef {
  id: string;
  name: string;
  capacity?: number | null;
}

/** The rate code every mapped room is sold under (best available rate) */
export const PMS_RATE_CODE = 'BAR';

export function pmsRoomCode(roomTypeId: string): string {
  return `HO${crypto.createHash('sha256').update(roomTypeId).digest('hex').slice(0, 8).toUpperCase()}`;
}

export function pmsRoomTypesAsOta(roomTypes: PmsRoomTypeRef[]): OtaRoomType[] {
  return roomTypes.map((roomType) => ({
    id: pmsRoomCode(roomType.id),
    name: roomType.name,
    ratePlans: [{ id: PMS_RATE_CODE, name: 'Best available rate (HotelOne)' }],
  }));
}
