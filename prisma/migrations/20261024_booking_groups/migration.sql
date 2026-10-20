-- Reservations with several room types: one booking row per room type, linked by the lead row's code.
ALTER TABLE "bookings" ADD COLUMN "groupCode" TEXT;
CREATE INDEX "bookings_groupCode_idx" ON "bookings"("groupCode");
-- The lead row holds the reservation's card payment; every line points at it.
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_groupCode_fkey" FOREIGN KEY ("groupCode") REFERENCES "bookings"("code") ON DELETE SET NULL ON UPDATE CASCADE;
