-- Reservations with several room types: one booking row per room type, linked by the lead row's code.
ALTER TABLE "bookings" ADD COLUMN "groupCode" TEXT;
CREATE INDEX "bookings_groupCode_idx" ON "bookings"("groupCode");
