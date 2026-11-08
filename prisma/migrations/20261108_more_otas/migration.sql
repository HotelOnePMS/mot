-- More OTAs for the channel manager. Additive only: new enum values and one nullable column.
ALTER TYPE "OtaChannel" ADD VALUE IF NOT EXISTS 'GOOGLE_HOTELS';
ALTER TYPE "OtaChannel" ADD VALUE IF NOT EXISTS 'AIRBNB';
ALTER TYPE "OtaChannel" ADD VALUE IF NOT EXISTS 'AGODA';
ALTER TYPE "OtaChannel" ADD VALUE IF NOT EXISTS 'TRIP_COM';
ALTER TYPE "OtaChannel" ADD VALUE IF NOT EXISTS 'HOPPER';
ALTER TYPE "OtaChannel" ADD VALUE IF NOT EXISTS 'PRICELINE';
ALTER TYPE "OtaChannel" ADD VALUE IF NOT EXISTS 'HOSTELWORLD';

-- null = direct connection to the OTA; 'CHANNEX' = through the Channex API
ALTER TABLE "channel_connections" ADD COLUMN IF NOT EXISTS "connectivityProvider" TEXT;
