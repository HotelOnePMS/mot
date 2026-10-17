-- Room assignment + confirmation codes on bookings, feature tags on rooms.
-- Additive only: every new column is nullable or defaulted.

ALTER TABLE "bookings" ADD COLUMN "code" TEXT;
ALTER TABLE "bookings" ADD COLUMN "roomId" TEXT;

-- Backfill codes for existing bookings (8 hex chars from the id hash).
UPDATE "bookings" SET "code" = upper(substr(md5("id"), 1, 8)) WHERE "code" IS NULL;

CREATE UNIQUE INDEX "bookings_code_key" ON "bookings"("code");
CREATE INDEX "bookings_propertyId_checkIn_idx" ON "bookings"("propertyId", "checkIn");
CREATE INDEX "bookings_propertyId_checkOut_idx" ON "bookings"("propertyId", "checkOut");
CREATE INDEX "bookings_roomTypeId_checkIn_checkOut_idx" ON "bookings"("roomTypeId", "checkIn", "checkOut");
CREATE INDEX "bookings_roomId_idx" ON "bookings"("roomId");

ALTER TABLE "bookings" ADD CONSTRAINT "bookings_roomId_fkey"
  FOREIGN KEY ("roomId") REFERENCES "rooms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "rooms" ADD COLUMN "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];
